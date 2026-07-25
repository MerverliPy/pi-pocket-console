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
			body: { command: { type: "run_anything", command: "unsafe" } },
		});
		assert.equal(unknownCommand.status, 403);

		const command = await request(server, {
			path: `/api/instances/${instance.id}/commands`,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
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

		const validImage = { type: "image", data: "aA==", mimeType: "image/jpeg" };
		const valid = await request(server, {
			path: commandPath,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
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
			body: { type: "prompt", message: "Inspect these", images: Array.from({ length: 4 }, () => validImage) },
		});
		assert.equal(tooMany.status, 400);

		const oversized = await request(server, {
			path: commandPath,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: {
				type: "prompt",
				message: "Inspect this",
				images: [{ ...validImage, data: Buffer.alloc(1_500_001).toString("base64") }],
			},
		});
		assert.equal(oversized.status, 413);

		const invalidStreamingBehavior = await request(server, {
			path: commandPath,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
			body: { type: "prompt", message: "Hello", streamingBehavior: "immediate" },
		});
		assert.equal(invalidStreamingBehavior.status, 400);

		const invalidBashFlag = await request(server, {
			path: commandPath,
			method: "POST",
			origin: server.origin,
			cookie: auth.cookie,
			csrf: auth.csrf,
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

		const firstStream = await openEventStream(server, instance.id, auth.cookie);
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
		const resumedStream = await openEventStream(server, instance.id, auth.cookie, 1);
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
	test("permits one controller until expiry and supports explicit release", () => {
		const leases = new ControllerLeases(1_000);
		assert.equal(leases.claim("instance", "phone-a", 10_000), true);
		assert.equal(leases.claim("instance", "phone-b", 10_500), false);
		assert.equal(leases.claim("instance", "phone-b", 11_001), true);
		leases.release("instance", "phone-b");
		assert.equal(leases.claim("instance", "phone-a", 11_002), true);
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

		const conn1 = await openEventStream(server, instance.id, auth.cookie);
		await conn1.readUntil(/event: snapshot/);
		const conn2 = await openEventStream(server, instance.id, auth.cookie);
		await conn2.readUntil(/event: snapshot/);
		const conn3 = await openEventStream(server, instance.id, auth.cookie);
		await conn3.readUntil(/event: snapshot/);

		const rejected = await request(server, {
			path: `/api/instances/${instance.id}/events`,
			method: "GET",
			cookie: auth.cookie,
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
		const { server } = await createFixture();
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
					body: {},
				}),
			),
		);
	});
});

describe("API rate limiting", () => {
	test("rejects requests exceeding the configured per-session POST limit", async () => {
		const { server } = await createFixture(undefined, {
			apiRateLimit: { windowMs: 10_000, maxRequests: 3 },
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
