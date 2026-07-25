import { randomUUID } from "node:crypto";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import type { AuthManager, AuthSession } from "./auth.ts";
import { stateAllowsAttach } from "./lifecycle/state-machine.ts";
import { CLOSE_CODES, MAX_WEBSOCKET_FRAME_BYTES, MESSAGE_TYPES, PROTOCOL_VERSION } from "./protocol/constants.ts";
import { makeError, type ProtocolError } from "./protocol/errors.ts";
import type { LeaseGeneration, ProtocolEnvelope, TerminalSequence, TerminalSessionId } from "./protocol/types.ts";
import { AttachmentManager } from "./security/attachment.ts";
import { LeaseManager } from "./security/lease.ts";

interface WsTransportOptions {
	server: HttpServer;
	auth: AuthManager;
	expectedOrigin: string;
	heartbeatIntervalMs?: number;
}

interface WsClient {
	ws: WebSocket;
	connectionId: string;
	session?: AuthSession;
	deviceId: string;
	clientName?: string;
	clientVersion?: string;
	platform?: string;
	lastPongAt: number;
}

type MessageHandler = (client: WsClient, envelope: ProtocolEnvelope<unknown>, requestId: string) => Promise<void>;

export class WsTransport {
	private readonly auth: AuthManager;
	private readonly expectedOrigin: string;
	private readonly heartbeatIntervalMs: number;
	private readonly wss: WebSocketServer;
	private readonly clients = new Map<string, WsClient>();
	private readonly messageHandlers = new Map<string, MessageHandler>();
	private readonly attachments = new AttachmentManager();
	private readonly leases = new Map<TerminalSessionId, LeaseManager>();
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

	constructor(options: WsTransportOptions) {
		this.auth = options.auth;
		this.expectedOrigin = options.expectedOrigin;
		this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;

		this.wss = new WebSocketServer({ noServer: true });

		options.server.on("upgrade", (request, socket, head) => {
			void this.handleUpgrade(request, socket, head);
		});

		this.wss.on("connection", (ws, request) => {
			void this.handleConnection(ws, request);
		});

		this.registerHandlers();
	}

	private registerHandlers(): void {
		this.messageHandlers.set(MESSAGE_TYPES.CLIENT_HELLO, async (client, env) => {
			await this.handleClientHello(client, env);
		});
		this.messageHandlers.set(MESSAGE_TYPES.CONNECTION_PONG, async (client) => {
			client.lastPongAt = Date.now();
		});
		this.messageHandlers.set(MESSAGE_TYPES.TERMINAL_ATTACH, async (client, env) => {
			await this.handleTerminalAttach(client, env);
		});
		this.messageHandlers.set(MESSAGE_TYPES.TERMINAL_DETACH, async (client, env) => {
			await this.handleTerminalDetach(client, env);
		});
		this.messageHandlers.set(MESSAGE_TYPES.TERMINAL_INPUT, async (client, env) => {
			await this.handleTerminalInput(client, env);
		});
		this.messageHandlers.set(MESSAGE_TYPES.TERMINAL_RESIZE, async (client, env) => {
			await this.handleTerminalResize(client, env);
		});
		this.messageHandlers.set(MESSAGE_TYPES.TERMINAL_REPLAY_ACK, async (client, env) => {
			await this.handleReplayAck(client, env);
		});
	}

	private async handleUpgrade(
		request: IncomingMessage,
		socket: import("node:stream").Duplex,
		head: Buffer,
	): Promise<void> {
		try {
			const requestOrigin = request.headers.origin ?? "";
			if (requestOrigin !== this.expectedOrigin && requestOrigin !== this.expectedOrigin.replace("http://", "ws://")) {
				socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
				socket.destroy();
				return;
			}

			const host = request.headers.host ?? "";
			if (!host) {
				socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
				socket.destroy();
				return;
			}

			const session = this.auth.authenticate(request.headers.cookie);
			if (!session) {
				socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
				socket.destroy();
				return;
			}

			this.wss.handleUpgrade(request, socket, head, (ws) => {
				(ws as unknown as Record<string, unknown>).session = session;
				this.wss.emit("connection", ws, request);
			});
		} catch {
			socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
			socket.destroy();
		}
	}

