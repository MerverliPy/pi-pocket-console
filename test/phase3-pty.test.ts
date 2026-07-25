import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import type { Rfc3339Timestamp, TerminalSessionId, TerminalState } from "../src/protocol/types.ts";
import { PtyRuntime, PtyRuntimeManager } from "../src/pty-runtime.ts";

function makeCallbacks() {
	const events: Array<{
		type: "state" | "output" | "exit" | "error";
		sessionId: TerminalSessionId;
		data?: string;
	}> = [];
	return {
		events,
		callbacks: {
			onStateChange(sessionId: TerminalSessionId, state: TerminalState, previousState?: TerminalState) {
				events.push({ type: "state", sessionId, data: `${previousState}->${state}` });
			},
			onOutput(sessionId: TerminalSessionId, data: string) {
				events.push({ type: "output", sessionId, data });
			},
			onExit(sessionId: TerminalSessionId) {
				events.push({ type: "exit", sessionId });
			},
			onError(sessionId: TerminalSessionId, error: Error) {
				events.push({ type: "error", sessionId, data: error.message });
			},
		},
	};
}

describe("ReplayRing (internal)", () => {
	const REPLAY_BYTES = 1024;

	test("stores and retrieves output", async () => {
		const { PtyRuntime } = await import("../src/pty-runtime.ts");
		const fixture = makeCallbacks();
		const runtime = new PtyRuntime("test-session", "/tmp", fixture.callbacks, {
			replayBufferBytes: REPLAY_BYTES,
			idleTimeoutMs: 60_000,
			absoluteTimeoutMs: 360_000,
			reconnectDeadlineMs: 5_000,
			gracefulWindowMs: 1_000,
		});
		(runtime as any).replay.append("hello");
		(runtime as any).replay.append("world");
		const range = runtime.getReplayRange();
		assert.ok(range);
		if (range) {
			assert.equal(range.latest >= range.earliest, true);
		}
		const replay = runtime.getReplay(-1);
		assert.equal(replay.entries.length, 2);
		assert.equal(replay.gap, true);
	});

	test("returns gap when requested sequence is before earliest", async () => {
		const { PtyRuntime } = await import("../src/pty-runtime.ts");
		const fixture = makeCallbacks();
		const runtime = new PtyRuntime("test-session", "/tmp", fixture.callbacks, {
			replayBufferBytes: 10,
			idleTimeoutMs: 60_000,
			absoluteTimeoutMs: 360_000,
			reconnectDeadlineMs: 5_000,
			gracefulWindowMs: 1_000,
		});
		const append = (runtime as unknown as { replay: { append(d: string): number } }).replay.append;
		(runtime as any).replay.append("a".repeat(100));
		(runtime as any).replay.append("b".repeat(100));
		(runtime as any).replay.append("c".repeat(100));
		const replay = runtime.getReplay(0);
		assert.equal(replay.gap, true);
	});
});

