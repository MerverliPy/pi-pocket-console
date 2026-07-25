import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	applyTransition,
	stateAllowsAttach,
	stateAllowsInput,
	stateAllowsResize,
	stateIsActive,
	stateIsTerminal,
	validateTransition,
} from "../src/lifecycle/state-machine.ts";
import type { TerminalLifecycleRecord, TerminalState } from "../src/protocol/types.ts";

function makeRecord(state: TerminalState): TerminalLifecycleRecord {
	return {
		sessionId: "test-session",
		state,
		workspaceId: "ws-1",
		launcherId: "default-shell",
		createdAt: new Date().toISOString(),
		stateChangedAt: new Date().toISOString(),
		lastActivityAt: new Date().toISOString(),
		leaseGeneration: 0,
		lastOutputSequence: 0,
	};
}

describe("validateTransition", () => {
	test("CREATING -> RUNNING on spawnSucceeded", () => {
		const result = validateTransition("CREATING", { type: "spawnSucceeded" });
		assert.equal(result.allowed, true);
		if (result.allowed) {
			assert.equal(result.newState, "RUNNING");
			assert.equal(result.previousState, "CREATING");
		}
	});

	test("CREATING -> FAILED on spawnFailed", () => {
		const result = validateTransition("CREATING", { type: "spawnFailed", message: "pty error" });
		assert.equal(result.allowed, true);
		if (result.allowed) {
			assert.equal(result.newState, "FAILED");
		}
	});

	test("CREATING -> TERMINATING on terminateRequested", () => {
		const result = validateTransition("CREATING", { type: "terminateRequested", mode: "force" });
		assert.equal(result.allowed, true);
		if (result.allowed) {
			assert.equal(result.newState, "TERMINATING");
		}
	});

	test("RUNNING -> DETACHED on transportLost", () => {
		const result = validateTransition("RUNNING", { type: "transportLost" });
		assert.equal(result.allowed, true);
		if (result.allowed) {
			assert.equal(result.newState, "DETACHED");
		}
	});

	test("RUNNING -> TERMINATING on terminateRequested", () => {
		const result = validateTransition("RUNNING", { type: "terminateRequested", mode: "graceful" });
		assert.equal(result.allowed, true);
		if (result.allowed) {
			assert.equal(result.newState, "TERMINATING");
		}
	});

	test("RUNNING -> FAILED on unrecoverableError", () => {
		const result = validateTransition("RUNNING", { type: "unrecoverableError", message: "io failure" });
		assert.equal(result.allowed, true);
		if (result.allowed) {
			assert.equal(result.newState, "FAILED");
		}
	});

	test("DETACHED -> RECONNECTING on reconnectBegan", () => {
		const result = validateTransition("DETACHED", { type: "reconnectBegan" });
		assert.equal(result.allowed, true);
		if (result.allowed) {
			assert.equal(result.newState, "RECONNECTING");
		}
	});

	test("DETACHED -> EXPIRED on reconnectDeadlineExceeded", () => {
		const result = validateTransition("DETACHED", { type: "reconnectDeadlineExceeded" });
		assert.equal(result.allowed, true);
		if (result.allowed) {
			assert.equal(result.newState, "EXPIRED");
		}
	});

	test("RECONNECTING -> RUNNING on replaySynchronized", () => {
		const result = validateTransition("RECONNECTING", { type: "replaySynchronized" });
		assert.equal(result.allowed, true);
		if (result.allowed) {
			assert.equal(result.newState, "RUNNING");
		}
	});

	test("RECONNECTING -> DETACHED on transportLost", () => {
		const result = validateTransition("RECONNECTING", { type: "transportLost" });
		assert.equal(result.allowed, true);
		if (result.allowed) {
			assert.equal(result.newState, "DETACHED");
		}
	});

	test("TERMINATING -> TERMINATED on cleanupComplete", () => {
		const result = validateTransition("TERMINATING", { type: "cleanupComplete" });
		assert.equal(result.allowed, true);
		if (result.allowed) {
			assert.equal(result.newState, "TERMINATED");
		}
	});

	test("TERMINATING -> FAILED on cleanupFailed", () => {
		const result = validateTransition("TERMINATING", {
			type: "cleanupFailed",
			message: "cleanup error",
			processMayStillBeActive: true,
		});
		assert.equal(result.allowed, true);
		if (result.allowed) {
			assert.equal(result.newState, "FAILED");
		}
	});

	test("TERMINATED rejects all transitions", () => {
		const result = validateTransition("TERMINATED", { type: "spawnSucceeded" });
		assert.equal(result.allowed, false);
		assert.ok(result.error);
	});

	test("FAILED rejects all transitions", () => {
		const result = validateTransition("FAILED", { type: "spawnSucceeded" });
		assert.equal(result.allowed, false);
		assert.ok(result.error);
	});

	test("rejects invalid transition from RUNNING", () => {
		const result = validateTransition("RUNNING", { type: "reconnectBegan" });
		assert.equal(result.allowed, false);
		assert.ok(result.error);
	});
});