	private async handleConnection(ws: WebSocket, _request: IncomingMessage): Promise<void> {
		const session = (ws as unknown as Record<string, unknown>).session as AuthSession | undefined;
		if (!session) {
			ws.close(CLOSE_CODES.AUTH_REQUIRED, "Authentication required");
			return;
		}

		const connectionId = randomUUID();
		const deviceId = session.id;
		const client: WsClient = {
			ws,
			connectionId,
			session,
			deviceId,
			lastPongAt: Date.now(),
		};
		this.clients.set(connectionId, client);
		this.attachments.establishTransport(connectionId, deviceId);

		this.sendEnvelope(client, MESSAGE_TYPES.CONNECTION_READY, {
			connectionId,
			serverTime: new Date().toISOString(),
			protocolVersion: PROTOCOL_VERSION,
			heartbeatIntervalMs: this.heartbeatIntervalMs,
			maxMessageBytes: MAX_WEBSOCKET_FRAME_BYTES,
		});

		this.startHeartbeat();

		ws.on("message", (data: RawData) => {
			void this.handleMessage(client, data);
		});

		ws.on("close", () => {
			this.handleClientClose(client);
		});

		ws.on("error", () => {
			this.handleClientClose(client);
		});
	}

	private async handleMessage(client: WsClient, data: RawData): Promise<void> {
		const raw = data.toString();
		const requestId = randomUUID();

		if (Buffer.byteLength(raw, "utf8") > MAX_WEBSOCKET_FRAME_BYTES) {
			this.sendError(client, requestId, CLOSE_CODES.MESSAGE_TOO_LARGE, "Message too large", true);
			return;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			this.sendError(client, requestId, CLOSE_CODES.POLICY_VIOLATION, "Invalid JSON");
			return;
		}

		const envelope = parsed as Record<string, unknown>;
		if (envelope.version !== PROTOCOL_VERSION) {
			this.sendError(client, requestId, CLOSE_CODES.PROTOCOL_VERSION_REJECTED, "Unknown protocol version");
			return;
		}
		if (typeof envelope.type !== "string") {
			this.sendError(client, requestId, CLOSE_CODES.POLICY_VIOLATION, "Missing message type");
			return;
		}
		if (envelope.payload === undefined) {
			this.sendError(client, requestId, CLOSE_CODES.POLICY_VIOLATION, "Missing payload");
			return;
		}

		const handler = this.messageHandlers.get(envelope.type);
		if (!handler) {
			this.sendError(client, requestId, CLOSE_CODES.POLICY_VIOLATION, `Unknown message type: ${envelope.type}`);
			return;
		}

		await handler(client, envelope as unknown as ProtocolEnvelope<unknown>, requestId);
	}

	private handleClientClose(client: WsClient): void {
		this.clients.delete(client.connectionId);
		const attached = this.attachments.getActiveAttachments();
		for (const a of attached) {
			if (a.connectionId === client.connectionId) {
				this.attachments.detach(a.sessionId);
			}
		}
		if (this.attachments.getActiveAttachments().length === 0) {
			this.attachments.loseTransport();
		}
	}

	private async handleClientHello(client: WsClient, envelope: ProtocolEnvelope<unknown>): Promise<void> {
		const payload = envelope.payload as Record<string, unknown>;
		client.clientName = typeof payload.clientName === "string" ? payload.clientName : undefined;
		client.clientVersion = typeof payload.clientVersion === "string" ? payload.clientVersion : undefined;
		client.platform = typeof payload.platform === "string" ? payload.platform : undefined;

		if (client.clientName !== "pi-pocket-console-web") {
			this.sendError(
				client,
				envelope.requestId ?? randomUUID(),
				CLOSE_CODES.POLICY_VIOLATION,
				"Unrecognized client",
				true,
			);
			return;
		}
	}

	private async handleTerminalAttach(client: WsClient, envelope: ProtocolEnvelope<unknown>): Promise<void> {
		const sessionId = envelope.sessionId as TerminalSessionId;
		if (!sessionId) {
			this.sendError(client, envelope.requestId ?? randomUUID(), CLOSE_CODES.POLICY_VIOLATION, "Missing sessionId");
			return;
		}

		const lastSeq =
			typeof (envelope.payload as Record<string, unknown>).lastReceivedSequence === "number"
				? ((envelope.payload as Record<string, unknown>).lastReceivedSequence as number)
				: undefined;

		if (!stateAllowsAttach("DETACHED") && !stateAllowsAttach("RECONNECTING")) {
			this.attachments.attach(client.connectionId, sessionId, lastSeq);
		} else {
			this.attachments.attach(client.connectionId, sessionId, -1);
		}

		const leaseMgr = this.leases.get(sessionId);
		const leaseSummary = leaseMgr ? leaseMgr.getSummary(client.deviceId) : { state: "none" as const };

		this.sendEnvelope(client, MESSAGE_TYPES.TERMINAL_ATTACHED, {
			state: "RUNNING",
			replay: {
				available: false,
				gap: false,
			},
			lease: leaseSummary,
		});
	}

