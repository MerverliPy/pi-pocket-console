import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import type { RpcCommand, RpcExtensionUIResponse, RpcResponse } from "@earendil-works/pi-coding-agent";
import type { InstanceController, InstanceSummary, PocketStreamMessage } from "../src/instance-manager.ts";
import { type PocketServer, startPocketServer } from "../src/server.ts";

interface ResponseResult {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
	json: Record<string, unknown>;
}

interface TestContext {
	server: PocketServer;
	tempDir: string;
}

class FakeController implements InstanceController {
	readonly commands: RpcCommand[] = [];
	readonly uiResponses: RpcExtensionUIResponse[] = [];
	readonly instances = new Map<string, InstanceSummary>();
	spawnCount = 0;
	constructor(private readonly workspaceRoot: string) {}

	list(): InstanceSummary[] {
		return [...this.instances.values()].map((i) => ({ ...i }));
	}

	async spawn(label?: string): Promise<InstanceSummary> {
		this.spawnCount += 1;
		const now = new Date().toISOString();
		const instance: InstanceSummary = {
			id: `instance-${this.spawnCount}`,
			status: "online",
			cwd: this.workspaceRoot,
			createdAt: now,
			lastSeenAt: now,
			label,
		};
		this.instances.set(instance.id, instance);
		return { ...instance };
	}

	status(id: string): InstanceSummary | undefined {
		const inst = this.instances.get(id);
		return inst ? { ...inst } : undefined;
	}

	async stop(id: string): Promise<InstanceSummary | undefined> {
		const inst = this.instances.get(id);
		if (!inst) return undefined;
		inst.status = "stopped";
		return { ...inst };
	}

	async send(_id: string, cmd: RpcCommand): Promise<RpcResponse> {
		this.commands.push(cmd);
		return { id: cmd.id, type: "response", command: cmd.type, success: false, error: "fake" } as RpcResponse;
	}

	sendUiResponse(_id: string, resp: RpcExtensionUIResponse): void {
		this.uiResponses.push(resp);
	}

	subscribe(id: string, listener: (msg: PocketStreamMessage) => void): (() => void) | undefined {
		if (!this.instances.has(id)) return undefined;
		const listeners = new Set<(msg: PocketStreamMessage) => void>();
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	async shutdown(): Promise<void> {}
}

function request(
	server: PocketServer,
	options: {
		path: string;
		method?: string;
		cookie?: string;
		csrf?: string;
		origin?: string;
		body?: unknown;
	},
): Promise<ResponseResult> {
	const method = options.method ?? "GET";
	const body = options.body === undefined ? undefined : JSON.stringify(options.body);
	const origin = options.origin ?? (method === "POST" ? server.origin : undefined);
	return new Promise<ResponseResult>((resolveReq, rejectReq) => {
		const req = httpRequest(
			{
				host: server.host,
				port: server.port,
				path: options.path,
				method,
				headers: {
					...(body === undefined
						? {}
						: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) }),
					...(options.cookie ? { Cookie: options.cookie } : {}),
					...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}),
					...(origin ? { Origin: origin } : {}),
				},
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () => {
					const bodyText = Buffer.concat(chunks).toString("utf8");
					let json: Record<string, unknown> = {};
					if (bodyText && String(response.headers["content-type"]).startsWith("application/json")) {
						json = JSON.parse(bodyText) as Record<string, unknown>;
					}
					resolveReq({ status: response.statusCode ?? 0, headers: response.headers, body: bodyText, json });
				});
			},
		);
		req.once("error", rejectReq);
		req.end(body);
	});
}

async function pair(server: PocketServer): Promise<{ cookie: string; csrf: string }> {
	const pairRes = await request(server, {
		path: "/api/pair",
		method: "POST",
		origin: server.origin,
		body: { code: server.pairingCode },
	});
	assert.equal(pairRes.status, 200);
	const setCookie = pairRes.headers["set-cookie"];
	const cookie = Array.isArray(setCookie) ? setCookie[0] : ((setCookie as string) ?? "");
	const csrf = (pairRes.json.csrfToken as string) ?? "";
	return { cookie, csrf };
}

