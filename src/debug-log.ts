import { randomUUID } from "node:crypto";

const MAX_LOG_ENTRIES = 200;
const REDACT_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
	{ pattern: /(Authorization|X-CSRF-Token|Set-Cookie|Cookie):\s*\S+/gi, replacement: "$1: [REDACTED]" },
	{
		pattern: /(token|secret|key|password|credential|api[_-]?key|auth[_-]?token)=[^\s&"]+/gi,
		replacement: "$1=[REDACTED]",
	},
	{ pattern: /(bearer|basic)\s+[a-z0-9_-]{8,}/gi, replacement: "$1 [REDACTED]" },
	{ pattern: /session[_-]?id['"]?\s*[:=]\s*['"]?[a-f0-9-]{36}/gi, replacement: "session_id=[REDACTED]" },
];

export interface DebugEntry {
	errorId: string;
	timestamp: string;
	level: "error" | "warn" | "info";
	message: string;
	detail?: string;
}

export class DebugLog {
	private readonly entries: DebugEntry[] = [];
	private readonly capacity: number;

	constructor(capacity: number = MAX_LOG_ENTRIES) {
		this.capacity = capacity;
	}

	add(level: "error" | "warn" | "info", message: string, detail?: string): string {
		const errorId = randomUUID();
		const entry: DebugEntry = {
			errorId,
			timestamp: new Date().toISOString(),
			level,
			message,
			detail: detail ? redact(detail) : undefined,
		};
		this.entries.push(entry);
		if (this.entries.length > this.capacity) {
			this.entries.shift();
		}
		return errorId;
	}

	entriesSince(afterId?: string): DebugEntry[] {
		if (!afterId) {
			return [...this.entries];
		}
		const index = this.entries.findIndex((e) => e.errorId === afterId);
		if (index === -1) {
			return [...this.entries];
		}
		return this.entries.slice(index + 1);
	}
}

export function redact(text: string): string {
	let result = text;
	for (const { pattern, replacement } of REDACT_PATTERNS) {
		result = result.replace(pattern, replacement);
	}
	return result;
}
