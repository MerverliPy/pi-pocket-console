import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { type ClientRequest, request as httpRequest, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import type { RpcCommand, RpcExtensionUIResponse, RpcResponse } from "@earendil-works/pi-coding-agent";
import { ControllerLeases } from "../src/controller-lease.ts";
import type { InstanceController, InstanceSummary, PocketStreamMessage } from "../src/instance-manager.ts";
import { type PocketServer, type PocketServerOptions, startPocketServer } from "../src/server.ts";

const TEST_CLIENT_ID = "test-client";

interface ResponseResult {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
	json: Record<string, unknown>;
}

class FakeController implements InstanceController {
	readonly commands: RpcCommand[] = [];
	readonly uiResponses: RpcExtensionUIResponse[] = [];
	readonly instances = new Map<string, InstanceSummary>();
	readonly listeners = new Map<string, Set<(message: PocketStreamMessage) => void>>();
	spawnCount = 0;
	shutdownCount = 0;

	constructor(private readonly workspaceRoot: string) {}

	list(): InstanceSummary[] {
		return [...this.instances.values()].map((instance) => ({ ...instance }));
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

	status(instanceId: string): InstanceSummary | undefined {
		const instance = this.instances.get(instanceId);
		return instance ? { ...instance } : undefined;
	}

	async stop(instanceId: string): Promise<InstanceSummary | undefined> {
		const instance = this.instances.get(instanceId);
		if (!instance) {
			return undefined;
		}
		instance.status = "stopped";
		return { ...instance };
	}

	async send(_instanceId: string, command: RpcCommand): Promise<RpcResponse> {
		this.commands.push(command);
		return {
			id: command.id,
			type: "response",
			command: command.type,
			success: false,
			error: "fake response",
		};
	}

	sendUiResponse(_instanceId: string, response: RpcExtensionUIResponse): void {
		this.uiResponses.push(response);
	}

	subscribe(instanceId: string, listener: (message: PocketStreamMessage) => void): (() => void) | undefined {
		if (!this.instances.has(instanceId)) {
			return undefined;
		}
		const listeners = this.listeners.get(instanceId) ?? new Set();
		listeners.add(listener);
		this.listeners.set(instanceId, listeners);
		return () => listeners.delete(listener);
	}

	publish(instanceId: string, message: PocketStreamMessage): void {
		for (const listener of this.listeners.get(instanceId) ?? []) {
			listener(message);
		}
	}

	async shutdown(): Promise<void> {
		this.shutdownCount += 1;
	}
}

const fixtures: Array<{ server: PocketServer; directory: string }> = [];

afterEach(async () => {
	await Promise.all(
		fixtures.splice(0).map(async ({ server, directory }) => {
			await server.close();
			await rm(directory, { recursive: true, force: true });
		}),
	);
});

async function createFixture(
	bodyLimitBytes?: number,
	overrides: Partial<PocketServerOptions> = {},
): Promise<{
	server: PocketServer;
	controller: FakeController;
	directory: string;
}> {
	const directory = await mkdtemp(join(tmpdir(), "pi-pocket-server-"));
	const publicDir = join(directory, "public");
	await writeFile(join(directory, "placeholder"), "");
	await mkdir(publicDir);
	await writeFile(join(publicDir, "index.html"), "<!doctype html><title>Pi Pocket</title>");
	await writeFile(join(publicDir, "app.js"), "console.log('pi pocket');");
	const controller = new FakeController(directory);
	const server = await startPocketServer({
		workspaceRoot: directory,
		publicDir,
		host: "127.0.0.1",
		port: 0,
		localInsecure: true,
		bodyLimitBytes,
		instanceController: controller,
		...overrides,
	});
	fixtures.push({ server, directory });
	return { server, controller, directory };
}

async function openEventStream(
	server: PocketServer,
	instanceId: string,
	cookie: string,
	lastEventId?: number,
	clientId?: string,
): Promise<{
	request: ClientRequest;
	response: IncomingMessage;
	readUntil(pattern: RegExp): Promise<string>;
}> {
	return new Promise((resolveStream, rejectStream) => {
		const request = httpRequest(
			{
				host: server.host,
				port: server.port,
				path: `/api/instances/${instanceId}/events`,
				headers: {
					Cookie: cookie,
					...(lastEventId === undefined ? {} : { "Last-Event-ID": String(lastEventId) }),
					...(clientId ? { "X-Client-Id": clientId } : {}),
				},
			},
			(response) => {
				if (response.statusCode !== 200) {
					rejectStream(new Error(`Unexpected SSE status: ${response.statusCode}`));
					response.resume();
					return;
				}
				let received = "";
				response.setEncoding("utf8");
				response.on("data", (chunk: string) => {
					received += chunk;
				});
				resolveStream({
					request,
					response,
					readUntil(pattern): Promise<string> {
						return new Promise<string>((resolveMatch, rejectMatch) => {
							const timeout = setTimeout(
								() => rejectMatch(new Error(`Timed out waiting for ${pattern} in:\n${received}`)),
								2_000,
							);
							const poll = setInterval(() => {
								if (!pattern.test(received)) {
									return;
								}
								clearTimeout(timeout);
								clearInterval(poll);
								resolveMatch(received);
							}, 10);
						});
					},
				});
			},
		);
		request.once("error", rejectStream);
		request.end();
	});
}

async function request(
	server: PocketServer,
	options: {
		path: string;
		method?: string;
		cookie?: string;
		csrf?: string;
		origin?: string;
		body?: unknown;
		clientId?: string;
	},
): Promise<ResponseResult> {
	const body = options.body === undefined ? undefined : JSON.stringify(options.body);
	return new Promise<ResponseResult>((resolveRequest, rejectRequest) => {
		const request = httpRequest(
			{
				host: server.host,
				port: server.port,
				path: options.path,
				method: options.method ?? "GET",
				headers: {
					...(body === undefined
						? {}
						: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }),
					...(options.cookie ? { Cookie: options.cookie } : {}),
					...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}),
					...(options.origin ? { Origin: options.origin } : {}),
					...(options.clientId ? { "X-Client-Id": options.clientId } : {}),
				},
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () => {
					const responseBody = Buffer.concat(chunks).toString("utf8");
					let json: Record<string, unknown> = {};
					if (responseBody && String(response.headers["content-type"]).startsWith("application/json")) {
						json = JSON.parse(responseBody) as Record<string, unknown>;
					}
					resolveRequest({
						status: response.statusCode ?? 0,
						headers: response.headers,
						body: responseBody,
						json,
					});
				});
			},
		);
		request.once("error", rejectRequest);
		request.end(body);
	});
}