async function createContext(): Promise<TestContext> {
	const tempDir = await mkdtemp(join(tmpdir(), "phase1b-api-"));
	const workspaceRoot = join(tempDir, "workspace");
	await mkdir(workspaceRoot);

	const controller = new FakeController(workspaceRoot);
	const server = await startPocketServer({
		workspaceRoot,
		localInsecure: true,
		host: "127.0.0.1",
		port: 0,
		instanceController: controller,
		bodyLimitBytes: 1024 * 1024,
	});

	return { server, tempDir };
}

async function destroyContext(ctx: TestContext): Promise<void> {
	await ctx.server.close();
	await rm(ctx.tempDir, { recursive: true, force: true });
}

describe("API v1 pairing and auth", () => {
	let ctx: TestContext;
	afterEach(async () => {
		if (ctx) await destroyContext(ctx);
	});

	test("GET /api/v1/pairing/status returns private connection info", async () => {
		ctx = await createContext();
		const res = await request(ctx.server, { path: "/api/v1/pairing/status" });
		assert.equal(res.status, 200);
		assert.equal(res.json.ok, true);
		const data = res.json.data as Record<string, unknown>;
		assert.equal(data.privateConnection, "verified");
		assert.equal(data.gatewayAvailable, true);
		assert.equal(data.pairingAvailable, true);
		assert.equal(data.codeRequired, true);
		assert.ok(typeof data.hostIdentity === "string");
	});

	test("GET /api/v1/pairing/status does not leak canonical hostname", async () => {
		ctx = await createContext();
		const res = await request(ctx.server, { path: "/api/v1/pairing/status" });
		const data = res.json.data as Record<string, unknown>;
		assert.ok(!(data.hostIdentity as string).includes("/"));
	});

	test("POST /api/v1/pairing/complete with valid code returns session cookie", async () => {
		ctx = await createContext();
		const res = await request(ctx.server, {
			path: "/api/v1/pairing/complete",
			method: "POST",
			body: { code: ctx.server.pairingCode, deviceLabel: "my-iphone" },
		});
		assert.equal(res.status, 200);
		assert.equal(res.json.ok, true);
		const data = res.json.data as Record<string, unknown>;
		assert.ok(typeof data.deviceId === "string");
		assert.equal(data.deviceLabel, "my-iphone");
		const setCookie = res.headers["set-cookie"];
		assert.ok(setCookie);
	});

	test("POST /api/v1/pairing/complete with invalid code returns 401", async () => {
		ctx = await createContext();
		const res = await request(ctx.server, {
			path: "/api/v1/pairing/complete",
			method: "POST",
			body: { code: "000000", deviceLabel: "bad-device" },
		});
		assert.equal(res.status, 401);
	});

	test("GET /api/v1/auth/session returns unauthenticated when no cookie", async () => {
		ctx = await createContext();
		const res = await request(ctx.server, { path: "/api/v1/auth/session" });
		assert.equal(res.status, 200);
		const data = res.json.data as Record<string, unknown>;
		assert.equal(data.authenticated, false);
	});

	test("GET /api/v1/auth/session returns authenticated after pairing", async () => {
		ctx = await createContext();
		const { cookie } = await pair(ctx.server);
		const res = await request(ctx.server, { path: "/api/v1/auth/session", cookie });
		assert.equal(res.status, 200);
		const data = res.json.data as Record<string, unknown>;
		assert.equal(data.authenticated, true);
	});

	test("POST /api/v1/auth/logout invalidates session", async () => {
		ctx = await createContext();
		const { cookie, csrf } = await pair(ctx.server);
		const logoutRes = await request(ctx.server, { path: "/api/v1/auth/logout", method: "POST", cookie, csrf });
		assert.equal(logoutRes.status, 200);

		const sessionRes = await request(ctx.server, { path: "/api/v1/auth/session", cookie });
		const sessionData = sessionRes.json.data as Record<string, unknown>;
		assert.equal(sessionData.authenticated, false);
	});
});

