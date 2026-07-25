import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type AuditSeverity = "info" | "warning" | "error";

export interface AuditEvent {
	eventId: string;
	timestamp: string;
	severity: AuditSeverity;
	code: string;
	message: string;
	safeNextAction?: string;
}

export class AuditLogger {
	private readonly events: AuditEvent[] = [];
	private readonly maxMemoryEvents = 500;
	private logPath: string | null = null;

	async init(): Promise<void> {
		const dir = join(homedir(), ".pi-pocket-console", "audit");
		await mkdir(dir, { recursive: true });
		this.logPath = join(dir, `audit-${new Date().toISOString().slice(0, 10)}.jsonl`);
	}

	private generateId(): string {
		const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
		let id = "";
		for (let i = 0; i < 24; i++) {
			id += chars[Math.floor(Math.random() * chars.length)];
		}
		return id;
	}

	log(severity: AuditSeverity, code: string, message: string, safeNextAction?: string): AuditEvent {
		const event: AuditEvent = {
			eventId: this.generateId(),
			timestamp: new Date().toISOString(),
			severity,
			code,
			message,
			safeNextAction,
		};
		this.events.push(event);
		if (this.events.length > this.maxMemoryEvents) {
			this.events.shift();
		}
		this.writeToFile(event).catch(() => {});
		return event;
	}

	info(code: string, message: string): AuditEvent {
		return this.log("info", code, message);
	}

	warning(code: string, message: string): AuditEvent {
		return this.log("warning", code, message);
	}

	error(code: string, message: string, safeNextAction?: string): AuditEvent {
		return this.log("error", code, message, safeNextAction);
	}

	getRecent(count = 50): AuditEvent[] {
		return this.events.slice(-count);
	}

	private async writeToFile(event: AuditEvent): Promise<void> {
		if (!this.logPath) return;
		try {
			await appendFile(this.logPath, JSON.stringify(event) + "\n", "utf8");
		} catch {}
	}
}