async function pair(server: PocketServer): Promise<{ cookie: string; csrf: string; setCookie: string }> {
	const response = await request(server, {
		path: "/api/pair",
		method: "POST",
		origin: server.origin,
		body: { code: server.pairingCode },
	});
	assert.equal(response.status, 200);
	const setCookie = response.headers["set-cookie"]?.[0];
	assert.ok(setCookie);
	return {
		cookie: setCookie.split(";", 1)[0],
		csrf: String(response.json.csrfToken),
		setCookie,
	};
}

describe("secure mobile server", () => {
	test("uses one-time pairing, an HttpOnly strict cookie, and authenticated bootstrap", async () => {
		const { server, directory } = await createFixture();

		const unauthenticated = await request(server, { path: "/api/bootstrap" });
		assert.equal(unauthenticated.status, 401);
		assert.equal(unauthenticated.headers["x-content-type-options"], "nosniff");
		assert.match(String(unauthenticated.headers["content-security-policy"]), /frame-ancestors 'none'/);

		const wrongOrigin = await request(server, {
			path: "/api/pair",
			method: "POST",
			origin: "https://attacker.invalid",
			body: { code: server.pairingCode },
		});
		assert.equal(wrongOrigin.status, 403);

		const auth = await pair(server);
		assert.match(auth.setCookie, /HttpOnly/);
		assert.match(auth.setCookie, /SameSite=Strict/);
		assert.doesNotMatch(auth.setCookie, /Secure/);

		const bootstrap = await request(server, {
			path: "/api/bootstrap",
			cookie: auth.cookie,
		});
		assert.equal(bootstrap.status, 200);
		assert.equal(bootstrap.json.workspaceRoot, directory);
		assert.equal(bootstrap.json.fullHostAccess, true);
		assert.equal(bootstrap.json.projectTrustOverride, false);
		assert.equal(bootstrap.json.providerCredentials, "host");
		assert.equal(bootstrap.json.csrfToken, auth.csrf);

		const pairedAgain = await request(server, {
			path: "/api/pair",
			method: "POST",
			origin: server.origin,
			body: { code: server.pairingCode },
		});
		assert.equal(pairedAgain.status, 410);
	});

	test("uses Secure cookies and an exact external origin behind a loopback TLS proxy", async () => {
		const { server } = await createFixture(undefined, {
			localInsecure: false,
			publicOrigin: "https://calvinpc.example-tailnet.ts.net",
		});
		const rejected = await request(server, {
			path: "/api/pair",
			method: "POST",
			origin: "https://other.example-tailnet.ts.net",
			body: { code: server.pairingCode },
		});
		assert.equal(rejected.status, 403);

		const auth = await pair(server);
		assert.match(auth.setCookie, /; Secure/);
		assert.equal(server.origin, "https://calvinpc.example-tailnet.ts.net");
	});

	test("fixes spawned instances to the configured workspace and enforces CSRF", async () => {
		const { server, controller, directory } = await createFixture();
		const auth = await pair(server);

		const missingCsrf = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			body: { label: "Phone" },
		});
		assert.equal(missingCsrf.status, 403);

		const arbitraryCwd = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: { label: "Phone", cwd: "/tmp" },
		});
		assert.equal(arbitraryCwd.status, 400);
		assert.equal(controller.spawnCount, 0);

		const spawned = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: { label: "Phone" },
		});
		assert.equal(spawned.status, 201);
		const instance = spawned.json.instance as InstanceSummary;
		assert.equal(instance.cwd, directory);

		const unknownCommand = await request(server, {
			path: `/api/instances/${instance.id}/commands`,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: { command: { type: "run_anything", command: "unsafe" } },
		});
		assert.equal(unknownCommand.status, 403);

		const command = await request(server, {
			path: `/api/instances/${instance.id}/commands`,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: { command: { type: "prompt", message: "Hello" } },
		});
		assert.equal(command.status, 200);
		assert.equal(controller.commands.length, 1);
		assert.match(String(controller.commands[0].id), /^mobile_/);

		const uiResponse = await request(server, {
			path: `/api/instances/${instance.id}/ui-responses`,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: { response: { type: "extension_ui_response", id: "dialog-1", confirmed: true } },
		});
		assert.equal(uiResponse.status, 202);
		assert.deepEqual(controller.uiResponses[0], {
			type: "extension_ui_response",
			id: "dialog-1",
			confirmed: true,
		});
	});

	test("strictly validates image content and optional command fields", async () => {
		const { server, controller } = await createFixture();
		const auth = await pair(server);
		const spawned = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});
		const instance = spawned.json.instance as InstanceSummary;
		const commandPath = `/api/instances/${instance.id}/commands`;

		const validJpeg = "/9j/"; // FF D8 FF
		const validImage = { type: "image", data: validJpeg, mimeType: "image/jpeg" };
		const valid = await request(server, {
			path: commandPath,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: { type: "prompt", message: "Inspect this", images: [validImage], streamingBehavior: "followUp" },
		});
		assert.equal(valid.status, 200);
		assert.equal(controller.commands.length, 1);

		const invalidMime = await request(server, {
			path: commandPath,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: {
				type: "prompt",
				message: "Inspect this",
				images: [{ ...validImage, mimeType: "image/svg+xml" }],
			},
		});
		assert.equal(invalidMime.status, 400);

		const tooMany = await request(server, {
			path: commandPath,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: { type: "prompt", message: "Inspect these", images: Array.from({ length: 4 }, () => validImage) },
		});
		assert.equal(tooMany.status, 400);

		const oversized = await request(server, {
			path: commandPath,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: {
				type: "prompt",
				message: "Inspect this",
				images: [{ type: "image", data: `/9j/${Buffer.alloc(1_500_000).toString("base64")}`, mimeType: "image/jpeg" }],
			},
		});
		assert.equal(oversized.status, 413);

		const invalidStreamingBehavior = await request(server, {
			path: commandPath,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: { type: "prompt", message: "Hello", streamingBehavior: "immediate" },
		});
		assert.equal(invalidStreamingBehavior.status, 400);

		const invalidBashFlag = await request(server, {
			path: commandPath,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: { type: "bash", command: "pwd", excludeFromContext: "yes" },
		});
		assert.equal(invalidBashFlag.status, 400);
		assert.equal(controller.commands.length, 1);
	});

	test("keeps SSE attached and replays missed bounded history by Last-Event-ID", async () => {
		const { server, controller } = await createFixture();
		const auth = await pair(server);
		const spawned = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});
		const instance = spawned.json.instance as InstanceSummary;

		const firstStream = await openEventStream(server, instance.id, auth.cookie, undefined, TEST_CLIENT_ID);
		await firstStream.readUntil(/event: snapshot/);
		controller.publish(instance.id, {
			type: "instance_status",
			instanceId: instance.id,
			status: "online",
			error: "first",
		});
		const firstEvents = await firstStream.readUntil(/"error":"first"/);
		assert.match(firstEvents, /id: 1/);
		firstStream.response.destroy();
		firstStream.request.destroy();
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));

		controller.publish(instance.id, {
			type: "instance_status",
			instanceId: instance.id,
			status: "online",
			error: "second",
		});
		const resumedStream = await openEventStream(server, instance.id, auth.cookie, 1, TEST_CLIENT_ID);
		const resumedEvents = await resumedStream.readUntil(/"error":"second"/);
		assert.match(resumedEvents, /id: 2/);
		const streamClosed = new Promise<void>((resolveClosed, rejectClosed) => {
			const timeout = setTimeout(() => rejectClosed(new Error("SSE did not close after logout")), 2_000);
			const finish = () => {
				clearTimeout(timeout);
				resolveClosed();
			};
			resumedStream.response.once("end", finish);
			resumedStream.response.once("close", finish);
		});
		const logout = await request(server, {
			path: "/api/logout",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});
		assert.equal(logout.status, 200);
		await streamClosed;
		resumedStream.request.destroy();
	});

	test("rate-limits pairing attempts and bounds JSON request bodies", async () => {
		const { server } = await createFixture(128);
		for (let attempt = 0; attempt < 5; attempt += 1) {
			const response = await request(server, {
				path: "/api/pair",
				method: "POST",
				origin: server.origin,
				body: { code: "000000" === server.pairingCode ? "000001" : "000000" },
			});
			assert.equal(response.status, 401);
		}
		const limited = await request(server, {
			path: "/api/pair",
			method: "POST",
			origin: server.origin,
			body: { code: server.pairingCode },
		});
		assert.equal(limited.status, 429);
		assert.ok(limited.headers["retry-after"]);

		const bodyFixture = await createFixture(128);
		const auth = await pair(bodyFixture.server);
		const oversized = await request(bodyFixture.server, {
			path: "/api/instances",
			method: "POST",
			origin: bodyFixture.server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: { label: "x".repeat(200) },
		});
		assert.equal(oversized.status, 413);
	});

	test("serves only the public asset root and applies mobile security headers", async () => {
		const { server } = await createFixture();
		const index = await request(server, { path: "/" });
		assert.equal(index.status, 200);
		assert.match(index.body, /Pi Pocket/);
		assert.equal(index.headers["x-frame-options"], "DENY");
		assert.equal(
			index.headers["permissions-policy"],
			"camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
		);

		const missingAsset = await request(server, { path: "/missing.js" });
		assert.equal(missingAsset.status, 404);
		const traversal = await request(server, { path: "/%2e%2e%2f%2e%2e%2fetc/passwd.txt" });
		assert.equal(traversal.status, 400);
	});

	test("rejects contradictory native TLS and insecure-cookie configuration", async () => {
		await assert.rejects(
			startPocketServer({
				workspaceRoot: "/",
				localInsecure: true,
				tls: { cert: "not-used", key: "not-used" },
			}),
			/localInsecure cannot be combined with native TLS/,
		);
	});
});

