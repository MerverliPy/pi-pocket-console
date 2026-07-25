import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { InstanceManager } from "../src/instance-manager.ts";
import { isValidModelSelection, normalizeModel, normalizeModelList } from "../src/normalize-model.ts";
import { PocketRpcProcess, resolveRpcEntryPath } from "../src/rpc-process.ts";

describe("Pi RPC entry resolution", () => {
	test("uses the package's ESM import export", async () => {
		const entryPath = resolveRpcEntryPath();
		assert.match(entryPath, /pi-coding-agent[/\\]dist[/\\]rpc-entry\.js$/);
	});
});

describe("model normalization", () => {
	test("normalizes a model with id field", () => {
		const raw = {
			id: "claude-sonnet-4",
			provider: "anthropic",
			name: "Claude Sonnet",
			contextWindow: 200_000,
			reasoning: true,
		};
		const result = normalizeModel(raw);
		assert.ok(result);
		assert.equal(result?.provider, "anthropic");
		assert.equal(result?.modelId, "claude-sonnet-4");
		assert.equal(result?.name, "Claude Sonnet");
		assert.equal(result?.contextWindow, 200_000);
		assert.equal(result?.reasoning, true);
	});

	test("normalizes a model with modelId field", () => {
		const raw = { modelId: "gpt-4o", provider: "openai", name: "GPT-4o", contextWindow: 128_000, reasoning: false };
		const result = normalizeModel(raw);
		assert.ok(result);
		assert.equal(result?.provider, "openai");
		assert.equal(result?.modelId, "gpt-4o");
		assert.equal(result?.name, "GPT-4o");
	});

	test("prefers modelId over id when both present", () => {
		const raw = { id: "old-id", modelId: "new-id", provider: "test" };
		const result = normalizeModel(raw);
		assert.equal(result?.modelId, "new-id");
	});

	test("falls back from name to modelId", () => {
		const result = normalizeModel({ id: "m1", provider: "p1" });
		assert.equal(result?.name, "m1");
	});

	test("returns undefined for missing provider", () => {
		assert.equal(normalizeModel({ id: "m1" }), undefined);
		assert.equal(normalizeModel({ provider: "", modelId: "m1" }), undefined);
		assert.equal(normalizeModel(null), undefined);
		assert.equal(normalizeModel("string"), undefined);
	});

	test("returns undefined for missing modelId", () => {
		assert.equal(normalizeModel({ provider: "p1" }), undefined);
		assert.equal(normalizeModel({ provider: "p1", modelId: "" }), undefined);
	});

	test("normalizeModelList deduplicates by provider:modelId", () => {
		const raw = [
			{ id: "m1", provider: "p1" },
			{ id: "m1", provider: "p1" },
			{ id: "m2", provider: "p1" },
		];
		const result = normalizeModelList(raw);
		assert.equal(result.length, 2);
	});

	test("normalizeModelList filters invalid entries", () => {
		const raw = [{ id: "m1", provider: "p1" }, { id: "m2" }, null, "string"];
		const result = normalizeModelList(raw);
		assert.equal(result.length, 1);
	});

	test("normalizeModelList handles non-array input", () => {
		assert.deepEqual(normalizeModelList(null), []);
		assert.deepEqual(normalizeModelList(undefined), []);
	});

	test("isValidModelSelection rejects invalid inputs", () => {
		const available = [{ provider: "p1", modelId: "m1", name: "M1", contextWindow: 0, reasoning: false }];
		assert.equal(isValidModelSelection("p1", "m1", available), true);
		assert.equal(isValidModelSelection("p1", "mx", available), false);
		assert.equal(isValidModelSelection("", "m1", available), false);
		assert.equal(isValidModelSelection(undefined, "m1", available), false);
		assert.equal(isValidModelSelection("p1", undefined, available), false);
	});
});

