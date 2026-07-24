import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { RpcCommand, RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import { AuthManager, PairingError } from "./auth.ts";
import { ControllerLeases } from "./controller-lease.ts";
import { type InstanceController, InstanceManager, type InstanceSummary } from "./instance-manager.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 31_415;
const DEFAULT_BODY_LIMIT = 3 * 1024 * 1024;
const MAX_IMAGE_COUNT = 3;
const MAX_IMAGE_BYTES = 640 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 1_920 * 1024;
const MAX_SSE_HISTORY_BYTES = 2 * 1024 * 1024;
const MAX_SSE_HISTORY_EVENTS = 256;
const MAX_SSE_CLIENT_BUFFER_BYTES = 1024 * 1024;
const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
	"Content-Security-Policy":
		"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Resource-Policy": "same-origin",
	"Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
};

const ALLOWED_COMMANDS: ReadonlySet<RpcCommand["type"]> = new Set([
	"prompt",
	"steer",
	"follow_up",
	"abort",
	"new_session",
	"get_state",
	"set_model",
	"cycle_model",
	"get_available_models",
	"set_thinking_level",
	"cycle_thinking_level",
	"get_available_thinking_levels",
	"set_steering_mode",
	"set_follow_up_mode",
	"compact",
	"set_auto_compaction",
	"set_auto_retry",
	"abort_retry",
	"bash",
	"abort_bash",
	"get_session_stats",
	"export_html",
	"switch_session",
	"fork",
	"clone",
	"get_fork_messages",
	"get_entries",
	"get_tree",
	"get_last_assistant_text",
	"set_session_name",
	"get_messages",
	"get_commands",
]);

interface TlsOptions {
	cert: string | Buffer;
	key: string | Buffer;
}

export interface PocketServerOptions {
	workspaceRoot: string;
	host?: string;
	port?: number;
	publicOrigin?: string;
	localInsecure?: boolean;
	tls?: TlsOptions;
	publicDir?: string;
	bodyLimitBytes?: number;
	controllerLeaseMs?: number;
	instanceController?: InstanceController;
}

export interface PocketServer {
	readonly host: string;
	readonly port: number;
	readonly origin: string;
	readonly pairingCode: string;
	readonly workspaceRoot: string;
	close(): Promise<void>;
}

class HttpError extends Error {
	readonly status: number;
	readonly code?: string;
	readonly headers?: Readonly<Record<string, string>>;

	constructor(message: string, status: number, code?: string, headers?: Readonly<Record<string, string>>) {
		super(message);
		this.status = status;
		this.code = code;
		this.headers = headers;
	}
}

interface EventEntry {
	id: number;
	data: string;
	bytes: number;
}

interface StreamClient {
	response: ServerResponse;
	owner: string;
}

interface InstanceStream {
	nextId: number;
	history: EventEntry[];
	historyBytes: number;
	clients: Set<StreamClient>;
	unsubscribe: () => void;
}

class StreamHub {
	private readonly streams = new Map<string, InstanceStream>();
	private readonly keepAliveTimer: NodeJS.Timeout;

	constructor(
		private readonly controller: InstanceController,
		private readonly leases: ControllerLeases,
		private readonly isOwnerActive: (owner: string) => boolean,
	) {
		this.keepAliveTimer = setInterval(() => {
			for (const [instanceId, stream] of this.streams) {
				for (const client of stream.clients) {
					if (
						!this.isOwnerActive(client.owner) ||
						client.response.destroyed ||
						client.response.writableEnded ||
						client.response.writableLength > MAX_SSE_CLIENT_BUFFER_BYTES
					) {
						client.response.end();
						stream.clients.delete(client);
						this.leases.release(instanceId, client.owner);
						continue;
					}
					this.leases.claim(instanceId, client.owner);
					client.response.write(": keepalive\n\n");
				}
			}
		}, 15_000);
		this.keepAliveTimer.unref();
	}