describe("controller leases", () => {
	test("binds ownership to session ID + client ID composite", () => {
		const leases = new ControllerLeases(1_000);
		// Same session, same client: claim succeeds (renew)
		assert.equal(leases.claim("inst", "session-a", "client-1", 10_000), true);
		// Same session, different client: rejected (other device)
		assert.equal(leases.claim("inst", "session-a", "client-2", 10_500), false);
		// Different session entirely: rejected
		assert.equal(leases.claim("inst", "session-b", "client-1", 10_500), false);
		// After expiry, anyone can claim
		assert.equal(leases.claim("inst", "session-c", "client-3", 11_001), true);
	});

	test("release with matching session+client works", () => {
		const leases = new ControllerLeases(1_000);
		leases.claim("inst", "session-a", "client-1", 10_000);
		// Wrong client: no-op
		leases.release("inst", "session-a", "client-2");
		assert.equal(leases.claim("inst", "session-a", "client-2", 10_500), false);
		// Correct client: releases
		leases.release("inst", "session-a", "client-1");
		assert.equal(leases.claim("inst", "session-a", "client-2", 10_500), true);
	});

	test("release with session only clears all leases for that session", () => {
		const leases = new ControllerLeases(10_000);
		leases.claim("inst-a", "session-a", "client-1", 10_000);
		leases.claim("inst-b", "session-a", "client-2", 10_000);
		leases.claim("inst-c", "session-b", "client-3", 10_000);
		leases.release("inst-a", "session-a");
		// session-a can now claim inst-a via another client
		assert.equal(leases.claim("inst-a", "session-a", "client-2", 10_500), true);
		// but not inst-b (still held by client-2 on session-a)
		assert.equal(leases.claim("inst-b", "session-a", "client-1", 10_500), false);
		// session-b unaffected
		assert.equal(leases.claim("inst-c", "session-b", "client-3", 11_000), true);
	});
});

