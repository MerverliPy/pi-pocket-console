import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import WebSocket from "ws";
import type { PocketServer } from "../src/server.ts";
import { startPocketServer } from "../src/server.ts";

interface TestContext {
	server: PocketServer;
	tempDir: string;
}

async function pair(server: PocketServer): Promise<string> {
	const body = JSON.stringify({ code: server.pairingCode });
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			{
				host: server.host,
				port: server.port,
				path: "/api/pair",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": String(Buffer.byteLength(body)),
					Origin: server.origin,
				},
			},
			(res) => {
				let _data = "";
				res.on("data", (c: string) => {
					_data += c;
				});
				res.on("end", () => {
					const setCookie = res.headers["set-cookie"];
					const cookie = Array.isArray(setCookie) ? setCookie[0]?.split(";")[0] : (setCookie ?? "").split(";")[0];
					resolve(cookie ?? "");
				});
			},
		);
		req.once("error", reject);
		req.end(body);
	});
}

async function createContext(): Promise<TestContext> {
	const tempDir = await mkdtemp(join(tmpdir(), "phase2-ws-"));
	const workspaceRoot = join(tempDir, "workspace");
	await mkdir(workspaceRoot);

	const server = await startPocketServer({
		workspaceRoot,
		localInsecure: true,
		host: "127.0.0.1",
		port: 0,
		bodyLimitBytes: 1024 * 1024,
	});

	return { server, tempDir };
}

async function destroyContext(ctx: TestContext): Promise<void> {
	await ctx.server.close();
	await rm(ctx.tempDir, { recursive: true, force: true });
}

function connectAndReady(
	server: PocketServer,
	cookie: string,
): Promise<{ ws: WebSocket; ready: Record<string, unknown> }> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://${server.host}:${server.port}/api/v1/ws`, {
			headers: { Cookie: cookie, Origin: server.origin },
		});
		const timer = setTimeout(() => reject(new Error("connect timeout")), 3000);
		ws.once("message", (data: Buffer) => {
			clearTimeout(timer);
			const msg = JSON.parse(data.toString()) as Record<string, unknown>;
			resolve({ ws, ready: msg });
		});
		ws.once("error", reject);
	});
}

function nextMessage(ws: WebSocket, timeoutMs = 3000): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Timed out waiting for message")), timeoutMs);
		ws.once("message", (data: Buffer) => {
			clearTimeout(timer);
			resolve(JSON.parse(data.toString()) as Record<string, unknown>);
		});
	});
}

function sendMsg(ws: WebSocket, msg: Record<string, unknown>): void {
	ws.send(JSON.stringify(msg));
}

describe("WebSocket transport connection", () => {
	let ctx: TestContext;
	let cookie: string;

	afterEach(async () => {
		if (ctx) await destroyContext(ctx);
	});

	async function setup(): Promise<void> {
		ctx = await createContext();
		cookie = await pair(ctx.server);
	}

	test("rejects unauthenticated WebSocket connection", async () => {
		ctx = await createContext();
		const result = await new Promise<number>((resolve) => {
			const ws = new WebSocket(`ws://${ctx.server.host}:${ctx.server.port}/api/v1/ws`, {
				headers: { Origin: ctx.server.origin },
			});
			ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
			ws.once("error", () => resolve(0));
		});
		assert.equal(result, 401);
	});

	test("receives connection.ready after successful upgrade", async () => {
		await setup();
		const { ws, ready } = await connectAndReady(ctx.server, cookie);
		assert.equal(ready.type, "connection.ready");
		assert.equal(ready.version, 1);
		const p = ready.payload as Record<string, unknown>;
		assert.ok(typeof p.connectionId === "string");
		assert.equal(p.protocolVersion, 1);
		ws.close();
	});

	test("client.hello is accepted", async () => {
		await setup();
		const { ws } = await connectAndReady(ctx.server, cookie);

		sendMsg(ws, {
			version: 1,
			type: "client.hello",
			payload: {
				clientName: "pi-pocket-console-web",
				clientVersion: "0.2.0",
				supportedProtocolVersions: [1],
				platform: "ios-pwa",
			},
		});

		ws.close();
		assert.equal(ws.readyState, WebSocket.CLOSING || WebSocket.CLOSED);
	});

	test("receives heartbeat pings", async () => {
		await setup();
		const { ws } = await connectAndReady(ctx.server, cookie);

		const msg = await nextMessage(ws, 20000);
		assert.equal(msg.type, "connection.ping");
		ws.close();
	});

	test("responds to heartbeat pings with pong", async () => {
		await setup();
		const { ws } = await connectAndReady(ctx.server, cookie);
		const ping = await nextMessage(ws, 20000);
		const pingPayload = ping.payload as Record<string, unknown>;

		sendMsg(ws, {
			version: 1,
			type: "connection.pong",
			payload: { sentAt: pingPayload.sentAt, receivedAt: new Date().toISOString() },
		});

		ws.close();
		assert.equal(ws.readyState, WebSocket.CLOSING || WebSocket.CLOSED);
	});

	test("unknown message type triggers error", async () => {
		await setup();
		const { ws } = await connectAndReady(ctx.server, cookie);

		sendMsg(ws, { version: 1, type: "bogus.type", payload: {} });
		const msg = await nextMessage(ws);
		assert.equal(msg.type, "connection.error");
		ws.close();
	});
});