	attach(
		instance: InstanceSummary,
		owner: string,
		response: ServerResponse,
		lastEventId: number | undefined,
	): () => void {
		let stream = this.streams.get(instance.id);
		if (!stream) {
			const clients = new Set<StreamClient>();
			const history: EventEntry[] = [];
			const unsubscribe = this.controller.subscribe(instance.id, (message) => {
				const current = this.streams.get(instance.id);
				if (!current) {
					return;
				}
				const data = JSON.stringify(message);
				const entry = { id: current.nextId++, data, bytes: Buffer.byteLength(data) };
				if (entry.bytes <= MAX_SSE_HISTORY_BYTES) {
					while (
						current.history.length > 0 &&
						(current.history.length >= MAX_SSE_HISTORY_EVENTS ||
							current.historyBytes + entry.bytes > MAX_SSE_HISTORY_BYTES)
					) {
						const removed = current.history.shift();
						if (removed) {
							current.historyBytes -= removed.bytes;
						}
					}
					current.history.push(entry);
					current.historyBytes += entry.bytes;
				}
				for (const client of current.clients) {
					if (
						client.response.destroyed ||
						client.response.writableEnded ||
						client.response.writableLength > MAX_SSE_CLIENT_BUFFER_BYTES
					) {
						client.response.end();
						current.clients.delete(client);
						continue;
					}
					writeSseData(client.response, entry.id, "message", data);
				}
			});
			if (!unsubscribe) {
				throw new HttpError("Unknown instance", 404, "unknown_instance");
			}
			stream = { nextId: 1, history, historyBytes: 0, clients, unsubscribe };
			this.streams.set(instance.id, stream);
		}

		const client = { response, owner };
		stream.clients.add(client);
		writeSse(response, undefined, "snapshot", { type: "instance_snapshot", instance });
		if (lastEventId !== undefined) {
			for (const entry of stream.history) {
				if (entry.id > lastEventId) {
					writeSseData(response, entry.id, "message", entry.data);
				}
			}
		}
		return () => {
			stream?.clients.delete(client);
		};
	}

	closeInstance(instanceId: string): void {
		const stream = this.streams.get(instanceId);
		if (!stream) {
			return;
		}
		stream.unsubscribe();
		for (const client of stream.clients) {
			client.response.end();
		}
		this.streams.delete(instanceId);
	}

	closeOwner(owner: string): void {
		for (const [instanceId, stream] of this.streams) {
			for (const client of stream.clients) {
				if (client.owner !== owner) {
					continue;
				}
				client.response.end();
				stream.clients.delete(client);
			}
			this.leases.release(instanceId, owner);
		}
	}

	close(): void {
		clearInterval(this.keepAliveTimer);
		for (const instanceId of [...this.streams.keys()]) {
			this.closeInstance(instanceId);
		}
	}
}

function writeSse(response: ServerResponse, id: number | undefined, event: string, data: unknown): void {
	writeSseData(response, id, event, JSON.stringify(data));
}

function writeSseData(response: ServerResponse, id: number | undefined, event: string, data: string): void {
	if (id !== undefined) {
		response.write(`id: ${id}\n`);
	}
	response.write(`event: ${event}\n`);
	response.write(`data: ${data}\n\n`);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, name: string, maxLength = 262_144): string {
	if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
		throw new HttpError(`Invalid ${name}`, 400, "invalid_request");
	}
	return value;
}

function optionalString(value: unknown, name: string, maxLength = 262_144): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	return requireString(value, name, maxLength);
}

function validateImages(value: unknown): void {
	if (value === undefined) {
		return;
	}
	if (!Array.isArray(value) || value.length > MAX_IMAGE_COUNT) {
		throw new HttpError(`Images must be an array of at most ${MAX_IMAGE_COUNT} items`, 400, "invalid_images");
	}

	let totalBytes = 0;
	for (const image of value) {
		if (
			!isObject(image) ||
			image.type !== "image" ||
			typeof image.mimeType !== "string" ||
			!ALLOWED_IMAGE_TYPES.has(image.mimeType) ||
			typeof image.data !== "string" ||
			image.data.length === 0 ||
			image.data.length % 4 !== 0 ||
			!/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)
		) {
			throw new HttpError("Invalid image payload", 400, "invalid_images");
		}
		const padding = image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0;
		const decodedBytes = (image.data.length / 4) * 3 - padding;
		if (decodedBytes > MAX_IMAGE_BYTES) {
			throw new HttpError(`Each image must be at most ${MAX_IMAGE_BYTES} bytes`, 413, "image_too_large");
		}
		totalBytes += decodedBytes;
		if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
			throw new HttpError("Combined image payload is too large", 413, "images_too_large");
		}
	}
}

