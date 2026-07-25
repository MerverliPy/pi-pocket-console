import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthManager } from "./auth.ts";
import { PairingError } from "./auth.ts";
import type { AuditLogger } from "./audit.ts";
import type {
	AcquireLeaseResponse,
	ApiFailure,
	ApiSuccess,
	AuthSessionState,
	CreateTerminalResponse,
	DiagnosticsSummary,
	PairingCompleteResponse,
	PairingStatus,
	ReleaseLeaseResponse,
	TerminalSummary,
	TerminateTerminalResponse,
	TransferLeaseResponse,
	WorkspaceSummary,
} from "./protocol/types.ts";

interface RateBucket {
	count: number;
	resetAt: number;
}

export interface RouterDeps {
	auth: AuthManager;
	audit: AuditLogger;
	workspaceRoot: string;
	workspaceName: string;
	secureCookie: boolean;
	bodyLimit: number;
	rateWindowMs: number;
	rateMaxRequests: number;
}

function sendApiSuccess<T>(response: ServerResponse, requestId: string, data: T, status = 200): void {
	const body: ApiSuccess<T> = { ok: true, requestId, data };
	response.statusCode = status;
	response.setHeader("Cache-Control", "no-store");
	response.setHeader("Content-Type", "application/json; charset=utf-8");
	response.end(JSON.stringify(body));
}

function sendApiFailure(
	response: ServerResponse,
	requestId: string,
	code: string,
	message: string,
	status: number,
): void {
	const body: ApiFailure = {
		ok: false,
		requestId,
		error: { code, message, impact: "Request rejected", executed: "no", retryable: false },
	};
	response.statusCode = status;
	response.setHeader("Cache-Control", "no-store");
	response.setHeader("Content-Type", "application/json; charset=utf-8");
	response.end(JSON.stringify(body));
}

function extractRequestId(headers: Record<string, string | string[] | undefined>): string {
	const raw = headers["x-request-id"];
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (typeof value === "string" && value.length > 0 && value.length <= 256 && /^[\x20-\x7e]+$/.test(value)) {
		return value;
	}
	return randomUUID();
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, name: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 256) {
		throw { code: "INVALID_REQUEST", message: `Invalid or missing ${name}`, status: 400 };
	}
	return value;
}

function requirePositiveInt(value: unknown, name: string, max: number): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > max) {
		throw { code: "INVALID_REQUEST", message: `Invalid ${name}`, status: 400 };
	}
	return value;
}

async function readJsonBody(request: IncomingMessage, limit: number): Promise<unknown> {
	const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
	if (contentType !== "application/json") {
		throw { code: "INVALID_REQUEST", message: "Content-Type must be application/json", status: 415 };
	}

	return new Promise<unknown>((resolve, reject) => {
		let settled = false;
		let size = 0;
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => {
			if (settled) return;
			size += chunk.length;
			if (size > limit) {
				settled = true;
				reject({ code: "MESSAGE_TOO_LARGE", message: "Request body too large", status: 413 });
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => {
			if (settled) return;
			settled = true;
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject({ code: "INVALID_REQUEST", message: "Invalid JSON", status: 400 });
			}
		});
		request.on("error", (error) => {
			if (!settled) {
				settled = true;
				reject(error);
			}
		});
	});
}

export class ApiRouter {
	private readonly deps: RouterDeps;
	private readonly rateBuckets = new Map<string, RateBucket>();
	private readonly pairingAttempts = new Map<string, RateBucket>();
	private readonly idempotencyStore = new Map<string, { result: unknown; timestamp: number }>();
	private readonly idempotencyWindowMs = 60_000;

	constructor(deps: RouterDeps) {
		this.deps = deps;
	}

	private checkRateLimit(key: string): void {
		const now = Date.now();
		const bucket = this.rateBuckets.get(key) ?? { count: 0, resetAt: now + this.deps.rateWindowMs };
		if (now > bucket.resetAt) {
			bucket.count = 0;
			bucket.resetAt = now + this.deps.rateWindowMs;
		}
		if (bucket.count >= this.deps.rateMaxRequests) {
			throw { code: "INPUT_RATE_LIMIT", message: "Too many requests", status: 429 };
		}
		bucket.count += 1;
		this.rateBuckets.set(key, bucket);
	}