describe("per-client controller ownership", () => {
	test("two clients sharing one session cannot concurrently mutate an instance", async () => {
		const { server } = await createFixture(undefined, { maxInstances: 2 });
		const auth = await pair(server);
		const clientA = "client-alpha";
		const clientB = "client-bravo";

		const spawned = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: clientA,
			body: { label: "alpha-instance" },
		});
		assert.equal(spawned.status, 201);
		const instance = spawned.json.instance as InstanceSummary;

		// Client A opens SSE (claims lease)
		const streamA = await openEventStream(server, instance.id, auth.cookie, undefined, clientA);
		await streamA.readUntil(/event: snapshot/);

		// Client A can send commands
		const cmdA = await request(server, {
			path: `/api/instances/${instance.id}/commands`,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: clientA,
			body: { command: { type: "prompt", message: "from A" } },
		});
		assert.equal(cmdA.status, 200);

		// Client B (same session, different client ID) is rejected
		const cmdB = await request(server, {
			path: `/api/instances/${instance.id}/commands`,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: clientB,
			body: { command: { type: "prompt", message: "from B" } },
		});
		assert.equal(cmdB.status, 409);
		assert.equal(cmdB.json.code, "controller_in_use");

		// Client B also can't open SSE
		const streamBRejected = await request(server, {
			path: `/api/instances/${instance.id}/events`,
			method: "GET",
			cookie: auth.cookie,
			clientId: clientB,
		});
		assert.equal(streamBRejected.status, 409);

		// Client B can't stop
		const stopB = await request(server, {
			path: `/api/instances/${instance.id}/stop`,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: clientB,
			body: {},
		});
		assert.equal(stopB.status, 409);

		// Client B can't send UI responses
		const uiB = await request(server, {
			path: `/api/instances/${instance.id}/ui-responses`,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: clientB,
			body: { response: { type: "extension_ui_response", id: "x", confirmed: true } },
		});
		assert.equal(uiB.status, 409);

		// Cleanup
		streamA.response.destroy();
		streamA.request.destroy();
		await new Promise((r) => setTimeout(r, 25));

		// Client A can still stop its own instance
		const stopA = await request(server, {
			path: `/api/instances/${instance.id}/stop`,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: clientA,
			body: {},
		});
		assert.equal(stopA.status, 200);
	});

	test("missing client ID returns client_id_required", async () => {
		const { server } = await createFixture();
		const auth = await pair(server);

		const spawned = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});
		assert.equal(spawned.status, 201);
		const instance = spawned.json.instance as InstanceSummary;

		const noClient = await request(server, {
			path: `/api/instances/${instance.id}/commands`,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: { command: { type: "prompt", message: "hi" } },
		});
		assert.equal(noClient.status, 400);
		assert.equal(noClient.json.code, "client_id_required");
	});
});