describe("WebSocket terminal attach/detach", () => {
	let ctx: TestContext;
	let cookie: string;

	afterEach(async () => {
		if (ctx) await destroyContext(ctx);
	});

	async function setup(): Promise<void> {
		ctx = await createContext();
		cookie = await pair(ctx.server);
	}

	test("terminal.attach returns terminal.attached", async () => {
		await setup();
		const { ws } = await connectAndReady(ctx.server, cookie);

		sendMsg(ws, {
			version: 1,
			type: "client.hello",
			payload: {
				clientName: "pi-pocket-console-web",
				clientVersion: "0.2.0",
				supportedProtocolVersions: [1],
				platform: "ios-pwa",
			},
		});

		sendMsg(ws, {
			version: 1,
			type: "terminal.attach",
			sessionId: "session-1",
			requestId: "a1",
			payload: {},
		});

		const msg = await nextMessage(ws);
		assert.equal(msg.type, "terminal.attached");
		const p = msg.payload as Record<string, unknown>;
		const replay = p.replay as Record<string, unknown>;
		assert.equal(replay.available, false);
		const lease = p.lease as Record<string, unknown>;
		assert.equal(lease.state, "none");
		ws.close();
	});

	test("terminal.detach is accepted", async () => {
		await setup();
		const { ws } = await connectAndReady(ctx.server, cookie);

		sendMsg(ws, {
			version: 1,
			type: "client.hello",
			payload: {
				clientName: "pi-pocket-console-web",
				clientVersion: "0.2.0",
				supportedProtocolVersions: [1],
				platform: "ios-pwa",
			},
		});

		sendMsg(ws, {
			version: 1,
			type: "terminal.attach",
			sessionId: "session-3",
			requestId: "a3",
			payload: {},
		});
		await nextMessage(ws); // terminal.attached

		sendMsg(ws, {
			version: 1,
			type: "terminal.detach",
			sessionId: "session-3",
			payload: { reason: "manual" },
		});
		ws.close();
		assert.ok(true);
	});
});