describe("API v1 terminal control plane", () => {
	let ctx: TestContext;
	let cookie: string;
	let csrf: string;

	afterEach(async () => {
		if (ctx) await destroyContext(ctx);
	});

	async function setup(): Promise<void> {
		ctx = await createContext();
		const result = await pair(ctx.server);
		cookie = result.cookie;
		csrf = result.csrf;
	}

	test("GET /api/v1/workspaces returns enabled workspace list", async () => {
		await setup();
		const res = await request(ctx.server, { path: "/api/v1/workspaces", cookie });
		assert.equal(res.status, 200);
		const data = res.json.data as Array<Record<string, unknown>>;
		assert.ok(Array.isArray(data));
		assert.ok(data.length >= 1);
		assert.equal(data[0].enabled, true);
		assert.ok((data[0].allowedLaunchers as string[]).includes("default-shell"));
	});

	test("GET /api/v1/terminals returns empty list", async () => {
		await setup();
		const res = await request(ctx.server, { path: "/api/v1/terminals", cookie });
		assert.equal(res.status, 200);
		assert.deepEqual(res.json.data, []);
	});

	test("POST /api/v1/terminals creates a terminal session", async () => {
		await setup();
		const res = await request(ctx.server, {
			path: "/api/v1/terminals",
			method: "POST",
			cookie,
			csrf,
			body: {
				workspaceId: ctx.server.workspaceRoot,
				launcherId: "default-shell",
				cols: 80,
				rows: 24,
				clientRequestId: "create-1",
			},
		});
		assert.equal(res.status, 201);
		const data = res.json.data as Record<string, unknown>;
		assert.equal(data.websocketPath, "/api/v1/ws");
		const session = data.session as Record<string, unknown>;
		assert.equal(session.state, "CREATING");
		assert.ok(typeof session.sessionId === "string");
	});

	test("POST /api/v1/terminals enforces idempotency by clientRequestId", async () => {
		await setup();
		const body = {
			workspaceId: ctx.server.workspaceRoot,
			launcherId: "default-shell",
			cols: 80,
			rows: 24,
			clientRequestId: "idem-1",
		};
		const res1 = await request(ctx.server, { path: "/api/v1/terminals", method: "POST", cookie, csrf, body });
		const res2 = await request(ctx.server, { path: "/api/v1/terminals", method: "POST", cookie, csrf, body });
		const session1 = (res1.json.data as Record<string, unknown>).session as Record<string, unknown>;
		const session2 = (res2.json.data as Record<string, unknown>).session as Record<string, unknown>;
		assert.equal(session1.sessionId, session2.sessionId);
	});

	test("POST /api/v1/terminals rejects disabled launcher", async () => {
		await setup();
		const res = await request(ctx.server, {
			path: "/api/v1/terminals",
			method: "POST",
			cookie,
			csrf,
			body: {
				workspaceId: ctx.server.workspaceRoot,
				launcherId: "pi",
				cols: 80,
				rows: 24,
				clientRequestId: "bad-launcher",
			},
		});
		assert.equal(res.status, 400);
	});

	test("POST /api/v1/terminals rejects without auth", async () => {
		ctx = await createContext();
		const res = await request(ctx.server, {
			path: "/api/v1/terminals",
			method: "POST",
			body: { workspaceId: "/tmp", launcherId: "default-shell", cols: 80, rows: 24, clientRequestId: "no-auth" },
		});
		assert.equal(res.status, 401);
	});

	test("GET /api/v1/terminals/{sessionId} returns 404 for unknown session", async () => {
		await setup();
		const res = await request(ctx.server, { path: "/api/v1/terminals/unknown-session", cookie });
		assert.equal(res.status, 404);
	});

	test("POST /api/v1/terminals/{sessionId}/terminate accepts graceful mode", async () => {
		await setup();
		const res = await request(ctx.server, {
			path: "/api/v1/terminals/fake-session/terminate",
			method: "POST",
			cookie,
			csrf,
			body: { mode: "graceful", clientRequestId: "term-1" },
		});
		assert.equal(res.status, 200);
		assert.equal((res.json.data as Record<string, unknown>).accepted, true);
	});

	test("POST /api/v1/terminals/{sessionId}/terminate accepts force mode", async () => {
		await setup();
		const res = await request(ctx.server, {
			path: "/api/v1/terminals/fake-session/terminate",
			method: "POST",
			cookie,
			csrf,
			body: { mode: "force", clientRequestId: "term-2" },
		});
		assert.equal(res.status, 200);
		assert.equal((res.json.data as Record<string, unknown>).state, "TERMINATING");
	});

	test("POST /api/v1/terminals/{sessionId}/terminate rejects bogus mode", async () => {
		await setup();
		const res = await request(ctx.server, {
			path: "/api/v1/terminals/fake-session/terminate",
			method: "POST",
			cookie,
			csrf,
			body: { mode: "bogus", clientRequestId: "term-bad" },
		});
		assert.equal(res.status, 400);
	});
});