describe("SSE connection limits", () => {
	test("rejects more than 3 concurrent event stream connections per session", async () => {
		const { server } = await createFixture();
		const auth = await pair(server);
		const spawned = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});
		const instance = spawned.json.instance as InstanceSummary;

		const conn1 = await openEventStream(server, instance.id, auth.cookie, undefined, TEST_CLIENT_ID);
		await conn1.readUntil(/event: snapshot/);
		const conn2 = await openEventStream(server, instance.id, auth.cookie, undefined, TEST_CLIENT_ID);
		await conn2.readUntil(/event: snapshot/);
		const conn3 = await openEventStream(server, instance.id, auth.cookie, undefined, TEST_CLIENT_ID);
		await conn3.readUntil(/event: snapshot/);

		const rejected = await request(server, {
			path: `/api/instances/${instance.id}/events`,
			method: "GET",
			cookie: auth.cookie,
			clientId: TEST_CLIENT_ID,
		});
		assert.equal(rejected.status, 429);

		conn1.response.destroy();
		conn1.request.destroy();
		conn2.response.destroy();
		conn2.request.destroy();
		conn3.response.destroy();
		conn3.request.destroy();
	});
});

describe("instance spawn limits", () => {
	test("rejects spawning more than the maximum live instances", async () => {
		const { server } = await createFixture(undefined, { maxInstances: 8 });
		const auth = await pair(server);
		const ids: string[] = [];

		for (let attempt = 0; attempt < 9; attempt += 1) {
			const result = await request(server, {
				path: "/api/instances",
				method: "POST",
				origin: server.origin,
				cookie: auth.cookie,
				csrf: auth.csrf,
				body: { label: `test-${attempt}` },
			});
			if (attempt < 8) {
				assert.equal(result.status, 201);
				ids.push((result.json.instance as InstanceSummary).id);
			} else {
				assert.equal(result.status, 429);
			}
		}
		assert.equal(ids.length, 8);

		await Promise.all(
			ids.map((id) =>
				request(server, {
					path: `/api/instances/${id}/stop`,
					method: "POST",
					origin: server.origin,
					cookie: auth.cookie,
					csrf: auth.csrf,
					clientId: TEST_CLIENT_ID,
					body: {},
				}),
			),
		);
	});
});

