export const PROTOCOL_VERSION = 1 as const;

export const MAX_WEBSOCKET_FRAME_BYTES = 65536;
export const MAX_TERMINAL_INPUT_DATA_BYTES = 49152;

export const REPLAY_BUFFER_BYTES = 2_097_152;
export const ACTIVE_TERMINALS_PER_DEVICE = 3;
export const GLOBAL_ACTIVE_TERMINALS = 10;
export const RECONNECT_DEADLINE_SECONDS = 60;
export const RESIZE_RATE_PER_SECOND = 10;
export const PAIRING_ATTEMPTS_PER_WINDOW = 5;
export const PAIRING_WINDOW_SECONDS = 600;
export const GRACEFUL_TERMINATION_SECONDS = 5;
export const ABSOLUTE_SESSION_DURATION_SECONDS = 43_200;
export const IDLE_SESSION_TIMEOUT_SECONDS = 3_600;
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const LEASE_DURATION_MS = 300_000;

export const DEFAULT_MIN_COLS = 20;
export const DEFAULT_MAX_COLS = 500;
export const DEFAULT_MIN_ROWS = 5;
export const DEFAULT_MAX_ROWS = 200;

export const WEBSOCKET_PATH = "/api/v1/ws";

export const MESSAGE_TYPES = {
	CONNECTION_READY: "connection.ready",
	CONNECTION_ERROR: "connection.error",
	CONNECTION_PING: "connection.ping",
	CONNECTION_PONG: "connection.pong",
	CLIENT_HELLO: "client.hello",
	TERMINAL_ATTACH: "terminal.attach",
	TERMINAL_ATTACHED: "terminal.attached",
	TERMINAL_DETACH: "terminal.detach",
	TERMINAL_INPUT: "terminal.input",
	TERMINAL_INPUT_ACCEPTED: "terminal.input.accepted",
	TERMINAL_INPUT_REJECTED: "terminal.input.rejected",
	TERMINAL_OUTPUT: "terminal.output",
	TERMINAL_RESIZE: "terminal.resize",
	TERMINAL_RESIZE_ACCEPTED: "terminal.resize.accepted",
	TERMINAL_REPLAY_BEGIN: "terminal.replay.begin",
	TERMINAL_REPLAY_END: "terminal.replay.end",
	TERMINAL_REPLAY_ACK: "terminal.replay.ack",
	TERMINAL_REPLAY_GAP: "terminal.replay.gap",
	LEASE_GRANTED: "lease.granted",
	LEASE_REVOKED: "lease.revoked",
	LEASE_EXPIRING: "lease.expiring",
	LEASE_CHANGED: "lease.changed",
	TERMINAL_STATE: "terminal.state",
	TERMINAL_PROCESS_EXIT: "terminal.process.exit",
	TERMINAL_WARNING: "terminal.warning",
	TERMINAL_FAILURE: "terminal.failure",
} as const;

export const CLOSE_CODES = {
	NORMAL: 1000,
	GOING_AWAY: 1001,
	POLICY_VIOLATION: 1008,
	MESSAGE_TOO_LARGE: 1009,
	INTERNAL_ERROR: 1011,
	AUTH_REQUIRED: 4001,
	AUTH_EXPIRED: 4002,
	ORIGIN_REJECTED: 4003,
	PROTOCOL_VERSION_REJECTED: 4004,
	SESSION_REVOKED: 4005,
	RATE_LIMITED: 4006,
} as const;

export const TERMINAL_STATES = {
	CREATING: "CREATING",
	RUNNING: "RUNNING",
	DETACHED: "DETACHED",
	RECONNECTING: "RECONNECTING",
	TERMINATING: "TERMINATING",
	TERMINATED: "TERMINATED",
	EXPIRED: "EXPIRED",
	FAILED: "FAILED",
} as const;