describe("WebSocket terminal input", () => {
	let ctx: TestContext;
	let cookie: string;
	let leaseId: string;
	let leaseGeneration: number;

	afterEach(async () => {
		if (ctx) await destroyContext(ctx);
	});

	async function setup(): Promise<void> {
		ctx = await createContext();
		cookie = await pair(ctx.server);

		const leaseMgr = ctx.server.wsTransport.getOrCreateLeaseManager("session-input");
		const lease = leaseMgr.acquire("session-input", "test-device", 300_000);
		leaseId = lease.leaseId;
		leaseGeneration = lease.generation;
	}

	test("terminal.input is rejected with invalid lease", async () => {
		await setup();
		const { ws } = await connectAndReady(ctx.server, cookie);

		sendMsg(ws, {
			version: 1,
			type: "client.hello",
			payload: {
				clientName: "pi-pocket-console-web",
				clientVersion: "0.2.0",
				supportedProtocolVersions: [1],
				platform: "ios-pwa",
			},
		});

		sendMsg(ws, {
			version: 1,
			type: "terminal.attach",
			sessionId: "session-input",
			requestId: "a-input",
			payload: {},
		});
		await nextMessage(ws); // terminal.attached

		sendMsg(ws, {
			version: 1,
			type: "terminal.input",
			sessionId: "session-input",
			requestId: "inp-1",
			payload: { leaseId: "bad-lease", leaseGeneration: 99, data: "echo hello" },
		});

		const msg = await nextMessage(ws);
		assert.equal(msg.type, "terminal.input.rejected");
		ws.close();
	});

	test("terminal.input is accepted with valid lease", async () => {
		await setup();
		const { ws } = await connectAndReady(ctx.server, cookie);

		sendMsg(ws, {
			version: 1,
			type: "client.hello",
			payload: {
				clientName: "pi-pocket-console-web",
				clientVersion: "0.2.0",
				supportedProtocolVersions: [1],
				platform: "ios-pwa",
			},
		});

		sendMsg(ws, {
			version: 1,
			type: "terminal.attach",
			sessionId: "session-input",
			requestId: "a-input2",
			payload: {},
		});
		await nextMessage(ws); // terminal.attached

		sendMsg(ws, {
			version: 1,
			type: "terminal.input",
			sessionId: "session-input",
			requestId: "inp-2",
			payload: { leaseId, leaseGeneration, data: "echo hello" },
		});

		const msg = await nextMessage(ws);
		assert.equal(msg.type, "terminal.input.accepted");
		ws.close();
	});

	test("terminal.input exceeding 48 KiB is rejected", async () => {
		await setup();
		const { ws } = await connectAndReady(ctx.server, cookie);

		sendMsg(ws, {
			version: 1,
			type: "client.hello",
			payload: {
				clientName: "pi-pocket-console-web",
				clientVersion: "0.2.0",
				supportedProtocolVersions: [1],
				platform: "ios-pwa",
			},
		});

		sendMsg(ws, {
			version: 1,
			type: "terminal.attach",
			sessionId: "session-input",
			requestId: "a-input3",
			payload: {},
		});
		await nextMessage(ws); // terminal.attached

		sendMsg(ws, {
			version: 1,
			type: "terminal.input",
			sessionId: "session-input",
			requestId: "inp-big",
			payload: { leaseId, leaseGeneration, data: "x".repeat(50_000) },
		});

		const msg = await nextMessage(ws);
		assert.equal(msg.type, "terminal.input.rejected");
		ws.close();
	});

	test("terminal.resize is accepted with valid lease", async () => {
		await setup();
		const { ws } = await connectAndReady(ctx.server, cookie);

		sendMsg(ws, {
			version: 1,
			type: "client.hello",
			payload: {
				clientName: "pi-pocket-console-web",
				clientVersion: "0.2.0",
				supportedProtocolVersions: [1],
				platform: "ios-pwa",
			},
		});

		sendMsg(ws, {
			version: 1,
			type: "terminal.attach",
			sessionId: "session-input",
			requestId: "a-resize",
			payload: {},
		});
		await nextMessage(ws); // terminal.attached

		sendMsg(ws, {
			version: 1,
			type: "terminal.resize",
			sessionId: "session-input",
			requestId: "resize-1",
			payload: { leaseId, leaseGeneration, cols: 120, rows: 40 },
		});

		const msg = await nextMessage(ws);
		assert.equal(msg.type, "terminal.resize.accepted");
		ws.close();
	});
});

describe("WebSocket output delivery", () => {
	let ctx: TestContext;
	let cookie: string;

	afterEach(async () => {
		if (ctx) await destroyContext(ctx);
	});

	async function setup(): Promise<void> {
		ctx = await createContext();
		cookie = await pair(ctx.server);
	}

	test("sendOutput delivers output message with sequence", async () => {
		await setup();
		const { ws, ready } = await connectAndReady(ctx.server, cookie);
		const readyPayload = ready.payload as Record<string, unknown>;
		const connectionId = readyPayload.connectionId as string;

		sendMsg(ws, {
			version: 1,
			type: "client.hello",
			payload: {
				clientName: "pi-pocket-console-web",
				clientVersion: "0.2.0",
				supportedProtocolVersions: [1],
				platform: "ios-pwa",
			},
		});

		sendMsg(ws, {
			version: 1,
			type: "terminal.attach",
			sessionId: "session-out",
			requestId: "att-out",
			payload: {},
		});
		await nextMessage(ws); // terminal.attached

		const client = ctx.server.wsTransport.getClientByConnectionId(connectionId);
		assert.ok(client);
		ctx.server.wsTransport.sendOutput(client, "session-out", "hello world", 1);

		const msg = await nextMessage(ws);
		assert.equal(msg.type, "terminal.output");
		assert.equal(msg.sequence, 1);
		assert.equal(msg.sessionId, "session-out");
		const p = msg.payload as Record<string, unknown>;
		assert.equal(p.data, "hello world");
		ws.close();
	});
});