function validateCommand(value: unknown): RpcCommand {
	if (!isObject(value) || typeof value.type !== "string" || !ALLOWED_COMMANDS.has(value.type as RpcCommand["type"])) {
		throw new HttpError("Command is not allowed", 403, "command_not_allowed");
	}
	optionalString(value.id, "command id", 128);

	switch (value.type) {
		case "prompt":
		case "steer":
		case "follow_up":
			requireString(value.message, "message");
			validateImages(value.images);
			if (
				value.type === "prompt" &&
				value.streamingBehavior !== undefined &&
				value.streamingBehavior !== "steer" &&
				value.streamingBehavior !== "followUp"
			) {
				throw new HttpError("Invalid streaming behavior", 400, "invalid_request");
			}
			break;
		case "set_model":
			requireString(value.provider, "provider", 128);
			requireString(value.modelId, "modelId", 256);
			break;
		case "set_thinking_level":
			if (!["off", "minimal", "low", "medium", "high", "xhigh"].includes(String(value.level))) {
				throw new HttpError("Invalid thinking level", 400, "invalid_request");
			}
			break;
		case "set_steering_mode":
		case "set_follow_up_mode":
			if (value.mode !== "all" && value.mode !== "one-at-a-time") {
				throw new HttpError("Invalid queue mode", 400, "invalid_request");
			}
			break;
		case "set_auto_compaction":
		case "set_auto_retry":
			if (typeof value.enabled !== "boolean") {
				throw new HttpError("Invalid enabled value", 400, "invalid_request");
			}
			break;
		case "bash":
			requireString(value.command, "command", 65_536);
			if (value.excludeFromContext !== undefined && typeof value.excludeFromContext !== "boolean") {
				throw new HttpError("Invalid excludeFromContext value", 400, "invalid_request");
			}
			break;
		case "export_html":
			optionalString(value.outputPath, "outputPath");
			break;
		case "switch_session":
			requireString(value.sessionPath, "sessionPath");
			break;
		case "fork":
			requireString(value.entryId, "entryId", 256);
			break;
		case "set_session_name":
			requireString(value.name, "name", 256);
			break;
		case "get_entries":
			optionalString(value.since, "since", 256);
			break;
		case "new_session":
			optionalString(value.parentSession, "parentSession");
			break;
		case "compact":
			optionalString(value.customInstructions, "customInstructions");
			break;
	}
	return value as unknown as RpcCommand;
}

function validateUiResponse(value: unknown): RpcExtensionUIResponse {
	if (!isObject(value) || value.type !== "extension_ui_response") {
		throw new HttpError("Invalid UI response", 400, "invalid_request");
	}
	requireString(value.id, "UI response id", 256);
	const validValue = typeof value.value === "string";
	const validConfirmed = typeof value.confirmed === "boolean";
	const validCancelled = value.cancelled === true;
	if (Number(validValue) + Number(validConfirmed) + Number(validCancelled) !== 1) {
		throw new HttpError("Invalid UI response value", 400, "invalid_request");
	}
	return value as unknown as RpcExtensionUIResponse;
}

function applySecurityHeaders(response: ServerResponse, secure: boolean): void {
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		response.setHeader(name, value);
	}
	if (secure) {
		response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	}
}

