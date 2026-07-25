import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	MAX_TERMINAL_INPUT_DATA_BYTES,
	MAX_WEBSOCKET_FRAME_BYTES,
	MESSAGE_TYPES,
	PROTOCOL_VERSION,
} from "../src/protocol/constants.ts";
import { makeError, ProtocolError } from "../src/protocol/errors.ts";
import {
	validateEnvelope,
	validateEnvelopeSize,
	validateEnvelopeString,
	validateInputSize,
	validateTerminalInput,
} from "../src/protocol/validate.ts";

describe("validateEnvelope", () => {
	test("accepts a valid envelope with known type", () => {
		const result = validateEnvelope({
			version: PROTOCOL_VERSION,
			type: MESSAGE_TYPES.TERMINAL_INPUT,
			payload: { data: "test" },
		});
		assert.equal(result.valid, true);
	});

	test("rejects null", () => {
		const result = validateEnvelope(null);
		assert.equal(result.valid, false);
		assert.ok(result.error);
		assert.equal(result.error.code, "INVALID_MESSAGE");
	});

	test("rejects non-object", () => {
		const result = validateEnvelope("string");
		assert.equal(result.valid, false);
		assert.ok(result.error);
	});

	test("rejects unknown protocol version", () => {
		const result = validateEnvelope({
			version: 99,
			type: MESSAGE_TYPES.TERMINAL_INPUT,
			payload: {},
		});
		assert.equal(result.valid, false);
		assert.equal(result.error?.code, "UNKNOWN_PROTOCOL_VERSION");
	});

	test("rejects unknown message type", () => {
		const result = validateEnvelope({
			version: PROTOCOL_VERSION,
			type: "bogus.type",
			payload: {},
		});
		assert.equal(result.valid, false);
		assert.equal(result.error?.code, "UNKNOWN_MESSAGE_TYPE");
	});

	test("rejects missing type", () => {
		const result = validateEnvelope({
			version: PROTOCOL_VERSION,
			payload: {},
		});
		assert.equal(result.valid, false);
		assert.equal(result.error?.code, "UNKNOWN_MESSAGE_TYPE");
	});

	test("rejects missing payload", () => {
		const result = validateEnvelope({
			version: PROTOCOL_VERSION,
			type: MESSAGE_TYPES.TERMINAL_INPUT,
		});
		assert.equal(result.valid, false);
		assert.equal(result.error?.code, "INVALID_MESSAGE");
	});

	test("accepts all known message types", () => {
		for (const type of Object.values(MESSAGE_TYPES)) {
			const result = validateEnvelope({
				version: PROTOCOL_VERSION,
				type,
				payload: {},
			});
			assert.equal(result.valid, true, `type ${type} should be valid`);
		}
	});
});

describe("validateEnvelopeSize", () => {
	test("accepts message under limit", () => {
		const data = Buffer.from(JSON.stringify({ test: "ok" }), "utf8");
		const result = validateEnvelopeSize(data);
		assert.equal(result.valid, true);
	});

	test("rejects oversized message", () => {
		const large = new Uint8Array(MAX_WEBSOCKET_FRAME_BYTES + 1);
		const result = validateEnvelopeSize(large);
		assert.equal(result.valid, false);
		assert.equal(result.error?.code, "MESSAGE_TOO_LARGE");
	});

	test("accepts message at limit", () => {
		const data = new Uint8Array(MAX_WEBSOCKET_FRAME_BYTES);
		const result = validateEnvelopeSize(data);
		assert.equal(result.valid, true);
	});
});