	private async handleTerminalDetach(_client: WsClient, envelope: ProtocolEnvelope<unknown>): Promise<void> {
		const sessionId = envelope.sessionId as TerminalSessionId;
		if (sessionId) {
			this.attachments.detach(sessionId);
		}
	}

	private async handleTerminalInput(client: WsClient, envelope: ProtocolEnvelope<unknown>): Promise<void> {
		const sessionId = envelope.sessionId as TerminalSessionId;
		const requestId = envelope.requestId ?? randomUUID();
		const payload = envelope.payload as Record<string, unknown>;

		if (!sessionId) {
			this.sendError(client, requestId, CLOSE_CODES.POLICY_VIOLATION, "Missing sessionId");
			return;
		}

		const leaseMgr = this.leases.get(sessionId);
		if (!leaseMgr) {
			this.sendInputRejected(client, requestId, "TERMINAL_NOT_FOUND", "Terminal not found", "no");
			return;
		}

		const leaseId = typeof payload.leaseId === "string" ? payload.leaseId : "";
		const leaseGeneration = typeof payload.leaseGeneration === "number" ? payload.leaseGeneration : -1;
		const data = typeof payload.data === "string" ? payload.data : "";

		if (!leaseMgr.isValid(leaseId, leaseGeneration)) {
			this.sendInputRejected(client, requestId, "LEASE_STALE", "Lease is not valid", "no");
			return;
		}

		if (Buffer.byteLength(data, "utf8") > 48 * 1024) {
			this.sendInputRejected(client, requestId, "MESSAGE_TOO_LARGE", "Input exceeds 48 KiB limit", "no");
			return;
		}

		this.sendInputAccepted(client, requestId);
	}

	private sendInputRejected(
		client: WsClient,
		requestId: string,
		code: string,
		message: string,
		executed: "yes" | "no" | "unknown",
	): void {
		const err = makeError(code as never, message, "Input rejected", executed, false);
		this.sendEnvelope(
			client,
			MESSAGE_TYPES.TERMINAL_INPUT_REJECTED,
			{
				error: err.toJSON(),
			},
			requestId,
		);
	}

	private sendInputAccepted(client: WsClient, requestId: string): void {
		this.sendEnvelope(client, MESSAGE_TYPES.TERMINAL_INPUT_ACCEPTED, { accepted: true }, requestId);
	}

	private async handleTerminalResize(client: WsClient, envelope: ProtocolEnvelope<unknown>): Promise<void> {
		const sessionId = envelope.sessionId as TerminalSessionId;
		const requestId = envelope.requestId ?? randomUUID();
		const payload = envelope.payload as Record<string, unknown>;

		if (!sessionId) {
			this.sendError(client, requestId, CLOSE_CODES.POLICY_VIOLATION, "Missing sessionId");
			return;
		}

		const leaseMgr = this.leases.get(sessionId);
		if (!leaseMgr) {
			this.sendError(client, requestId, CLOSE_CODES.POLICY_VIOLATION, "Terminal not found");
			return;
		}

		const leaseId = typeof payload.leaseId === "string" ? payload.leaseId : "";
		const leaseGeneration = typeof payload.leaseGeneration === "number" ? payload.leaseGeneration : -1;

		if (!leaseMgr.isValid(leaseId, leaseGeneration)) {
			this.sendError(client, requestId, CLOSE_CODES.POLICY_VIOLATION, "Lease is not valid");
			return;
		}

		const cols = typeof payload.cols === "number" ? payload.cols : 0;
		const rows = typeof payload.rows === "number" ? payload.rows : 0;

		this.sendEnvelope(client, MESSAGE_TYPES.TERMINAL_RESIZE_ACCEPTED, { cols, rows });
	}

	private async handleReplayAck(_client: WsClient, envelope: ProtocolEnvelope<unknown>): Promise<void> {
		const sessionId = envelope.sessionId as TerminalSessionId;
		const payload = envelope.payload as Record<string, unknown>;
		const seq = typeof payload.lastReceivedSequence === "number" ? payload.lastReceivedSequence : -1;

		if (sessionId && seq !== -1) {
			this.attachments.updateLastReceivedSequence(sessionId, seq);
		}
	}

	private startHeartbeat(): void {
		if (this.heartbeatTimer) return;
		this.heartbeatTimer = setInterval(() => {
			const now = Date.now();
			for (const client of this.clients.values()) {
				if (now - client.lastPongAt > this.heartbeatIntervalMs * 3) {
					this.sendError(client, randomUUID(), CLOSE_CODES.INTERNAL_ERROR, "Heartbeat timeout", true);
					continue;
				}
				this.sendEnvelope(client, MESSAGE_TYPES.CONNECTION_PING, {
					sentAt: new Date().toISOString(),
				});
			}
		}, this.heartbeatIntervalMs);
		this.heartbeatTimer.unref();
	}