function sendJson(
	response: ServerResponse,
	status: number,
	body: unknown,
	headers: Readonly<Record<string, string>> = {},
): void {
	response.statusCode = status;
	response.setHeader("Cache-Control", "no-store");
	response.setHeader("Content-Type", "application/json; charset=utf-8");
	for (const [name, value] of Object.entries(headers)) {
		response.setHeader(name, value);
	}
	response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
	const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
	if (contentType !== "application/json") {
		throw new HttpError("Content-Type must be application/json", 415, "unsupported_media_type");
	}
	const contentLength = Number(request.headers["content-length"]);
	if (Number.isFinite(contentLength) && contentLength > limit) {
		throw new HttpError("Request body is too large", 413, "body_too_large");
	}

	return new Promise<unknown>((resolveBody, rejectBody) => {
		let settled = false;
		let size = 0;
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => {
			if (settled) {
				return;
			}
			size += chunk.length;
			if (size > limit) {
				settled = true;
				rejectBody(new HttpError("Request body is too large", 413, "body_too_large"));
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => {
			if (settled) {
				return;
			}
			settled = true;
			try {
				resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				rejectBody(new HttpError("Invalid JSON", 400, "invalid_json"));
			}
		});
		request.on("error", (error) => {
			if (!settled) {
				settled = true;
				rejectBody(error);
			}
		});
	});
}

function normalizeOrigin(value: string): string {
	const url = new URL(value);
	if ((url.protocol !== "https:" && url.protocol !== "http:") || url.pathname !== "/" || url.search || url.hash) {
		throw new Error("publicOrigin must be an HTTP(S) origin without a path, query, or fragment");
	}
	return url.origin;
}

function isLoopback(host: string): boolean {
	return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function hostForUrl(host: string): string {
	return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function parseInstanceRoute(pathname: string): { instanceId: string; action?: string } | undefined {
	const match = /^\/api\/instances\/([A-Za-z0-9_-]{1,128})(?:\/([a-z-]+))?$/.exec(pathname);
	return match ? { instanceId: match[1], action: match[2] } : undefined;
}

function contentType(filePath: string): string {
	switch (extname(filePath).toLowerCase()) {
		case ".css":
			return "text/css; charset=utf-8";
		case ".html":
			return "text/html; charset=utf-8";
		case ".js":
			return "text/javascript; charset=utf-8";
		case ".json":
		case ".webmanifest":
			return "application/manifest+json; charset=utf-8";
		case ".png":
			return "image/png";
		case ".svg":
			return "image/svg+xml";
		case ".woff2":
			return "font/woff2";
		default:
			return "application/octet-stream";
	}
}

async function serveStatic(
	request: IncomingMessage,
	response: ServerResponse,
	publicDir: string,
	pathname: string,
): Promise<void> {
	let decodedPath: string;
	try {
		decodedPath = decodeURIComponent(pathname);
	} catch {
		throw new HttpError("Invalid path", 400, "invalid_path");
	}
	if (decodedPath.includes("\0")) {
		throw new HttpError("Invalid path", 400, "invalid_path");
	}

	const requested = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
	let candidate = resolve(publicDir, requested);
	if (candidate !== publicDir && !candidate.startsWith(`${publicDir}${sep}`)) {
		throw new HttpError("Invalid path", 400, "invalid_path");
	}

	try {
		const candidateInfo = await stat(candidate);
		if (!candidateInfo.isFile()) {
			throw new Error("not a file");
		}
		const canonical = await realpath(candidate);
		if (!canonical.startsWith(`${publicDir}${sep}`)) {
			throw new HttpError("Invalid path", 400, "invalid_path");
		}
		candidate = canonical;
	} catch (error) {
		if (error instanceof HttpError) {
			throw error;
		}
		if (extname(requested)) {
			throw new HttpError("Not found", 404, "not_found");
		}
		candidate = resolve(publicDir, "index.html");
	}

	const body = await readFile(candidate);
	response.statusCode = 200;
	response.setHeader("Cache-Control", candidate.endsWith("index.html") ? "no-cache" : "public, max-age=3600");
	response.setHeader("Content-Type", contentType(candidate));
	if (candidate.endsWith("sw.js")) {
		response.setHeader("Service-Worker-Allowed", "/");
	}
	response.setHeader("Content-Length", body.length);
	if (request.method === "HEAD") {
		response.end();
		return;
	}
	response.end(body);
}

export async function startPocketServer(options: PocketServerOptions): Promise<PocketServer> {
	const host = options.host ?? DEFAULT_HOST;
	const requestedPort = options.port ?? DEFAULT_PORT;
	const localInsecure = options.localInsecure === true;
	if (localInsecure && options.tls) {
		throw new Error("localInsecure cannot be combined with native TLS");
	}
	if (localInsecure && !isLoopback(host)) {
		throw new Error("localInsecure may only bind to a loopback host");
	}
	if (!options.tls && !localInsecure && !isLoopback(host)) {
		throw new Error("Without native TLS, the server must bind to loopback behind a private TLS proxy");
	}

	const workspaceRoot = await realpath(resolve(options.workspaceRoot));
	if (!(await stat(workspaceRoot)).isDirectory()) {
		throw new Error(`Workspace root is not a directory: ${workspaceRoot}`);
	}
	const publicDir = await realpath(
		resolve(options.publicDir ?? resolve(dirname(fileURLToPath(import.meta.url)), "../public")),
	);
	if (!(await stat(publicDir)).isDirectory()) {
		throw new Error(`Public directory is not a directory: ${publicDir}`);
	}

	const secureCookie = !localInsecure;
	const auth = new AuthManager(secureCookie);
	const controller = options.instanceController ?? new InstanceManager(workspaceRoot);
	const leases = new ControllerLeases(options.controllerLeaseMs);
	const streamHub = new StreamHub(controller, leases, (owner) => auth.isSessionActive(owner));
	const bodyLimit = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT;
	let expectedOrigin = options.publicOrigin ? normalizeOrigin(options.publicOrigin) : "";
	if (localInsecure && expectedOrigin && !expectedOrigin.startsWith("http://")) {
		throw new Error("localInsecure requires an http:// publicOrigin");
	}
	if (!localInsecure && expectedOrigin && !expectedOrigin.startsWith("https://")) {
		throw new Error("Secure operation requires an https:// publicOrigin");
	}
	if (!localInsecure && !options.tls && !expectedOrigin) {
		throw new Error("publicOrigin is required when TLS terminates at a private loopback proxy");
	}

	const requestHandler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
		applySecurityHeaders(response, secureCookie);
		try {
			const method = request.method ?? "GET";
			const pathname = new URL(request.url ?? "/", expectedOrigin).pathname;

			if (pathname.startsWith("/api/")) {
				if (method === "POST") {
					if (request.headers.origin !== expectedOrigin) {
						throw new HttpError("Origin is not allowed", 403, "origin_rejected");
					}
					const fetchSite = request.headers["sec-fetch-site"];
					if (fetchSite && fetchSite !== "same-origin") {
						throw new HttpError("Cross-site request rejected", 403, "origin_rejected");
					}
				}

				if (pathname === "/api/pair" && method === "POST") {
					const body = await readJson(request, bodyLimit);
					if (!isObject(body)) {
						throw new HttpError("Invalid request", 400, "invalid_request");
					}
					const session = auth.pair(
						requireString(body.code, "pairing code", 6),
						request.socket.remoteAddress ?? "unknown",
					);
					sendJson(
						response,
						200,
						{ ok: true, csrfToken: session.csrfToken },
						{ "Set-Cookie": auth.sessionCookie(session) },
					);
					return;
				}

				const session = auth.authenticate(request.headers.cookie);
				if (!session) {
					throw new HttpError("Authentication required", 401, "authentication_required");
				}
				if (method === "POST" && !auth.verifyCsrf(session, request.headers["x-csrf-token"] as string | undefined)) {
					throw new HttpError("CSRF token is invalid", 403, "csrf_rejected");
				}

				if (pathname === "/api/bootstrap" && method === "GET") {
					sendJson(response, 200, {
						authenticated: true,
						csrfToken: session.csrfToken,
						instances: controller.list(),
						workspaceRoot,
						workspaceName: basename(workspaceRoot),
						fullHostAccess: true,
						projectTrustOverride: false,
						providerCredentials: "host",
						controllerLeaseSeconds: Math.round((options.controllerLeaseMs ?? 45_000) / 1_000),
					});
					return;
				}
				if (pathname === "/api/instances" && method === "GET") {
					sendJson(response, 200, { instances: controller.list() });
					return;
				}
				if (pathname === "/api/instances" && method === "POST") {
					const body = await readJson(request, bodyLimit);
					if (!isObject(body) || body.cwd !== undefined) {
						throw new HttpError("Client-selected cwd is not allowed", 400, "fixed_workspace_required");
					}
					const label = optionalString(body.label, "label", 128);
					const instance = await controller.spawn(label);
					sendJson(response, 201, { instance });
					return;
				}
				if (pathname === "/api/logout" && method === "POST") {
					auth.revoke(session);
					streamHub.closeOwner(session.id);
					sendJson(response, 200, { ok: true }, { "Set-Cookie": auth.clearCookie() });
					return;
				}

				const instanceRoute = parseInstanceRoute(pathname);
				if (!instanceRoute) {
					throw new HttpError("Not found", 404, "not_found");
				}
				const instance = controller.status(instanceRoute.instanceId);
				if (!instance) {
					throw new HttpError("Unknown instance", 404, "unknown_instance");
				}

				if (!instanceRoute.action && method === "GET") {
					sendJson(response, 200, { instance });
					return;
				}
				if (instanceRoute.action === "stop" && method === "POST") {
					const stopped = await controller.stop(instance.id);
					streamHub.closeInstance(instance.id);
					leases.release(instance.id);
					sendJson(response, 200, { instance: stopped });
					return;
				}
				if (instanceRoute.action === "events" && method === "GET") {
					if (!leases.claim(instance.id, session.id)) {
						throw new HttpError("Another controller currently owns this instance", 409, "controller_in_use");
					}
					response.statusCode = 200;
					response.setHeader("Cache-Control", "no-store");
					response.setHeader("Connection", "keep-alive");
					response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
					response.setHeader("X-Accel-Buffering", "no");
					response.flushHeaders();
					response.write("retry: 2000\n\n");
					const rawLastEventId = request.headers["last-event-id"];
					const parsedLastEventId =
						typeof rawLastEventId === "string" && /^\d+$/.test(rawLastEventId) ? Number(rawLastEventId) : undefined;
					const detach = streamHub.attach(instance, session.id, response, parsedLastEventId);
					response.once("close", detach);
					return;
				}
				if ((instanceRoute.action === "messages" || instanceRoute.action === "commands") && method === "POST") {
					if (!leases.claim(instance.id, session.id)) {
						throw new HttpError("Another controller currently owns this instance", 409, "controller_in_use");
					}
					const body = await readJson(request, bodyLimit);
					const candidate =
						isObject(body) && typeof body.type === "string"
							? body
							: isObject(body) && "command" in body
								? body.command
								: isObject(body) && "message" in body
									? body.message
									: body;
					if (isObject(candidate) && candidate.type === "extension_ui_response") {
						if (instanceRoute.action === "commands") {
							throw new HttpError("Invalid command", 400, "invalid_request");
						}
						controller.sendUiResponse(instance.id, validateUiResponse(candidate));
						sendJson(response, 202, { ok: true });
						return;
					}
					const command = validateCommand(candidate);
					if (!command.id) {
						command.id = `mobile_${randomUUID()}`;
					}
					const rpcResponse = await controller.send(instance.id, command);
					sendJson(response, 200, { ok: true, commandId: command.id, response: rpcResponse });
					return;
				}
				if (instanceRoute.action === "ui-responses" && method === "POST") {
					if (!leases.claim(instance.id, session.id)) {
						throw new HttpError("Another controller currently owns this instance", 409, "controller_in_use");
					}
					const body = await readJson(request, bodyLimit);
					const candidate = isObject(body) && "response" in body ? body.response : body;
					controller.sendUiResponse(instance.id, validateUiResponse(candidate));
					sendJson(response, 202, { ok: true });
					return;
				}
				throw new HttpError("Method not allowed", 405, "method_not_allowed", { Allow: "GET, POST" });
			}

			if (method !== "GET" && method !== "HEAD") {
				throw new HttpError("Method not allowed", 405, "method_not_allowed", { Allow: "GET, HEAD" });
			}
			await serveStatic(request, response, publicDir, pathname);
		} catch (error) {
			if (response.headersSent) {
				response.end();
				return;
			}
			if (error instanceof PairingError) {
				const headers: Record<string, string> = {};
				if (error.retryAfterSeconds !== undefined) {
					headers["Retry-After"] = String(error.retryAfterSeconds);
				}
				sendJson(response, error.status, { error: error.message, code: "pairing_failed" }, headers);
				return;
			}
			if (error instanceof HttpError) {
				sendJson(response, error.status, { error: error.message, code: error.code }, error.headers);
				return;
			}
			console.error(error);
			sendJson(response, 500, { error: "Internal server error", code: "internal_error" });
		}
	};

	const server = options.tls
		? createHttpsServer({ cert: options.tls.cert, key: options.tls.key }, (request, response) => {
				void requestHandler(request, response);
			})
		: createHttpServer((request, response) => {
				void requestHandler(request, response);
			});

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(requestedPort, host, () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});
	const address = server.address() as AddressInfo;
	const port = address.port;
	if (!expectedOrigin) {
		const protocol = localInsecure ? "http" : "https";
		expectedOrigin = `${protocol}://${hostForUrl(host)}:${port}`;
	}

	let closePromise: Promise<void> | undefined;
	return {
		host,
		port,
		origin: expectedOrigin,
		pairingCode: auth.pairingCode,
		workspaceRoot,
		close(): Promise<void> {
			if (!closePromise) {
				closePromise = (async () => {
					streamHub.close();
					leases.clear();
					await controller.shutdown();
					await new Promise<void>((resolveClose, rejectClose) => {
						server.close((error) => (error ? rejectClose(error) : resolveClose()));
						server.closeIdleConnections();
					});
				})();
			}
			return closePromise;
		},
	};
}