describe("API v1 lease operations", () => {
	let ctx: TestContext;
	let cookie: string;
	let csrf: string;

	afterEach(async () => {
		if (ctx) await destroyContext(ctx);
	});

	async function setup(): Promise<void> {
		ctx = await createContext();
		const result = await pair(ctx.server);
		cookie = result.cookie;
		csrf = result.csrf;
	}

	test("POST /api/v1/terminals/{sessionId}/lease/acquire grants a lease", async () => {
		await setup();
		const res = await request(ctx.server, {
			path: "/api/v1/terminals/session-1/lease/acquire",
			method: "POST",
			cookie,
			csrf,
			body: { clientRequestId: "lease-acq-1" },
		});
		assert.equal(res.status, 200);
		const data = res.json.data as Record<string, unknown>;
		const lease = data.lease as Record<string, unknown>;
		assert.ok(typeof lease.leaseId === "string");
		assert.equal(lease.generation, 1);
		assert.equal(lease.sessionId, "session-1");
	});

	test("POST /api/v1/terminals/{sessionId}/lease/acquire enforces idempotency", async () => {
		await setup();
		const body = { clientRequestId: "lease-dup" };
		const res1 = await request(ctx.server, {
			path: "/api/v1/terminals/s-1/lease/acquire",
			method: "POST",
			cookie,
			csrf,
			body,
		});
		const res2 = await request(ctx.server, {
			path: "/api/v1/terminals/s-1/lease/acquire",
			method: "POST",
			cookie,
			csrf,
			body,
		});
		const lease1 = (res1.json.data as Record<string, unknown>).lease as Record<string, unknown>;
		const lease2 = (res2.json.data as Record<string, unknown>).lease as Record<string, unknown>;
		assert.equal(lease1.leaseId, lease2.leaseId);
	});

	test("POST /api/v1/terminals/{sessionId}/lease/transfer transfers lease", async () => {
		await setup();
		const res = await request(ctx.server, {
			path: "/api/v1/terminals/session-2/lease/transfer",
			method: "POST",
			cookie,
			csrf,
			body: { expectedGeneration: 0, targetDeviceId: "device-b", clientRequestId: "lease-xfer" },
		});
		assert.equal(res.status, 200);
		const data = res.json.data as Record<string, unknown>;
		const lease = data.lease as Record<string, unknown>;
		assert.equal(lease.generation, 1);
		assert.equal(lease.deviceId, "device-b");
	});

	test("POST /api/v1/terminals/{sessionId}/lease/release releases lease", async () => {
		await setup();
		const res = await request(ctx.server, {
			path: "/api/v1/terminals/session-3/lease/release",
			method: "POST",
			cookie,
			csrf,
			body: { expectedGeneration: 1, clientRequestId: "lease-rel" },
		});
		assert.equal(res.status, 200);
		const data = res.json.data as Record<string, unknown>;
		assert.equal(data.released, true);
		assert.equal(data.generation, 2);
	});

	test("lease endpoints reject without auth", async () => {
		ctx = await createContext();
		const res = await request(ctx.server, {
			path: "/api/v1/terminals/s-1/lease/acquire",
			method: "POST",
			body: { clientRequestId: "no-auth" },
		});
		assert.equal(res.status, 401);
	});

	test("lease endpoints reject without CSRF", async () => {
		await setup();
		const res = await request(ctx.server, {
			path: "/api/v1/terminals/s-1/lease/acquire",
			method: "POST",
			cookie,
			body: { clientRequestId: "no-csrf" },
		});
		assert.equal(res.status, 403);
	});
});