	getOrCreateLeaseManager(sessionId: TerminalSessionId): LeaseManager {
		let mgr = this.leases.get(sessionId);
		if (!mgr) {
			mgr = new LeaseManager();
			this.leases.set(sessionId, mgr);
		}
		return mgr;
	}

	sendEnvelope(
		client: WsClient,
		type: string,
		payload: unknown,
		requestId?: string,
		sessionId?: string,
		sequence?: number,
	): void {
		if (client.ws.readyState !== client.ws.OPEN) return;

		const envelope: Record<string, unknown> = {
			version: PROTOCOL_VERSION,
			type,
			payload,
		};
		if (sessionId) envelope.sessionId = sessionId;
		if (requestId) envelope.requestId = requestId;
		if (sequence !== undefined) envelope.sequence = sequence;

		const json = JSON.stringify(envelope);
		if (Buffer.byteLength(json, "utf8") <= MAX_WEBSOCKET_FRAME_BYTES) {
			client.ws.send(json);
		}
	}

	sendError(client: WsClient, requestId: string, closeCode: number, message: string, closeAfter = false): void {
		this.sendEnvelope(
			client,
			MESSAGE_TYPES.CONNECTION_ERROR,
			{
				error: {
					code: "INTERNAL_ERROR",
					message,
					impact: "Message rejected",
					executed: "no",
					retryable: false,
				},
				closeAfter,
			},
			requestId,
		);

		if (closeAfter) {
			client.ws.close(closeCode, message);
		}
	}

	sendOutput(client: WsClient, sessionId: TerminalSessionId, data: string, sequence: TerminalSequence): void {
		this.sendEnvelope(client, MESSAGE_TYPES.TERMINAL_OUTPUT, { data }, undefined, sessionId, sequence);
	}

	sendLeaseGranted(
		client: WsClient,
		sessionId: TerminalSessionId,
		lease: import("./protocol/types.ts").ControllerLease,
	): void {
		this.sendEnvelope(client, MESSAGE_TYPES.LEASE_GRANTED, { lease }, undefined, sessionId);
	}

	sendLeaseRevoked(
		client: WsClient,
		sessionId: TerminalSessionId,
		previousGeneration: LeaseGeneration,
		newGeneration: LeaseGeneration,
		reason: string,
	): void {
		this.sendEnvelope(
			client,
			MESSAGE_TYPES.LEASE_REVOKED,
			{ previousGeneration, newGeneration, reason },
			undefined,
			sessionId,
		);
	}

	sendLeaseExpiring(
		client: WsClient,
		sessionId: TerminalSessionId,
		generation: LeaseGeneration,
		expiresAt: string,
	): void {
		this.sendEnvelope(client, MESSAGE_TYPES.LEASE_EXPIRING, { generation, expiresAt }, undefined, sessionId);
	}

	sendLeaseChanged(client: WsClient, sessionId: TerminalSessionId): void {
		const leaseMgr = this.leases.get(sessionId);
		if (!leaseMgr) return;
		this.sendEnvelope(
			client,
			MESSAGE_TYPES.LEASE_CHANGED,
			{
				state: leaseMgr.getSummary(client.deviceId),
			},
			undefined,
			sessionId,
		);
	}

	sendTerminalState(
		client: WsClient,
		sessionId: TerminalSessionId,
		state: string,
		previousState?: string,
		reasonCode?: string,
	): void {
		this.sendEnvelope(
			client,
			MESSAGE_TYPES.TERMINAL_STATE,
			{
				previousState,
				state,
				changedAt: new Date().toISOString(),
				reasonCode,
			},
			undefined,
			sessionId,
		);
	}

	sendTerminalWarning(client: WsClient, sessionId: TerminalSessionId, code: string, message: string): void {
		this.sendEnvelope(client, MESSAGE_TYPES.TERMINAL_WARNING, { code, message }, undefined, sessionId);
	}

	sendTerminalFailure(client: WsClient, sessionId: TerminalSessionId, error: ProtocolError): void {
		this.sendEnvelope(client, MESSAGE_TYPES.TERMINAL_FAILURE, { error: error.toJSON() }, undefined, sessionId);
	}

	getClientByConnectionId(connectionId: string): WsClient | undefined {
		return this.clients.get(connectionId);
	}

	getAttachment(sessionId: TerminalSessionId) {
		return this.attachments.getAttachment(sessionId);
	}

	close(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		for (const client of this.clients.values()) {
			client.ws.close(CLOSE_CODES.NORMAL, "Server shutting down");
		}
		this.clients.clear();
		this.wss.close();
	}
}