describe("validateTerminalInput", () => {
	test("accepts valid input payload", () => {
		const valid = validateTerminalInput({
			leaseId: "lease_abc",
			leaseGeneration: 1,
			data: "echo hello",
		});
		assert.equal(valid, true);
	});

	test("rejects null", () => {
		assert.equal(validateTerminalInput(null), false);
	});

	test("rejects missing leaseId", () => {
		assert.equal(
			validateTerminalInput({
				leaseGeneration: 1,
				data: "test",
			}),
			false,
		);
	});

	test("rejects empty leaseId", () => {
		assert.equal(
			validateTerminalInput({
				leaseId: "",
				leaseGeneration: 1,
				data: "test",
			}),
			false,
		);
	});

	test("rejects negative leaseGeneration", () => {
		assert.equal(
			validateTerminalInput({
				leaseId: "lease_abc",
				leaseGeneration: -1,
				data: "test",
			}),
			false,
		);
	});

	test("rejects non-string data", () => {
		assert.equal(
			validateTerminalInput({
				leaseId: "lease_abc",
				leaseGeneration: 1,
				data: 123,
			}),
			false,
		);
	});
});

describe("validateInputSize", () => {
	test("accepts input under limit", () => {
		const result = validateInputSize("echo hello");
		assert.equal(result.valid, true);
	});

	test("rejects input exceeding limit", () => {
		const large = "x".repeat(MAX_TERMINAL_INPUT_DATA_BYTES + 1);
		const result = validateInputSize(large);
		assert.equal(result.valid, false);
		assert.equal(result.error?.code, "MESSAGE_TOO_LARGE");
	});

	test("accepts input at limit", () => {
		const atLimit = "x".repeat(MAX_TERMINAL_INPUT_DATA_BYTES);
		const result = validateInputSize(atLimit);
		assert.equal(result.valid, true);
	});

	test("handles multibyte characters in size check", () => {
		const chars = "\u00e9".repeat(MAX_TERMINAL_INPUT_DATA_BYTES);
		const result = validateInputSize(chars);
		assert.equal(result.valid, false);
	});
});

describe("validateEnvelopeString", () => {
	test("parses and validates a complete JSON envelope", () => {
		const json = JSON.stringify({
			version: PROTOCOL_VERSION,
			type: MESSAGE_TYPES.TERMINAL_INPUT,
			payload: { data: "hello" },
		});
		const result = validateEnvelopeString(json);
		assert.equal(result.valid, true);
		assert.ok(result.parsed);
	});

	test("rejects invalid JSON", () => {
		const result = validateEnvelopeString("{invalid}");
		assert.equal(result.valid, false);
		assert.ok(result.error);
		assert.equal(result.error.code, "INVALID_MESSAGE");
	});

	test("rejects oversized JSON", () => {
		const pad = "x".repeat(MAX_WEBSOCKET_FRAME_BYTES + 100);
		const json = JSON.stringify({
			version: PROTOCOL_VERSION,
			type: MESSAGE_TYPES.TERMINAL_INPUT,
			payload: { data: pad },
		});
		const result = validateEnvelopeString(json);
		assert.equal(result.valid, false);
		assert.equal(result.error?.code, "MESSAGE_TOO_LARGE");
	});
});

describe("ProtocolError", () => {
	test("constructs with required fields", () => {
		const err = new ProtocolError({
			code: "INTERNAL_ERROR",
			message: "Something went wrong",
			impact: "Operation failed",
			executed: "unknown",
			retryable: true,
		});

		assert.equal(err.code, "INTERNAL_ERROR");
		assert.equal(err.message, "Something went wrong");
		assert.equal(err.impact, "Operation failed");
		assert.equal(err.executed, "unknown");
		assert.equal(err.retryable, true);
		assert.equal(err.name, "ProtocolError");
	});

	test("serializes to JSON", () => {
		const err = new ProtocolError({
			code: "LEASE_STALE",
			message: "Stale lease",
			impact: "Input rejected",
			executed: "no",
			retryable: false,
			details: { generation: 1 },
		});

		const json = err.toJSON();
		assert.equal(json.code, "LEASE_STALE");
		assert.equal(json.details?.generation, 1);
	});

	test("makeError produces a ProtocolError", () => {
		const err = makeError("AUTH_REQUIRED", "Auth needed", "Access denied", "no", false);
		assert.ok(err instanceof ProtocolError);
		assert.equal(err.code, "AUTH_REQUIRED");
	});
});
