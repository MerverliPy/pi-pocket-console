import type { ExecutedStatus } from "./types.ts";

const ERROR_CODES = {
	AUTH_REQUIRED: "AUTH_REQUIRED",
	AUTH_EXPIRED: "AUTH_EXPIRED",
	AUTH_REVOKED: "AUTH_REVOKED",
	PAIRING_REQUIRED: "PAIRING_REQUIRED",
	PAIRING_CODE_INVALID: "PAIRING_CODE_INVALID",
	PAIRING_CODE_EXPIRED: "PAIRING_CODE_EXPIRED",
	PAIRING_RATE_LIMITED: "PAIRING_RATE_LIMITED",
	ORIGIN_REJECTED: "ORIGIN_REJECTED",
	CSRF_REJECTED: "CSRF_REJECTED",
	SESSION_FORBIDDEN: "SESSION_FORBIDDEN",
	TERMINAL_FORBIDDEN: "TERMINAL_FORBIDDEN",
	WORKSPACE_FORBIDDEN: "WORKSPACE_FORBIDDEN",
	LEASE_REQUIRED: "LEASE_REQUIRED",
	LEASE_FORBIDDEN: "LEASE_FORBIDDEN",
	LEASE_STALE: "LEASE_STALE",
	LEASE_TRANSFER_REQUIRED: "LEASE_TRANSFER_REQUIRED",
	INVALID_REQUEST: "INVALID_REQUEST",
	INVALID_MESSAGE: "INVALID_MESSAGE",
	UNKNOWN_PROTOCOL_VERSION: "UNKNOWN_PROTOCOL_VERSION",
	UNKNOWN_MESSAGE_TYPE: "UNKNOWN_MESSAGE_TYPE",
	MESSAGE_TOO_LARGE: "MESSAGE_TOO_LARGE",
	INVALID_TERMINAL_SIZE: "INVALID_TERMINAL_SIZE",
	INVALID_SEQUENCE: "INVALID_SEQUENCE",
	INVALID_WORKSPACE: "INVALID_WORKSPACE",
	INVALID_LAUNCHER: "INVALID_LAUNCHER",
	TERMINAL_NOT_FOUND: "TERMINAL_NOT_FOUND",
	TERMINAL_NOT_RUNNING: "TERMINAL_NOT_RUNNING",
	TERMINAL_CREATING: "TERMINAL_CREATING",
	TERMINAL_TERMINATING: "TERMINAL_TERMINATING",
	TERMINAL_TERMINATED: "TERMINAL_TERMINATED",
	TERMINAL_EXPIRED: "TERMINAL_EXPIRED",
	TERMINAL_FAILED: "TERMINAL_FAILED",
	RECONNECT_EXPIRED: "RECONNECT_EXPIRED",
	TERMINAL_DEVICE_LIMIT: "TERMINAL_DEVICE_LIMIT",
	TERMINAL_GLOBAL_LIMIT: "TERMINAL_GLOBAL_LIMIT",
	INPUT_RATE_LIMIT: "INPUT_RATE_LIMIT",
	RESIZE_RATE_LIMIT: "RESIZE_RATE_LIMIT",
	OUTPUT_LIMIT: "OUTPUT_LIMIT",
	REPLAY_GAP: "REPLAY_GAP",
	SPAWN_TIMEOUT: "SPAWN_TIMEOUT",
	RESOURCE_EXHAUSTED: "RESOURCE_EXHAUSTED",
	PTY_SPAWN_FAILED: "PTY_SPAWN_FAILED",
	PTY_IO_FAILED: "PTY_IO_FAILED",
	PROCESS_CLEANUP_FAILED: "PROCESS_CLEANUP_FAILED",
	GATEWAY_UNAVAILABLE: "GATEWAY_UNAVAILABLE",
	INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ProtocolErrorShape {
	code: ErrorCode;
	message: string;
	impact: string;
	executed: ExecutedStatus;
	retryable: boolean;
	safeNextAction?: string;
	details?: Record<string, unknown>;
}

export class ProtocolError extends Error {
	readonly code: ErrorCode;
	readonly impact: string;
	readonly executed: ExecutedStatus;
	readonly retryable: boolean;
	readonly safeNextAction?: string;
	readonly details?: Record<string, unknown>;

	constructor(shape: ProtocolErrorShape) {
		super(shape.message);
		this.name = "ProtocolError";
		this.code = shape.code;
		this.impact = shape.impact;
		this.executed = shape.executed;
		this.retryable = shape.retryable;
		this.safeNextAction = shape.safeNextAction;
		this.details = shape.details;
	}

	toJSON(): ProtocolErrorShape & Record<string, unknown> {
		return {
			code: this.code,
			message: this.message,
			impact: this.impact,
			executed: this.executed,
			retryable: this.retryable,
			safeNextAction: this.safeNextAction,
			details: this.details,
		};
	}
}

export function makeError(
	code: ErrorCode,
	message: string,
	impact: string,
	executed: ExecutedStatus,
	retryable: boolean,
	safeNextAction?: string,
	details?: Record<string, unknown>,
): ProtocolError {
	return new ProtocolError({ code, message, impact, executed, retryable, safeNextAction, details });
}

export function authRequired(): ProtocolError {
	return makeError(
		"AUTH_REQUIRED",
		"Authentication required",
		"Access denied",
		"no",
		false,
		"Pair this device to continue.",
	);
}

export function authExpired(): ProtocolError {
	return makeError(
		"AUTH_EXPIRED",
		"Authentication expired",
		"Access denied",
		"no",
		false,
		"Re-authenticate to continue.",
	);
}

export function leaseRequired(): ProtocolError {
	return makeError(
		"LEASE_REQUIRED",
		"Controller lease required",
		"Input rejected",
		"no",
		false,
		"Acquire a controller lease first.",
	);
}

export function leaseStale(expected: number, actual: number): ProtocolError {
	return makeError(
		"LEASE_STALE",
		"Lease generation is stale",
		"Input rejected",
		"no",
		false,
		"Re-acquire the lease before sending input.",
		{ expectedGeneration: expected, actualGeneration: actual },
	);
}

export function unknownProtocolVersion(): ProtocolError {
	return makeError(
		"UNKNOWN_PROTOCOL_VERSION",
		"Unknown protocol version",
		"Connection rejected",
		"no",
		false,
		"Check client and gateway protocol compatibility.",
	);
}

export function unknownMessageType(type: string): ProtocolError {
	return makeError(
		"UNKNOWN_MESSAGE_TYPE",
		`Unknown message type: ${type}`,
		"Message rejected",
		"no",
		false,
		undefined,
		{
			unknownType: type,
		},
	);
}

export function messageTooLarge(limit: number): ProtocolError {
	return makeError(
		"MESSAGE_TOO_LARGE",
		"Message exceeds size limit",
		"Message rejected",
		"no",
		false,
		"Reduce the message size.",
		{
			maxBytes: limit,
		},
	);
}

export function terminalNotFound(sessionId: string): ProtocolError {
	return makeError(
		"TERMINAL_NOT_FOUND",
		"Terminal session not found",
		"Request rejected",
		"no",
		false,
		"Check the terminal session ID.",
		{
			sessionId,
		},
	);
}

export function terminalNotRunning(state: string): ProtocolError {
	return makeError(
		"TERMINAL_NOT_RUNNING",
		`Terminal is not in RUNNING state (current: ${state})`,
		"Operation rejected",
		"no",
		false,
		"Wait for the terminal to be running or create a new session.",
		{ currentState: state },
	);
}

export function internalError(cause?: string): ProtocolError {
	return makeError(
		"INTERNAL_ERROR",
		cause ?? "An internal error occurred",
		"Operation may have failed",
		"unknown",
		false,
		"Check terminal status and retry.",
	);
}