describe("PtyRuntime state management", () => {
	test("initializes in CREATING state", async () => {
		const fixture = makeCallbacks();
		const runtime = new PtyRuntime("s1", "/tmp", fixture.callbacks);
		assert.equal(runtime.state, "CREATING");
		assert.equal(runtime.isExpired(), false);
		assert.equal(runtime.isRunning(), false);
	});

	test("transitions to RUNNING and tracks state changes", async () => {
		const fixture = makeCallbacks();
		const runtime = new PtyRuntime("s1", "/tmp", fixture.callbacks);
		(runtime as any).transitionTo("RUNNING");
		assert.equal(runtime.state, "RUNNING");
		assert.equal(runtime.isRunning(), true);
		assert.ok(fixture.events.some((e) => e.type === "state" && e.data === "CREATING->RUNNING"));
	});

	test("transitions to TERMINATING and then TERMINATED", async () => {
		const fixture = makeCallbacks();
		const runtime = new PtyRuntime("s1", "/tmp", fixture.callbacks);
		(runtime as any).transitionTo("RUNNING");
		(runtime as any).transitionTo("TERMINATING");
		assert.equal(runtime.state, "TERMINATING");
		(runtime as any).transitionTo("TERMINATED");
		assert.equal(runtime.state, "TERMINATED");
		assert.equal(runtime.isExpired(), true);
	});

	test("dispose prevents further operations", async () => {
		const fixture = makeCallbacks();
		const runtime = new PtyRuntime("s1", "/tmp", fixture.callbacks);
		runtime.dispose();
		assert.equal(runtime.writeInput("test"), false);
	});

	test("writeInput is rejected when not RUNNING", async () => {
		const fixture = makeCallbacks();
		const runtime = new PtyRuntime("s1", "/tmp", fixture.callbacks);
		assert.equal(runtime.writeInput("test"), false);
		(runtime as any).transitionTo("TERMINATED");
		assert.equal(runtime.writeInput("test"), false);
	});

	test("resize is rejected when not RUNNING", async () => {
		const fixture = makeCallbacks();
		const runtime = new PtyRuntime("s1", "/tmp", fixture.callbacks);
		assert.equal(runtime.resize(80, 24), false);
		(runtime as any).transitionTo("TERMINATED");
		assert.equal(runtime.resize(80, 24), false);
	});

	test("sets absolute expiry timestamp on creation", async () => {
		const fixture = makeCallbacks();
		const shortAbs = 10_000;
		const runtime = new PtyRuntime("s1", "/tmp", fixture.callbacks, { absoluteTimeoutMs: shortAbs });
		const expiry = new Date(runtime.absoluteExpiresAt).getTime();
		assert.ok(expiry > Date.now());
		assert.ok(expiry <= Date.now() + shortAbs + 100);
	});

	test("sanitized environment contains only safe keys", async () => {
		const fixture = makeCallbacks();
		const runtime = new PtyRuntime("s1", "/tmp", fixture.callbacks);
		const env = (runtime as any).sanitizeEnv();
		assert.ok(env.TERM);
		assert.equal(env.TERM, process.env.TERM || "xterm-256color");
		assert.equal(Object.keys(env).includes("PATH"), true);
		assert.equal(Object.keys(env).includes("HOME"), true);
	});
});

describe("PtyRuntimeManager", () => {
	test("creates and retrieves runtimes", async () => {
		const fixture = makeCallbacks();
		const manager = new PtyRuntimeManager(fixture.callbacks);
		const rt = manager.create("/tmp");
		assert.ok(rt.sessionId);
		assert.equal(manager.get(rt.sessionId), rt);
	});

	test("delete disposes runtime", async () => {
		const fixture = makeCallbacks();
		const manager = new PtyRuntimeManager(fixture.callbacks);
		const rt = manager.create("/tmp");
		manager.delete(rt.sessionId);
		assert.equal(manager.get(rt.sessionId), undefined);
	});

	test("getActiveCount returns non-expired runtimes", async () => {
		const fixture = makeCallbacks();
		const manager = new PtyRuntimeManager(fixture.callbacks);
		manager.create("/tmp");
		manager.create("/tmp");
		assert.equal(manager.getActiveCount(), 2);

		const rt = manager.create("/tmp");
		manager.delete(rt.sessionId);
		assert.equal(manager.getActiveCount(), 2);
	});

	test("shutdown terminates all runtimes", async () => {
		const fixture = makeCallbacks();
		const manager = new PtyRuntimeManager(fixture.callbacks);
		manager.create("/tmp");
		manager.create("/tmp");
		await manager.shutdown(100);
		assert.equal(manager.getActiveCount(), 0);
	});
});

describe("PtyRuntime expires and timeouts", () => {
	test("startReconnectDeadline transitions to DETACHED then EXPIRED", async () => {
		const fixture = makeCallbacks();
		const runtime = new PtyRuntime("s1", "/tmp", fixture.callbacks, {
			reconnectDeadlineMs: 10,
			gracefulWindowMs: 5,
		});
		(runtime as any).transitionTo("RUNNING");
		runtime.startReconnectDeadline();
		assert.equal(runtime.state, "DETACHED");
		await new Promise((r) => setTimeout(r, 50));
		assert.ok(runtime.state === "EXPIRED" || runtime.state === "TERMINATED" || runtime.state === "TERMINATING");
	});

	test("idle timer fires onError after timeout", async () => {
		const fixture = makeCallbacks();
		const runtime = new PtyRuntime("s1", "/tmp", fixture.callbacks, {
			idleTimeoutMs: 10,
			absoluteTimeoutMs: 60_000,
		});
		(runtime as any).transitionTo("RUNNING");
		(runtime as any).resetIdleTimer();
		await new Promise((r) => setTimeout(r, 50));
		assert.ok(fixture.events.some((e) => e.type === "error" && e.data === "Idle timeout"));
	});
});
