const REPLACEMENT_CHAR = "\uFFFD";

export interface Utf8Chunk {
	data: string;
	sequence: number;
}

export class Utf8StreamDecoder {
	private buffer: Uint8Array;
	private sequence = 0;

	constructor() {
		this.buffer = new Uint8Array(0);
	}

	reset(): void {
		this.buffer = new Uint8Array(0);
		this.sequence = 0;
	}

	feed(bytes: Uint8Array): Utf8Chunk[] {
		const chunks: Utf8Chunk[] = [];

		const combined = new Uint8Array(this.buffer.length + bytes.length);
		combined.set(this.buffer);
		combined.set(bytes, this.buffer.length);

		let i = 0;
		let segmentStart = 0;
		const len = combined.length;

		while (i < len) {
			const byte = combined[i];

			if (byte <= 0x7f) {
				i += 1;
				continue;
			}

			const cpLen = multibyteLength(byte);

			if (cpLen === 0) {
				const decoded = decodeSegment(combined, segmentStart, i, true);
				if (decoded.length > 0) {
					this.sequence += 1;
					chunks.push({ data: decoded, sequence: this.sequence });
				}
				this.sequence += 1;
				chunks.push({ data: REPLACEMENT_CHAR, sequence: this.sequence });
				i += 1;
				segmentStart = i;
				continue;
			}

			if (i + cpLen <= len) {
				const valid = isValidMultibyte(combined, i, cpLen);
				if (valid) {
					i += cpLen;
					continue;
				}
				const decoded = decodeSegment(combined, segmentStart, i, true);
				if (decoded.length > 0) {
					this.sequence += 1;
					chunks.push({ data: decoded, sequence: this.sequence });
				}
				this.sequence += 1;
				chunks.push({ data: REPLACEMENT_CHAR, sequence: this.sequence });
				i += cpLen;
				segmentStart = i;
			} else {
				break;
			}
		}

		if (i < len) {
			this.buffer = combined.slice(i);
			if (segmentStart < i) {
				const decoded = decodeSegment(combined, segmentStart, i, true);
				if (decoded.length > 0) {
					this.sequence += 1;
					chunks.push({ data: decoded, sequence: this.sequence });
				}
			}
		} else {
			this.buffer = new Uint8Array(0);
			const decoded = decodeSegment(combined, segmentStart, len, true);
			if (decoded.length > 0) {
				this.sequence += 1;
				chunks.push({ data: decoded, sequence: this.sequence });
			}
		}

		return chunks;
	}

	flush(): Utf8Chunk[] {
		const chunks: Utf8Chunk[] = [];
		if (this.buffer.length > 0) {
			let decoded = "";
			for (let i = 0; i < this.buffer.length; i++) {
				decoded += REPLACEMENT_CHAR;
			}
			this.sequence += 1;
			chunks.push({ data: decoded, sequence: this.sequence });
			this.buffer = new Uint8Array(0);
		}
		return chunks;
	}

	currentSequence(): number {
		return this.sequence;
	}
}

function multibyteLength(byte: number): number {
	if (byte <= 0x7f) {
		return 1;
	}
	if ((byte & 0xe0) === 0xc0) {
		return 2;
	}
	if ((byte & 0xf0) === 0xe0) {
		return 3;
	}
	if ((byte & 0xf8) === 0xf0) {
		return 4;
	}
	return 0;
}

function isValidMultibyte(bytes: Uint8Array, start: number, length: number): boolean {
	for (let j = 1; j < length; j++) {
		if ((bytes[start + j] & 0xc0) !== 0x80) {
			return false;
		}
	}

	if (length === 2) {
		const cp = ((bytes[start] & 0x1f) << 6) | (bytes[start + 1] & 0x3f);
		return cp >= 0x80;
	}
	if (length === 3) {
		const cp = ((bytes[start] & 0x0f) << 12) | ((bytes[start + 1] & 0x3f) << 6) | (bytes[start + 2] & 0x3f);
		if (cp >= 0xd800 && cp <= 0xdfff) {
			return false;
		}
		if (cp < 0x800) {
			return false;
		}
		return true;
	}
	if (length === 4) {
		const cp =
			((bytes[start] & 0x07) << 18) |
			((bytes[start + 1] & 0x3f) << 12) |
			((bytes[start + 2] & 0x3f) << 6) |
			(bytes[start + 3] & 0x3f);
		if (cp > 0x10ffff) {
			return false;
		}
		if (cp < 0x10000) {
			return false;
		}
		return true;
	}
	return true;
}

function decodeSegment(bytes: Uint8Array, start: number, end: number, fatal: boolean): string {
	const decoder = new TextDecoder("utf-8", { fatal });
	return decoder.decode(bytes.slice(start, end));
}