describe("RPC process lifecycle", () => {
	const tmpDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true }).catch(() => {})));
	});

	async function createTestScript(
		behavior: "echo" | "slow" | "partial" | "noisy" | "oversized" | "multi",
	): Promise<string> {
		const dir = mkdtempSync(join(tmpdir(), "rpc-test-"));
		tmpDirs.push(dir);

		let script: string;
		switch (behavior) {
			case "echo":
				script = `
					import { createInterface } from "node:readline";
					const rl = createInterface({ input: process.stdin });
					for await (const line of rl) {
						try {
							const cmd = JSON.parse(line);
							const response = { id: cmd.id, type: "response", command: cmd.type, success: true };
							process.stdout.write(JSON.stringify(response) + "\\n");
						} catch {}
					}
				`;
				break;
			case "slow":
				script = `
					import { createInterface } from "node:readline";
					const rl = createInterface({ input: process.stdin });
					for await (const line of rl) {
						try {
							const cmd = JSON.parse(line);
							await new Promise(r => setTimeout(r, 60_000));
							const response = { id: cmd.id, type: "response", command: cmd.type, success: true };
							process.stdout.write(JSON.stringify(response) + "\\n");
						} catch {}
					}
				`;
				break;
			case "partial":
				script = `
					import { createInterface } from "node:readline";
					const rl = createInterface({ input: process.stdin });
					for await (const line of rl) {
						try {
							const cmd = JSON.parse(line);
							const response = JSON.stringify({ id: cmd.id, type: "response", command: cmd.type, success: true });
							const mid = Math.floor(response.length / 2);
							process.stdout.write(response.slice(0, mid));
							await new Promise(r => setTimeout(r, 30));
							process.stdout.write(response.slice(mid) + "\\n");
						} catch {}
					}
				`;
				break;
			case "noisy":
				script = `
					process.stdout.write("invalid json\\n");
					import { createInterface } from "node:readline";
					const rl = createInterface({ input: process.stdin });
					for await (const line of rl) {
						try {
							const cmd = JSON.parse(line);
							const response = { id: cmd.id, type: "response", command: cmd.type, success: true };
							process.stdout.write(JSON.stringify(response) + "\\n");
						} catch {}
					}
				`;
				break;
			case "oversized":
				script = `
					process.stdout.write("x".repeat(2_000_000) + "\\n");
				`;
				break;
			case "multi":
				script = `
					import { createInterface } from "node:readline";
					const rl = createInterface({ input: process.stdin });
					for await (const line of rl) {
						try {
							const cmd = JSON.parse(line);
							const response = { id: cmd.id, type: "response", command: cmd.type, success: true };
							process.stdout.write(JSON.stringify(response) + "\\n");
						} catch {}
					}
				`;
				break;
		}
		const filePath = join(dir, "fake-rpc.mjs");
		writeFileSync(filePath, script);
		return filePath;
	}

	test("response before timeout resolves once", async () => {
		const entryPath = await createTestScript("echo");
		const proc = new PocketRpcProcess(tmpdir(), 30_000, entryPath);
		try {
			const result = await proc.send({ type: "get_state" });
			assert.equal(result.type, "response");
			assert.equal(result.success, true);
		} finally {
			await proc.dispose();
		}
	});

	test("timeout rejects and removes pending state", async () => {
		const entryPath = await createTestScript("slow");
		const proc = new PocketRpcProcess(tmpdir(), 100, entryPath);
		try {
			await assert.rejects(proc.send({ type: "get_state" }), /timed out/);
		} finally {
			await proc.dispose();
		}
	});

	test("child exit rejects and clears all pending requests", async () => {
		const entryPath = await createTestScript("echo");
		const proc = new PocketRpcProcess(tmpdir(), 30_000, entryPath);
		const sendPromise = proc.send({ type: "get_state" });
		proc.child.kill("SIGTERM");
		await assert.rejects(sendPromise, /exited/);
	});

	test("dispose clears timeout resources", async () => {
		const entryPath = await createTestScript("slow");
		const proc = new PocketRpcProcess(tmpdir(), 100, entryPath);
		const sendPromise = proc.send({ type: "get_state" });
		const rejects = assert.rejects(sendPromise);
		await proc.dispose();
		await rejects;
	});

	test("partial chunk across data events is reassembled correctly", async () => {
		const entryPath = await createTestScript("partial");
		const proc = new PocketRpcProcess(tmpdir(), 5_000, entryPath);
		try {
			const result = await proc.send({ type: "get_state" });
			assert.equal(result.type, "response");
			assert.equal(result.success, true);
		} finally {
			await proc.dispose();
		}
	});

	test("invalid JSON on stdout does not corrupt later processing", async () => {
		const entryPath = await createTestScript("noisy");
		const proc = new PocketRpcProcess(tmpdir(), 2_000, entryPath);
		await assert.rejects(proc.send({ type: "get_state" }), /invalid JSON/);
		await proc.dispose();
	});

	test("oversized line causes process exit", async () => {
		const entryPath = await createTestScript("oversized");
		const proc = new PocketRpcProcess(tmpdir(), 2_000, entryPath);
		await assert.rejects(proc.send({ type: "get_state" }));
		await proc.dispose();
	});

	test("multiple lines in a single chunk are processed separately", async () => {
		const entryPath = await createTestScript("multi");
		const proc = new PocketRpcProcess(tmpdir(), 5_000, entryPath);
		try {
			const [r1, r2] = await Promise.all([
				proc.send({ type: "get_state" }),
				proc.send({ type: "get_available_models" }),
			]);
			assert.equal(r1.success, true);
			assert.equal(r2.success, true);
		} finally {
			await proc.dispose();
		}
	});

	test("dispose rejects every remaining pending request", async () => {
		const entryPath = await createTestScript("slow");
		const proc = new PocketRpcProcess(tmpdir(), 5_000, entryPath);
		const promises = Promise.allSettled([
			proc.send({ type: "get_state" }),
			proc.send({ type: "get_available_models" }),
		]);
		await proc.dispose();
		const results = await promises;
		for (const r of results) {
			assert.equal(r.status, "rejected");
		}
	});

	test("multiple dispose calls are safe", async () => {
		const entryPath = await createTestScript("echo");
		const proc = new PocketRpcProcess(tmpdir(), 5_000, entryPath);
		await proc.dispose();
		await proc.dispose();
	});
});

describe("instance startup cleanup", () => {
	test("failed instance initialization leaves no ghost instance", async () => {
		const manager = new InstanceManager("/nonexistent-workspace");
		await assert.rejects(manager.spawn("test-fail"));
		assert.equal(manager.list().length, 0);
	});
});