describe("applyTransition", () => {
	test("updates record on successful transition", () => {
		const record = makeRecord("CREATING");
		const result = applyTransition(record, { type: "spawnSucceeded" });

		assert.equal(result.allowed, true);
		assert.equal(record.state, "RUNNING");
		assert.equal(record.previousState, "CREATING");
		assert.ok(record.stateChangedAt);
	});

	test("does not modify record on failed transition", () => {
		const record = makeRecord("TERMINATED");
		const originalState = record.state;
		const result = applyTransition(record, { type: "spawnSucceeded" });

		assert.equal(result.allowed, false);
		assert.equal(record.state, originalState);
	});
});

describe("state predicates", () => {
	test("stateAllowsInput only in RUNNING", () => {
		assert.equal(stateAllowsInput("RUNNING"), true);
		assert.equal(stateAllowsInput("CREATING"), false);
		assert.equal(stateAllowsInput("DETACHED"), false);
		assert.equal(stateAllowsInput("RECONNECTING"), false);
		assert.equal(stateAllowsInput("TERMINATING"), false);
		assert.equal(stateAllowsInput("TERMINATED"), false);
		assert.equal(stateAllowsInput("EXPIRED"), false);
		assert.equal(stateAllowsInput("FAILED"), false);
	});

	test("stateAllowsResize only in RUNNING", () => {
		assert.equal(stateAllowsResize("RUNNING"), true);
		assert.equal(stateAllowsResize("CREATING"), false);
		assert.equal(stateAllowsResize("DETACHED"), false);
		assert.equal(stateAllowsResize("TERMINATED"), false);
	});

	test("stateAllowsAttach in DETACHED and RECONNECTING", () => {
		assert.equal(stateAllowsAttach("DETACHED"), true);
		assert.equal(stateAllowsAttach("RECONNECTING"), true);
		assert.equal(stateAllowsAttach("RUNNING"), false);
		assert.equal(stateAllowsAttach("TERMINATED"), false);
	});

	test("stateIsTerminal for terminal states", () => {
		assert.equal(stateIsTerminal("TERMINATED"), true);
		assert.equal(stateIsTerminal("FAILED"), true);
		assert.equal(stateIsTerminal("RUNNING"), false);
		assert.equal(stateIsTerminal("DETACHED"), false);
	});

	test("stateIsActive for non-terminal non-expired states", () => {
		assert.equal(stateIsActive("CREATING"), true);
		assert.equal(stateIsActive("RUNNING"), true);
		assert.equal(stateIsActive("DETACHED"), true);
		assert.equal(stateIsActive("RECONNECTING"), true);
		assert.equal(stateIsActive("TERMINATING"), false);
		assert.equal(stateIsActive("TERMINATED"), false);
		assert.equal(stateIsActive("FAILED"), false);
		assert.equal(stateIsActive("EXPIRED"), false);
	});
});

describe("complete lifecycle flows", () => {
	test("full creation to termination flow", () => {
		const record = makeRecord("CREATING");
		let result = applyTransition(record, { type: "spawnSucceeded" });
		assert.equal(record.state, "RUNNING");

		result = applyTransition(record, { type: "terminateRequested", mode: "graceful" });
		assert.equal(record.state, "TERMINATING");

		result = applyTransition(record, { type: "cleanupComplete" });
		assert.equal(record.state, "TERMINATED");

		assert.equal(result.allowed, true);
	});

	test("detach, reconnect, resume flow", () => {
		const record = makeRecord("RUNNING");
		applyTransition(record, { type: "transportLost" });
		assert.equal(record.state, "DETACHED");

		applyTransition(record, { type: "reconnectBegan" });
		assert.equal(record.state, "RECONNECTING");

		applyTransition(record, { type: "replaySynchronized" });
		assert.equal(record.state, "RUNNING");
	});

	test("detach, expire, terminate flow", () => {
		const record = makeRecord("RUNNING");
		applyTransition(record, { type: "transportLost" });
		assert.equal(record.state, "DETACHED");

		applyTransition(record, { type: "reconnectDeadlineExceeded" });
		assert.equal(record.state, "EXPIRED");

		applyTransition(record, { type: "cleanupComplete" });
		assert.equal(record.state, "TERMINATED");
	});

	test("reconnect interrupted by transport loss", () => {
		const record = makeRecord("RUNNING");
		applyTransition(record, { type: "transportLost" });
		assert.equal(record.state, "DETACHED");

		applyTransition(record, { type: "reconnectBegan" });
		assert.equal(record.state, "RECONNECTING");

		applyTransition(record, { type: "transportLost" });
		assert.equal(record.state, "DETACHED");
	});

	test("unrecoverable error from RUNNING", () => {
		const record = makeRecord("RUNNING");
		applyTransition(record, { type: "unrecoverableError", message: "PTY I/O failure" });
		assert.equal(record.state, "FAILED");

		const noTransition = validateTransition("FAILED", { type: "spawnSucceeded" });
		assert.equal(noTransition.allowed, false);
	});
});