describe("configurable instance capacity", () => {
	test("default max is 1 and bootstrap exposes capacity state", async () => {
		const { server } = await createFixture();
		const auth = await pair(server);

		const bootstrap = await request(server, {
			path: "/api/bootstrap",
			cookie: auth.cookie,
		});
		assert.equal(bootstrap.status, 200);
		assert.equal(bootstrap.json.maxInstances, 1);
		assert.equal(bootstrap.json.liveInstanceCount, 0);

		const first = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});
		assert.equal(first.status, 201);

		const second = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});
		assert.equal(second.status, 429);
		assert.equal(second.json.code, "capacity_exceeded");

		const afterBootstrap = await request(server, {
			path: "/api/bootstrap",
			cookie: auth.cookie,
		});
		assert.equal(afterBootstrap.json.liveInstanceCount, 1);
	});

	test("supports a custom maxInstances configuration", async () => {
		const { server } = await createFixture(undefined, { maxInstances: 3 });
		const auth = await pair(server);
		const ids: string[] = [];

		for (let attempt = 0; attempt < 4; attempt += 1) {
			const result = await request(server, {
				path: "/api/instances",
				method: "POST",
				origin: server.origin,
				cookie: auth.cookie,
				csrf: auth.csrf,
				body: { label: `test-${attempt}` },
			});
			if (attempt < 3) {
				assert.equal(result.status, 201);
				ids.push((result.json.instance as InstanceSummary).id);
			} else {
				assert.equal(result.status, 429);
				assert.equal(result.json.code, "capacity_exceeded");
			}
		}
		assert.equal(ids.length, 3);

		await Promise.all(
			ids.map((id) =>
				request(server, {
					path: `/api/instances/${id}/stop`,
					method: "POST",
					origin: server.origin,
					cookie: auth.cookie,
					csrf: auth.csrf,
					clientId: TEST_CLIENT_ID,
					body: {},
				}),
			),
		);
	});

	test("stopping an instance frees a slot", async () => {
		const { server } = await createFixture();
		const auth = await pair(server);

		const first = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: { label: "only" },
		});
		assert.equal(first.status, 201);
		const instance = first.json.instance as InstanceSummary;

		const blocked = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});
		assert.equal(blocked.status, 429);

		const stopped = await request(server, {
			path: `/api/instances/${instance.id}/stop`,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: {},
		});
		assert.equal(stopped.status, 200);

		const retry = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});
		assert.equal(retry.status, 201);
	});

	test("concurrent create requests respect the cap", async () => {
		const { server } = await createFixture(undefined, { maxInstances: 2 });
		const auth = await pair(server);

		const results = await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				request(server, {
					path: "/api/instances",
					method: "POST",
					origin: server.origin,
					cookie: auth.cookie,
					csrf: auth.csrf,
					body: { label: `concurrent-${i}` },
				}),
			),
		);

		const created = results.filter((r) => r.status === 201);
		const rejected = results.filter((r) => r.status === 429);
		assert.equal(created.length, 2);
		assert.equal(rejected.length, 3);
		for (const r of rejected) {
			assert.equal(r.json.code, "capacity_exceeded");
		}

		await Promise.all(
			created.map((r) => {
				const inst = r.json.instance as InstanceSummary;
				return request(server, {
					path: `/api/instances/${inst.id}/stop`,
					method: "POST",
					origin: server.origin,
					cookie: auth.cookie,
					csrf: auth.csrf,
					clientId: TEST_CLIENT_ID,
					body: {},
				});
			}),
		);
	});

	test("returns a stable capacity_exceeded error shape", async () => {
		const { server } = await createFixture();
		const auth = await pair(server);

		await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});

		const overflow = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});
		assert.equal(overflow.status, 429);
		assert.equal(overflow.json.code, "capacity_exceeded");
		assert.equal(typeof overflow.json.error, "string");
		assert.match(String(overflow.json.error), /capacity/i);
	});
});