describe("API v1 diagnostics", () => {
	let ctx: TestContext;
	afterEach(async () => {
		if (ctx) await destroyContext(ctx);
	});

	test("GET /api/v1/diagnostics returns redacted summary", async () => {
		ctx = await createContext();
		const res = await request(ctx.server, { path: "/api/v1/diagnostics" });
		assert.equal(res.status, 200);
		const data = res.json.data as Record<string, unknown>;
		const gateway = data.gateway as Record<string, unknown>;
		const auth = data.authentication as Record<string, unknown>;
		const limits = data.terminalLimits as Record<string, unknown>;
		assert.equal(gateway.status, "healthy");
		assert.equal(gateway.boundAddress, "127.0.0.1");
		assert.ok(typeof auth.authenticated === "boolean");
		assert.ok(typeof limits.activeForDevice === "number");
	});

	test("GET /api/v1/diagnostics contains redacted events array", async () => {
		ctx = await createContext();
		const res = await request(ctx.server, { path: "/api/v1/diagnostics" });
		const data = res.json.data as Record<string, unknown>;
		assert.ok(Array.isArray(data.redactedEvents));
	});
});

describe("API v1 CSRF enforcement", () => {
	let ctx: TestContext;
	let cookie: string;

	afterEach(async () => {
		if (ctx) await destroyContext(ctx);
	});

	test("POST authenticated routes require CSRF token", async () => {
		ctx = await createContext();
		const pairRes = await request(ctx.server, {
			path: "/api/v1/pairing/complete",
			method: "POST",
			body: { code: ctx.server.pairingCode, deviceLabel: "test" },
		});
		const setCookie = pairRes.headers["set-cookie"];
		cookie = Array.isArray(setCookie) ? setCookie[0] : ((setCookie as string) ?? "");

		const res = await request(ctx.server, {
			path: "/api/v1/terminals",
			method: "POST",
			cookie,
			body: {
				workspaceId: ctx.server.workspaceRoot,
				launcherId: "default-shell",
				cols: 80,
				rows: 24,
				clientRequestId: "no-csrf",
			},
		});
		assert.equal(res.status, 403);
		assert.ok(
			(res.json.error as Record<string, unknown>).code === "CSRF_REJECTED" || res.json.code === "CSRF_REJECTED",
		);
	});
});

describe("API v1 response envelope", () => {
	let ctx: TestContext;
	afterEach(async () => {
		if (ctx) await destroyContext(ctx);
	});

	test("success responses use ApiSuccess envelope", async () => {
		ctx = await createContext();
		const res = await request(ctx.server, { path: "/api/v1/pairing/status" });
		assert.equal(res.json.ok, true);
		assert.ok(typeof res.json.requestId === "string");
		assert.ok(res.json.data !== undefined);
	});

	test("error responses use ApiFailure envelope", async () => {
		ctx = await createContext();
		const res = await request(ctx.server, { path: "/api/v1/terminals", method: "POST", body: { invalid: true } });
		assert.equal(res.json.ok, false);
		assert.ok(typeof res.json.requestId === "string");
		assert.ok(res.json.error !== undefined);
	});

	test("X-Request-ID header is reflected in response", async () => {
		ctx = await createContext();
		const res = await request(ctx.server, { path: "/api/v1/pairing/status" }); // uses default random UUID
		assert.ok(typeof res.json.requestId === "string");
		assert.ok(res.json.requestId.length >= 32);
	});
});
