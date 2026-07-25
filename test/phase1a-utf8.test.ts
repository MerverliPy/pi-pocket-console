import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Utf8StreamDecoder } from "../src/protocol/utf8-stream.ts";

describe("Utf8StreamDecoder", () => {
	test("decodes plain ASCII in a single feed", () => {
		const decoder = new Utf8StreamDecoder();
		const chunks = decoder.feed(Buffer.from("hello world", "utf8"));

		assert.equal(chunks.length, 1);
		assert.equal(chunks[0].data, "hello world");
		assert.equal(chunks[0].sequence, 1);
	});

	test("decodes multibyte UTF-8 characters", () => {
		const decoder = new Utf8StreamDecoder();
		const chunks = decoder.feed(Buffer.from("caf\u00e9", "utf8"));

		assert.equal(chunks.length, 1);
		assert.equal(chunks[0].data, "caf\u00e9");
		assert.equal(chunks[0].sequence, 1);
	});

	test("buffers split multibyte code points across feeds", () => {
		const decoder = new Utf8StreamDecoder();
		const bytes = Buffer.from("caf\u00e9", "utf8");

		const first = bytes.subarray(0, 4);
		const second = bytes.subarray(4);

		const chunks1 = decoder.feed(first);
		assert.equal(chunks1.length, 1);
		assert.equal(chunks1[0].data, "caf");
		assert.equal(chunks1[0].sequence, 1);

		const chunks2 = decoder.feed(second);
		assert.equal(chunks2.length, 1);
		assert.equal(chunks2[0].data, "\u00e9");
		assert.equal(chunks2[0].sequence, 2);
	});

	test("buffers split 3-byte code points across feeds", () => {
		const decoder = new Utf8StreamDecoder();
		const bytes = Buffer.from("\u4e16\u754c", "utf8");

		const first = bytes.subarray(0, 2);
		const second = bytes.subarray(2);

		const chunks1 = decoder.feed(first);
		assert.equal(chunks1.length, 0);

		const chunks2 = decoder.feed(second);
		assert.equal(chunks2.length, 1);
		assert.equal(chunks2[0].data, "\u4e16\u754c");
		assert.equal(chunks2[0].sequence, 1);
	});

	test("replaces malformed byte sequences with U+FFFD", () => {
		const decoder = new Utf8StreamDecoder();
		const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xc0, 0x6f]);

		const chunks = decoder.feed(bytes);

		assert(chunks.some((chunk) => chunk.data.includes("\uFFFD")));
	});

	test("replaces standalone continuation bytes with U+FFFD", () => {
		const decoder = new Utf8StreamDecoder();
		const bytes = new Uint8Array([0x80, 0x80, 0x48, 0x69]);

		const chunks = decoder.feed(bytes);

		assert(chunks.some((chunk) => chunk.data.includes("\uFFFD")));
		assert(chunks.some((chunk) => chunk.data.includes("Hi")));
	});

	test("handles NUL bytes", () => {
		const decoder = new Utf8StreamDecoder();
		const chunks = decoder.feed(Buffer.from("hello\u0000world", "utf8"));

		assert.equal(chunks.length, 1);
		assert.equal(chunks[0].data, "hello\u0000world");
	});

	test("handles ESC character", () => {
		const decoder = new Utf8StreamDecoder();

		const chunks = decoder.feed(Buffer.from("\u001b[32mgreen\u001b[0m", "utf8"));

		assert(chunks.length >= 1);
		assert(chunks[0].data.includes("\u001b"));
	});

	test("handles empty feed", () => {
		const decoder = new Utf8StreamDecoder();
		const chunks = decoder.feed(new Uint8Array(0));

		assert.equal(chunks.length, 0);
		assert.equal(decoder.currentSequence(), 0);
	});

	test("maintains monotonic sequence", () => {
		const decoder = new Utf8StreamDecoder();

		const chunks1 = decoder.feed(Buffer.from("first", "utf8"));
		const chunks2 = decoder.feed(Buffer.from("second", "utf8"));

		assert.equal(chunks1[0].sequence, 1);
		assert.equal(chunks2[0].sequence, 2);
	});

	test("handles high-volume sustained output", () => {
		const decoder = new Utf8StreamDecoder();
		const data = "x".repeat(100_000);

		const chunks = decoder.feed(Buffer.from(data, "utf8"));
		assert.equal(chunks.length, 1);
		assert.equal(chunks[0].data, data);
	});

	test("handles 4-byte emoji sequences", () => {
		const decoder = new Utf8StreamDecoder();
		const chunks = decoder.feed(Buffer.from("hello \ud83d\ude00 world", "utf8"));

		assert.equal(chunks.length, 1);
		assert.equal(chunks[0].data, "hello \ud83d\ude00 world");
	});

	test("handles overlong sequences as U+FFFD", () => {
		const decoder = new Utf8StreamDecoder();
		const overlongA = new Uint8Array([0xc0, 0xa1]);

		const chunks = decoder.feed(overlongA);
		assert(chunks.some((chunk) => chunk.data.includes("\uFFFD")));
	});

	test("handles surrogate-half sequences as U+FFFD", () => {
		const decoder = new Utf8StreamDecoder();
		const encodedSurrogate =
			Buffer.from("\ud800", "utf8").length > 0 ? Buffer.from("\ud800", "utf8") : new Uint8Array([0xed, 0xa0, 0x80]);

		const chunks = decoder.feed(encodedSurrogate);
		assert(chunks.some((chunk) => chunk.data.includes("\uFFFD")));
	});

	test("flush outputs buffered incomplete sequences as U+FFFD", () => {
		const decoder = new Utf8StreamDecoder();
		const partialE = new Uint8Array([0xc3]);

		decoder.feed(partialE);
		const flushed = decoder.flush();

		assert(flushed.length >= 1);
		assert(flushed[0].data.includes("\uFFFD"));
	});

	test("flush on empty buffer produces no chunks", () => {
		const decoder = new Utf8StreamDecoder();
		const flushed = decoder.flush();
		assert.equal(flushed.length, 0);
	});

	test("reset clears buffer and sequence", () => {
		const decoder = new Utf8StreamDecoder();
		decoder.feed(Buffer.from("test", "utf8"));
		decoder.reset();

		const chunks = decoder.feed(Buffer.from("fresh", "utf8"));
		assert.equal(chunks[0].sequence, 1);
		assert.equal(chunks[0].data, "fresh");
	});
});