describe("API rate limiting", () => {
	test("rejects requests exceeding the configured per-session POST limit", async () => {
		const { server } = await createFixture(undefined, {
			apiRateLimit: { windowMs: 10_000, maxRequests: 3 },
			maxInstances: 4,
		});
		const auth = await pair(server);

		const first = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});
		assert.equal(first.status, 201);

		const second = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});
		assert.equal(second.status, 201);

		const limited = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});
		assert.equal(limited.status, 201);

		const overLimit = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {},
		});
		assert.equal(overLimit.status, 429);
	});
});

describe("image signature validation", () => {
	test("accepts a valid JPEG signature", async () => {
		const { server } = await createFixture();
		const auth = await pair(server);
		const spawned = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: {},
		});
		const instance = spawned.json.instance as InstanceSummary;
		const path = `/api/instances/${instance.id}/commands`;

		const res = await request(server, {
			path,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: { type: "prompt", message: "hi", images: [{ type: "image", data: "/9j/", mimeType: "image/jpeg" }] },
		});
		assert.equal(res.status, 200);
	});

	test("rejects PNG data declared as JPEG (signature mismatch)", async () => {
		const { server } = await createFixture();
		const auth = await pair(server);
		const spawned = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: {},
		});
		const instance = spawned.json.instance as InstanceSummary;
		const path = `/api/instances/${instance.id}/commands`;

		// iVBORw0KGgo = PNG 8-byte signature
		const res = await request(server, {
			path,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: {
				type: "prompt",
				message: "hi",
				images: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/jpeg" }],
			},
		});
		assert.equal(res.status, 400);
		assert.equal(res.json.code, "invalid_images");
	});

	test("accepts a valid PNG signature", async () => {
		const { server } = await createFixture();
		const auth = await pair(server);
		const spawned = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: {},
		});
		const instance = spawned.json.instance as InstanceSummary;
		const path = `/api/instances/${instance.id}/commands`;

		const res = await request(server, {
			path,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: { type: "prompt", message: "hi", images: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }] },
		});
		assert.equal(res.status, 200);
	});

	test("rejects data too short for the declared MIME signature", async () => {
		const { server } = await createFixture();
		const auth = await pair(server);
		const spawned = await request(server, {
			path: "/api/instances",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: {},
		});
		const instance = spawned.json.instance as InstanceSummary;
		const path = `/api/instances/${instance.id}/commands`;

		// Only 2 bytes, too short for PNG's 8-byte signature
		const res = await request(server, {
			path,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: { type: "prompt", message: "hi", images: [{ type: "image", data: "AAA=", mimeType: "image/png" }] },
		});
		assert.equal(res.status, 400);
	});
});

