import {
	MAX_TERMINAL_INPUT_DATA_BYTES,
	MAX_WEBSOCKET_FRAME_BYTES,
	MESSAGE_TYPES,
	PROTOCOL_VERSION,
} from "./constants.ts";
import { makeError, type ProtocolError } from "./errors.ts";
import type { ProtocolEnvelope, TerminalInputPayload, TerminalResizePayload } from "./types.ts";

const KNOWN_MESSAGE_TYPES: ReadonlySet<string> = new Set(Object.values(MESSAGE_TYPES));

export interface ValidationResult {
	valid: boolean;
	error?: ProtocolError;
}

export function validateEnvelope(obj: unknown): ValidationResult {
	if (typeof obj !== "object" || obj === null) {
		return {
			valid: false,
			error: makeError("INVALID_MESSAGE", "Message must be a JSON object", "Message rejected", "no", false),
		};
	}

	const raw = obj as Record<string, unknown>;

	if (raw.version !== PROTOCOL_VERSION) {
		return {
			valid: false,
			error: makeError(
				"UNKNOWN_PROTOCOL_VERSION",
				`Expected protocol version ${PROTOCOL_VERSION}`,
				"Message rejected",
				"no",
				false,
			),
		};
	}

	if (typeof raw.type !== "string" || !KNOWN_MESSAGE_TYPES.has(raw.type)) {
		return {
			valid: false,
			error: makeError(
				"UNKNOWN_MESSAGE_TYPE",
				`Unknown or missing message type: ${String(raw.type)}`,
				"Message rejected",
				"no",
				false,
			),
		};
	}

	if (raw.payload === undefined || raw.payload === null) {
		return {
			valid: false,
			error: makeError("INVALID_MESSAGE", "Message payload is required", "Message rejected", "no", false),
		};
	}

	return { valid: true };
}

export function validateEnvelopeSize(data: Uint8Array): ValidationResult {
	if (data.length > MAX_WEBSOCKET_FRAME_BYTES) {
		return {
			valid: false,
			error: makeError(
				"MESSAGE_TOO_LARGE",
				`Message exceeds ${MAX_WEBSOCKET_FRAME_BYTES} bytes`,
				"Message rejected",
				"no",
				false,
				undefined,
				{ maxBytes: MAX_WEBSOCKET_FRAME_BYTES, actualBytes: data.length },
			),
		};
	}
	return { valid: true };
}

export function validateTerminalInput(payload: unknown): payload is TerminalInputPayload {
	if (typeof payload !== "object" || payload === null) {
		return false;
	}

	const p = payload as Record<string, unknown>;

	if (typeof p.leaseId !== "string" || p.leaseId.length === 0) {
		return false;
	}

	if (typeof p.leaseGeneration !== "number" || p.leaseGeneration < 0) {
		return false;
	}

	if (typeof p.data !== "string") {
		return false;
	}

	return true;
}

export function validateInputSize(data: string): ValidationResult {
	if (Buffer.byteLength(data, "utf8") > MAX_TERMINAL_INPUT_DATA_BYTES) {
		return {
			valid: false,
			error: makeError(
				"MESSAGE_TOO_LARGE",
				`Input data exceeds ${MAX_TERMINAL_INPUT_DATA_BYTES} bytes`,
				"Input rejected",
				"no",
				false,
				undefined,
				{ maxBytes: MAX_TERMINAL_INPUT_DATA_BYTES },
			),
		};
	}
	return { valid: true };
}

export function validateResizePayload(payload: unknown): payload is TerminalResizePayload {
	if (typeof payload !== "object" || payload === null) {
		return false;
	}

	const p = payload as Record<string, unknown>;

	if (typeof p.leaseId !== "string" || p.leaseId.length === 0) {
		return false;
	}

	if (typeof p.leaseGeneration !== "number" || p.leaseGeneration < 0) {
		return false;
	}

	if (typeof p.cols !== "number" || typeof p.rows !== "number") {
		return false;
	}

	const { cols, rows } = p;
	if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
		return false;
	}

	return true;
}

export function validateEnvelopeString(rawJson: string): {
	valid: boolean;
	parsed?: ProtocolEnvelope<unknown>;
	error?: ProtocolError;
} {
	const sizeResult = validateEnvelopeSize(Buffer.from(rawJson, "utf8"));
	if (!sizeResult.valid) {
		return { valid: false, error: sizeResult.error };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawJson);
	} catch {
		return {
			valid: false,
			error: makeError("INVALID_MESSAGE", "Message is not valid JSON", "Message rejected", "no", false),
		};
	}

	const envelopeResult = validateEnvelope(parsed);
	if (!envelopeResult.valid) {
		return { valid: false, error: envelopeResult.error };
	}

	return { valid: true, parsed: parsed as ProtocolEnvelope<unknown> };
}
