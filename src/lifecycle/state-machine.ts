import { TERMINAL_STATES } from "../protocol/constants.ts";
import { makeError } from "../protocol/errors.ts";
import type { TerminalLifecycleRecord, TerminalState } from "../protocol/types.ts";

const { CREATING, RUNNING, DETACHED, RECONNECTING, TERMINATING, TERMINATED, EXPIRED, FAILED } = TERMINAL_STATES;

export type TransitionEvent =
	| { type: "spawnSucceeded" }
	| { type: "spawnFailed"; message: string }
	| { type: "transportLost" }
	| { type: "reconnectBegan" }
	| { type: "replaySynchronized" }
	| { type: "terminateRequested"; mode: "graceful" | "force" }
	| { type: "ptyExited" }
	| { type: "unrecoverableError"; message: string }
	| { type: "reconnectDeadlineExceeded" }
	| { type: "idleExpired" }
	| { type: "absoluteExpired" }
	| { type: "cleanupComplete" }
	| { type: "cleanupFailed"; message: string; processMayStillBeActive: boolean };

export type TransitionResult =
	| { allowed: true; newState: TerminalState; previousState: TerminalState }
	| { allowed: false; error: ReturnType<typeof makeError> };

const TRANSITION_TABLE: Record<TerminalState, Record<string, TerminalState | undefined>> = {
	[CREATING]: {
		spawnSucceeded: RUNNING,
		spawnFailed: FAILED,
		terminateRequested: TERMINATING,
		unrecoverableError: FAILED,
	},
	[RUNNING]: {
		transportLost: DETACHED,
		terminateRequested: TERMINATING,
		ptyExited: TERMINATING,
		unrecoverableError: FAILED,
	},
	[DETACHED]: {
		reconnectBegan: RECONNECTING,
		reconnectDeadlineExceeded: EXPIRED,
		idleExpired: EXPIRED,
		absoluteExpired: EXPIRED,
		terminateRequested: TERMINATING,
		unrecoverableError: FAILED,
	},
	[RECONNECTING]: {
		replaySynchronized: RUNNING,
		transportLost: DETACHED,
		reconnectDeadlineExceeded: EXPIRED,
		unrecoverableError: FAILED,
	},
	[TERMINATING]: {
		cleanupComplete: TERMINATED,
		cleanupFailed: FAILED,
	},
	[TERMINATED]: {},
	[EXPIRED]: {
		cleanupComplete: TERMINATED,
		cleanupFailed: FAILED,
		terminateRequested: TERMINATING,
	},
	[FAILED]: {},
};

export function validateTransition(currentState: TerminalState, event: TransitionEvent): TransitionResult {
	const transitions = TRANSITION_TABLE[currentState];
	if (!transitions) {
		return {
			allowed: false,
			error: makeError("INTERNAL_ERROR", `Unknown state: ${currentState}`, "Transition rejected", "no", false),
		};
	}

	const newState = transitions[event.type];

	if (newState === undefined) {
		return {
			allowed: false,
			error: makeError(
				"INVALID_REQUEST",
				`Transition ${event.type} is not allowed from ${currentState}`,
				"Transition rejected",
				"no",
				false,
				undefined,
				{ currentState, eventType: event.type },
			),
		};
	}

	return { allowed: true, newState, previousState: currentState };
}

export function applyTransition(record: TerminalLifecycleRecord, event: TransitionEvent): TransitionResult {
	const result = validateTransition(record.state, event);

	if (result.allowed) {
		record.previousState = record.state;
		record.state = result.newState;
		record.stateChangedAt = new Date().toISOString();
		record.lastActivityAt = record.stateChangedAt;
	}

	return result;
}

export function stateAllowsInput(state: TerminalState): boolean {
	return state === RUNNING;
}

export function stateAllowsResize(state: TerminalState): boolean {
	return state === RUNNING;
}

export function stateAllowsAttach(state: TerminalState): boolean {
	return state === DETACHED || state === RECONNECTING;
}

export function stateIsTerminal(state: TerminalState): boolean {
	return state === TERMINATED || state === FAILED;
}

export function stateIsActive(state: TerminalState): boolean {
	return state === CREATING || state === RUNNING || state === DETACHED || state === RECONNECTING;
}