describe("debug log and error redaction", () => {
	test("debug log endpoint returns entries with redacted content", async () => {
		const { server } = await createFixture();
		const auth = await pair(server);

		// Send a malformed request to trigger a 500 (errorId in response)
		const _bad = await request(server, {
			path: "/api/instances/this-id-does-not-exist/messages",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: { type: "prompt", message: "test" },
		});

		const logs = await request(server, {
			path: "/api/debug/logs",
			cookie: auth.cookie,
		});
		assert.equal(logs.status, 200);
		assert.ok(Array.isArray(logs.json.entries));
	});

	test("HttpError responses contain no errorId (reserved for server faults)", async () => {
		const { server } = await createFixture();
		const auth = await pair(server);

		const result = await request(server, {
			path: "/api/instances/nonexistent-id/messages",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: { type: "prompt", message: "x" },
		});
		// This is an expected HttpError, not a server fault
		assert.equal(result.status, 404);
		assert.equal(result.json.code, "unknown_instance");
		assert.equal(result.json.errorId, undefined);
	});

	test("debug log entries can be filtered by after parameter", async () => {
		const { server } = await createFixture();
		const auth = await pair(server);

		const result = await request(server, {
			path: "/api/instances/nonexistent-id/messages",
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			clientId: TEST_CLIENT_ID,
			body: { type: "prompt", message: "x" },
		});
		const errorId = result.json.errorId as string;

		const sinceError = await request(server, {
			path: `/api/debug/logs?after=${errorId}`,
			cookie: auth.cookie,
		});
		assert.equal(sinceError.status, 200);
		assert.ok(Array.isArray(sinceError.json.entries));
	});
});

describe("secure cookie prefix", () => {
	test("uses __Secure- prefix when running in secure mode", async () => {
		const { server } = await createFixture(undefined, {
			localInsecure: false,
			publicOrigin: "https://pocket.example.ts.net",
		});
		const auth = await pair(server);
		assert.match(auth.setCookie, /__Secure-pi_pocket_session=/);
		assert.match(auth.setCookie, /; Secure/);
	});

	test("does not use __Secure- prefix in local-insecure mode", async () => {
		const { server } = await createFixture();
		const auth = await pair(server);
		assert.doesNotMatch(auth.setCookie, /__Secure-pi_pocket_session/);
		assert.doesNotMatch(auth.setCookie, /; Secure/);
	});
});