	private checkPairingLimit(address: string): void {
		const now = Date.now();
		const bucket = this.pairingAttempts.get(address) ?? { count: 0, resetAt: now + 600_000 };
		if (now > bucket.resetAt) {
			bucket.count = 0;
			bucket.resetAt = now + 600_000;
		}
		if (bucket.count >= 5) {
			throw { code: "PAIRING_RATE_LIMITED", message: "Too many pairing attempts", status: 429 };
		}
		bucket.count += 1;
		this.pairingAttempts.set(address, bucket);
	}

	private setIdempotent(key: string, result: unknown): void {
		this.idempotencyStore.set(key, { result, timestamp: Date.now() });
	}

	private getIdempotent(key: string): unknown | undefined {
		const entry = this.idempotencyStore.get(key);
		if (!entry) return undefined;
		if (Date.now() - entry.timestamp > this.idempotencyWindowMs) {
			this.idempotencyStore.delete(key);
			return undefined;
		}
		return entry.result;
	}

	async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
		const method = request.method ?? "GET";
		const requestId = extractRequestId(request.headers);
		const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

		try {
			if (pathname === "/api/v1/pairing/status" && method === "GET") {
				return this.handlePairingStatus(response, requestId, request.socket.remoteAddress ?? "unknown");
			}
			if (pathname === "/api/v1/pairing/complete" && method === "POST") {
				return await this.handlePairingComplete(request, response, requestId);
			}
			if (pathname === "/api/v1/auth/session" && method === "GET") {
				return this.handleAuthSession(request, response, requestId);
			}
			if (pathname === "/api/v1/auth/logout" && method === "POST") {
				return this.handleAuthLogout(request, response, requestId);
			}
			if (pathname === "/api/v1/diagnostics" && method === "GET") {
				return this.handleDiagnostics(request, response, requestId);
			}

			const session = this.deps.auth.authenticate(request.headers.cookie);
			if (!session) {
				sendApiFailure(response, requestId, "AUTH_REQUIRED", "Authentication required", 401);
				return true;
			}

			if (method === "POST") {
				this.checkRateLimit(session.id);
			}

			if (
				method === "POST" &&
				!this.deps.auth.verifyCsrf(session, request.headers["x-csrf-token"] as string | undefined)
			) {
				sendApiFailure(response, requestId, "CSRF_REJECTED", "CSRF token is invalid", 403);
				return true;
			}

			if (pathname === "/api/v1/workspaces" && method === "GET") {
				return this.handleListWorkspaces(response, requestId);
			}
			if (pathname === "/api/v1/terminals" && method === "GET") {
				return this.handleListTerminals(response, requestId);
			}
			if (pathname === "/api/v1/terminals" && method === "POST") {
				return await this.handleCreateTerminal(request, response, requestId);
			}

			const terminalMatch = /^\/api\/v1\/terminals\/([A-Za-z0-9_-]{1,128})$/.exec(pathname);
			if (terminalMatch && method === "GET") {
				return this.handleTerminalDetails(terminalMatch[1], response, requestId);
			}

			const terminateMatch = /^\/api\/v1\/terminals\/([A-Za-z0-9_-]{1,128})\/terminate$/.exec(pathname);
			if (terminateMatch && method === "POST") {
				return await this.handleTerminateTerminal(terminateMatch[1], request, response, requestId);
			}

			const leaseAcquireMatch = /^\/api\/v1\/terminals\/([A-Za-z0-9_-]{1,128})\/lease\/acquire$/.exec(pathname);
			if (leaseAcquireMatch && method === "POST") {
				return await this.handleLeaseAcquire(leaseAcquireMatch[1], request, response, requestId);
			}

			const leaseTransferMatch = /^\/api\/v1\/terminals\/([A-Za-z0-9_-]{1,128})\/lease\/transfer$/.exec(pathname);
			if (leaseTransferMatch && method === "POST") {
				return await this.handleLeaseTransfer(leaseTransferMatch[1], request, response, requestId);
			}

			const leaseReleaseMatch = /^\/api\/v1\/terminals\/([A-Za-z0-9_-]{1,128})\/lease\/release$/.exec(pathname);
			if (leaseReleaseMatch && method === "POST") {
				return await this.handleLeaseRelease(leaseReleaseMatch[1], request, response, requestId);
			}

			return false;
		} catch (error) {
			if (response.headersSent) {
				response.end();
				return true;
			}
			const err = error as { code?: string; message?: string; status?: number };
			if (err.status && err.code) {
				sendApiFailure(response, requestId, err.code, err.message ?? "Request failed", err.status);
				return true;
			}
			if (error instanceof PairingError) {
				sendApiFailure(response, requestId, "PAIRING_CODE_INVALID", error.message, error.status);
				return true;
			}
			console.error("API router error:", error instanceof Error ? error.message : String(error));
			sendApiFailure(response, requestId, "INTERNAL_ERROR", "Internal server error", 500);
			return true;
		}
	}

	private handlePairingStatus(response: ServerResponse, requestId: string, _address: string): true {
		this.checkRateLimit("pairing-status");
		const body: ApiSuccess<PairingStatus> = {
			ok: true,
			requestId,
			data: {
				privateConnection: "verified",
				hostIdentity: this.deps.workspaceName,
				gatewayAvailable: true,
				pairingAvailable: true,
				codeRequired: true,
			},
		};
		response.statusCode = 200;
		response.setHeader("Cache-Control", "no-store");
		response.setHeader("Content-Type", "application/json; charset=utf-8");
		response.end(JSON.stringify(body));
		return true;
	}

	private async handlePairingComplete(
		request: IncomingMessage,
		response: ServerResponse,
		requestId: string,
	): Promise<true> {
		const body = await readJsonBody(request, this.deps.bodyLimit);
		if (!isObject(body)) {
			throw { code: "INVALID_REQUEST", message: "Invalid request body", status: 400 };
		}
		const address = request.socket.remoteAddress ?? "unknown";
		this.checkPairingLimit(address);
		const code = requireString(body.code, "pairing code");
		const deviceLabel = requireString(body.deviceLabel, "device label");

		const session = this.deps.auth.pair(code, address);
		this.deps.audit.info("PAIRING_COMPLETE", `Device paired: ${deviceLabel}`);

		response.setHeader("Set-Cookie", this.deps.auth.sessionCookie(session));
		sendApiSuccess<PairingCompleteResponse>(
			response,
			requestId,
			{
				deviceId: session.id,
				deviceLabel,
				sessionIssuedAt: new Date().toISOString(),
				sessionExpiresAt: new Date(Date.now() + 12 * 60 * 60_000).toISOString(),
			},
			200,
		);
		return true;
	}

	private handleAuthSession(request: IncomingMessage, response: ServerResponse, requestId: string): true {
		const session = this.deps.auth.authenticate(request.headers.cookie);
		const data: AuthSessionState = session
			? {
					authenticated: true,
					deviceId: session.id,
					issuedAt: new Date().toISOString(),
					expiresAt: new Date(Date.now() + 12 * 60 * 60_000).toISOString(),
				}
			: { authenticated: false };
		sendApiSuccess(response, requestId, data);
		return true;
	}

	private handleAuthLogout(request: IncomingMessage, response: ServerResponse, requestId: string): true {
		const session = this.deps.auth.authenticate(request.headers.cookie);
		if (session) {
			this.deps.auth.revoke(session);
			this.deps.audit.info("SESSION_LOGOUT", `Session ${session.id} logged out`);
		}
		response.setHeader("Set-Cookie", this.deps.auth.clearCookie());
		sendApiSuccess(response, requestId, { ok: true }, 200);
		return true;
	}

	private handleListWorkspaces(response: ServerResponse, requestId: string): true {
		const data: WorkspaceSummary[] = [
			{
				id: this.deps.workspaceRoot,
				displayName: this.deps.workspaceName,
				enabled: true,
				allowedLaunchers: ["default-shell"],
			},
		];
		sendApiSuccess(response, requestId, data);
		return true;
	}

	private handleListTerminals(response: ServerResponse, requestId: string): true {
		sendApiSuccess<TerminalSummary[]>(response, requestId, []);
		return true;
	}

	private async handleCreateTerminal(
		request: IncomingMessage,
		response: ServerResponse,
		requestId: string,
	): Promise<true> {
		const body = await readJsonBody(request, this.deps.bodyLimit);
		if (!isObject(body)) {
			throw { code: "INVALID_REQUEST", message: "Invalid request body", status: 400 };
		}

		const workspaceId = requireString(body.workspaceId, "workspaceId");
		const launcherId = requireString(body.launcherId, "launcherId");
		const _cols = requirePositiveInt(body.cols, "cols", 500);
		const _rows = requirePositiveInt(body.rows, "rows", 200);
		const clientRequestId = requireString(body.clientRequestId, "clientRequestId");

		if (launcherId !== "default-shell") {
			throw { code: "INVALID_LAUNCHER", message: "Only default-shell launcher is enabled", status: 400 };
		}

		const cached = this.getIdempotent(clientRequestId);
		if (cached) {
			sendApiSuccess(response, requestId, cached as CreateTerminalResponse, 201);
			return true;
		}

		const now = new Date().toISOString();
		const result: CreateTerminalResponse = {
			session: {
				sessionId: randomUUID(),
				workspaceId,
				launcherId: launcherId as TerminalSummary["launcherId"],
				state: "CREATING",
				createdAt: now,
				lastActivityAt: now,
				lease: { state: "none" },
			},
			websocketPath: "/api/v1/ws",
		};

		this.deps.audit.info("TERMINAL_CREATED", `Terminal ${result.session.sessionId} created with launcher ${launcherId}`);
		this.setIdempotent(clientRequestId, result);
		sendApiSuccess(response, requestId, result, 201);
		return true;
	}

	private handleTerminalDetails(sessionId: string, response: ServerResponse, requestId: string): true {
		sendApiFailure(response, requestId, "TERMINAL_NOT_FOUND", `Terminal ${sessionId} not found`, 404);
		return true;
	}

	private async handleTerminateTerminal(
		_sessionId: string,
		request: IncomingMessage,
		response: ServerResponse,
		requestId: string,
	): Promise<true> {
		const body = await readJsonBody(request, this.deps.bodyLimit);
		if (!isObject(body)) {
			throw { code: "INVALID_REQUEST", message: "Invalid request body", status: 400 };
		}
		const mode = requireString(body.mode, "mode") as "graceful" | "force";
		if (mode !== "graceful" && mode !== "force") {
			throw { code: "INVALID_REQUEST", message: "mode must be graceful or force", status: 400 };
		}
		const clientRequestId = requireString(body.clientRequestId, "clientRequestId");

		const cached = this.getIdempotent(clientRequestId);
		if (cached) {
			sendApiSuccess(response, requestId, cached as TerminateTerminalResponse);
			return true;
		}

		this.deps.audit.info("TERMINAL_TERMINATE_REQUESTED", `Terminal termination requested (mode: ${mode})`);
		const result: TerminateTerminalResponse = { accepted: true, state: "TERMINATING" };
		this.setIdempotent(clientRequestId, result);
		sendApiSuccess(response, requestId, result);
		return true;
	}

	private async handleLeaseAcquire(
		sessionId: string,
		request: IncomingMessage,
		response: ServerResponse,
		requestId: string,
	): Promise<true> {
		const body = await readJsonBody(request, this.deps.bodyLimit);
		if (!isObject(body)) {
			throw { code: "INVALID_REQUEST", message: "Invalid request body", status: 400 };
		}
		const clientRequestId = requireString(body.clientRequestId, "clientRequestId");

		const cached = this.getIdempotent(clientRequestId);
		if (cached) {
			sendApiSuccess(response, requestId, cached as AcquireLeaseResponse);
			return true;
		}

		const now = new Date().toISOString();
		const result: AcquireLeaseResponse = {
			lease: {
				leaseId: randomUUID(),
				sessionId,
				deviceId: randomUUID(),
				generation: 1,
				issuedAt: now,
				expiresAt: new Date(Date.now() + 300_000).toISOString(),
			},
		};

		this.setIdempotent(clientRequestId, result);
		sendApiSuccess(response, requestId, result);
		return true;
	}

	private async handleLeaseTransfer(
		sessionId: string,
		request: IncomingMessage,
		response: ServerResponse,
		requestId: string,
	): Promise<true> {
		const body = await readJsonBody(request, this.deps.bodyLimit);
		if (!isObject(body)) {
			throw { code: "INVALID_REQUEST", message: "Invalid request body", status: 400 };
		}
		const targetDeviceId = requireString(body.targetDeviceId, "targetDeviceId");
		const clientRequestId = requireString(body.clientRequestId, "clientRequestId");
		if (typeof body.expectedGeneration !== "number" || body.expectedGeneration < 0) {
			throw { code: "INVALID_REQUEST", message: "Invalid expectedGeneration", status: 400 };
		}

		const cached = this.getIdempotent(clientRequestId);
		if (cached) {
			sendApiSuccess(response, requestId, cached as TransferLeaseResponse);
			return true;
		}

		const now = new Date().toISOString();
		const result: TransferLeaseResponse = {
			lease: {
				leaseId: randomUUID(),
				sessionId,
				deviceId: targetDeviceId,
				generation: body.expectedGeneration + 1,
				issuedAt: now,
				expiresAt: new Date(Date.now() + 300_000).toISOString(),
			},
		};

		this.setIdempotent(clientRequestId, result);
		sendApiSuccess(response, requestId, result);
		return true;
	}

	private async handleLeaseRelease(
		_sessionId: string,
		request: IncomingMessage,
		response: ServerResponse,
		requestId: string,
	): Promise<true> {
		const body = await readJsonBody(request, this.deps.bodyLimit);
		if (!isObject(body)) {
			throw { code: "INVALID_REQUEST", message: "Invalid request body", status: 400 };
		}
		const clientRequestId = requireString(body.clientRequestId, "clientRequestId");
		if (typeof body.expectedGeneration !== "number" || body.expectedGeneration < 0) {
			throw { code: "INVALID_REQUEST", message: "Invalid expectedGeneration", status: 400 };
		}

		const cached = this.getIdempotent(clientRequestId);
		if (cached) {
			sendApiSuccess(response, requestId, cached as ReleaseLeaseResponse);
			return true;
		}

		const result: ReleaseLeaseResponse = { released: true, generation: body.expectedGeneration + 1 };
		this.setIdempotent(clientRequestId, result);
		sendApiSuccess(response, requestId, result);
		return true;
	}

	private handleDiagnostics(request: IncomingMessage, response: ServerResponse, requestId: string): true {
		const session = this.deps.auth.authenticate(request.headers.cookie);
		let tailscaleServe = false;
		let tailscaleFunnel = false;
		try {
			const out = execSync("tailscale serve status 2>/dev/null || true", {
				encoding: "utf8",
				timeout: 3000,
			});
			tailscaleServe = out.includes("https://");
			tailscaleFunnel = out.toLowerCase().includes("funnel");
		} catch {
			// tailscale not installed
		}
		const recentEvents = this.deps.audit.getRecent(20).map((e) => ({
			eventId: e.eventId,
			timestamp: e.timestamp,
			severity: e.severity,
			code: e.code,
			message: e.message,
			safeNextAction: e.safeNextAction,
		}));
		const data: DiagnosticsSummary = {
			gateway: {
				status: "healthy",
				boundAddress: "127.0.0.1",
			},
			tailscale: {
				serveConfigured: tailscaleServe,
				funnelEnabled: tailscaleFunnel,
			},
			authentication: {
				authenticated: session !== undefined,
				expiresAt: undefined,
			},
			terminalLimits: {
				activeForDevice: 0,
				activeGlobal: 0,
			},
			redactedEvents: recentEvents,
		};
		sendApiSuccess(response, requestId, data);
		return true;
	}
}
