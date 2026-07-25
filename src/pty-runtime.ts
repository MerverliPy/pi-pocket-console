import { randomUUID } from "node:crypto";
import type { IPty } from "node-pty";
import {
	ABSOLUTE_SESSION_DURATION_SECONDS,
	GRACEFUL_TERMINATION_SECONDS,
	IDLE_SESSION_TIMEOUT_SECONDS,
	RECONNECT_DEADLINE_SECONDS,
	REPLAY_BUFFER_BYTES,
} from "./protocol/constants.ts";
import type {
	LeaseGeneration,
	OwnedProcessIdentity,
	Rfc3339Timestamp,
	TerminalSequence,
	TerminalSessionId,
	TerminalState,
} from "./protocol/types.ts";

interface ReplayEntry {
	sequence: TerminalSequence;
	data: string;
	bytes: number;
}

class ReplayRing {
	private readonly entries: ReplayEntry[] = [];
	private nextSequence = 0;
	private totalBytes = 0;

	constructor(private readonly maxBytes: number) {}

	append(data: string): TerminalSequence {
		const sequence = this.nextSequence++;
		const encoded = new TextEncoder().encode(data);
		const entry: ReplayEntry = { sequence, data, bytes: encoded.byteLength };
		this.totalBytes += entry.bytes;
		this.entries.push(entry);
		while (this.totalBytes > this.maxBytes && this.entries.length > 1) {
			const removed = this.entries.shift();
			if (removed) this.totalBytes -= removed.bytes;
		}
		return sequence;
	}

	getAvailableRange(): { earliest: TerminalSequence; latest: TerminalSequence } | null {
		if (this.entries.length === 0) return null;
		return { earliest: this.entries[0].sequence, latest: this.entries[this.entries.length - 1].sequence };
	}

	getReplay(afterSequence: TerminalSequence): { entries: ReplayEntry[]; gap: boolean } {
		const gap = this.entries.length > 0 && afterSequence < this.entries[0].sequence;
		const filtered = this.entries.filter((e) => e.sequence > afterSequence);
		return { entries: filtered, gap };
	}

	get lastSequence(): TerminalSequence {
		return this.nextSequence - 1;
	}
}

export interface PtyRuntimeCallbacks {
	onStateChange(sessionId: TerminalSessionId, state: TerminalState, previousState?: TerminalState): void;
	onOutput(sessionId: TerminalSessionId, data: string, sequence: TerminalSequence): void;
	onExit(sessionId: TerminalSessionId, exitCode?: number, signal?: string): void;
	onError(sessionId: TerminalSessionId, error: Error): void;
}

export class PtyRuntime {
	readonly sessionId: TerminalSessionId;
	readonly workspaceRoot: string;
	readonly createdAt: Rfc3339Timestamp;
	state: TerminalState;
	previousState?: TerminalState;
	idleExpiresAt?: Rfc3339Timestamp;
	absoluteExpiresAt: Rfc3339Timestamp;
	reconnectDeadline?: Rfc3339Timestamp;
	leaseGeneration: LeaseGeneration = 0;
	lastOutputSequence: TerminalSequence = 0;
	processIdentity?: OwnedProcessIdentity;
	failureCode?: string;
	cleanupResult?: "succeeded" | "failed" | "partial";
	processMayStillBeActive?: boolean;
	terminationMode?: "graceful" | "force";

	private pty: IPty | null = null;
	private readonly replay: ReplayRing;
	private readonly callbacks: PtyRuntimeCallbacks;
	private readonly idleTimeoutMs: number;
	private readonly absoluteTimeoutMs: number;
	private readonly reconnectDeadlineMs: number;
	private readonly gracefulWindowMs: number;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private absoluteTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private spawnTimer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;
	private exitNotified = false;

	constructor(
		sessionId: TerminalSessionId,
		workspaceRoot: string,
		callbacks: PtyRuntimeCallbacks,
		options?: {
			idleTimeoutMs?: number;
			absoluteTimeoutMs?: number;
			reconnectDeadlineMs?: number;
			gracefulWindowMs?: number;
			replayBufferBytes?: number;
		},
	) {
		this.sessionId = sessionId;
		this.workspaceRoot = workspaceRoot;
		this.callbacks = callbacks;
		this.state = "CREATING";
		this.createdAt = new Date().toISOString();
		this.absoluteExpiresAt = new Date(
			Date.now() + (options?.absoluteTimeoutMs ?? ABSOLUTE_SESSION_DURATION_SECONDS * 1000),
		).toISOString();
		this.replay = new ReplayRing(options?.replayBufferBytes ?? REPLAY_BUFFER_BYTES);
		this.idleTimeoutMs = options?.idleTimeoutMs ?? IDLE_SESSION_TIMEOUT_SECONDS * 1000;
		this.absoluteTimeoutMs = options?.absoluteTimeoutMs ?? ABSOLUTE_SESSION_DURATION_SECONDS * 1000;
		this.reconnectDeadlineMs = options?.reconnectDeadlineMs ?? RECONNECT_DEADLINE_SECONDS * 1000;
		this.gracefulWindowMs = options?.gracefulWindowMs ?? GRACEFUL_TERMINATION_SECONDS * 1000;
	}

	async spawn(cols: number, rows: number, spawnTimeoutMs = 10_000): Promise<void> {
		const { spawn } = await import("node-pty");

		return new Promise<void>((resolveSpawn, rejectSpawn) => {
			let settled = false;

			this.spawnTimer = setTimeout(() => {
				if (settled) return;
				settled = true;
				this.cleanupAfterSpawnTimeout();
				rejectSpawn(new Error("PTY spawn timed out"));
			}, spawnTimeoutMs);

			try {
				this.pty = spawn("/bin/sh", ["-c", this.resolveShell()], {
					name: "xterm-256color",
					cols,
					rows,
					cwd: this.workspaceRoot,
					env: this.sanitizeEnv(),
				});

				this.processIdentity = {
					pid: this.pty.pid,
					startedAt: new Date().toISOString(),
				};

				this.pty.onData((data: string) => {
					if (this.disposed) return;
					this.resetIdleTimer();
					const sequence = this.replay.append(data);
					this.lastOutputSequence = sequence;
					this.callbacks.onOutput(this.sessionId, data, sequence);
				});

				this.pty.onExit((event: { exitCode: number; signal?: number }) => {
					if (this.exitNotified) return;
					this.exitNotified = true;
					this.clearTimers();
					const signal = event.signal !== undefined ? String(event.signal) : undefined;
					this.callbacks.onExit(this.sessionId, event.exitCode, signal);
				});

				if (this.spawnTimer) {
					clearTimeout(this.spawnTimer);
					this.spawnTimer = null;
				}

				this.transitionTo("RUNNING");
				this.startAbsoluteTimer();
				this.resetIdleTimer();

				if (!settled) {
					settled = true;
					resolveSpawn();
				}
			} catch (error) {
				if (this.spawnTimer) {
					clearTimeout(this.spawnTimer);
					this.spawnTimer = null;
				}
				if (!settled) {
					settled = true;
					rejectSpawn(error instanceof Error ? error : new Error(String(error)));
				}
			}
		});
	}

	private resolveShell(): string {
		return process.env.SHELL || "/bin/sh";
	}

	private sanitizeEnv(): Record<string, string> {
		const safeKeys = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "LC_ALL", "LC_CTYPE", "TZ"];
		const env: Record<string, string> = { TERM: "xterm-256color" };
		for (const key of safeKeys) {
			const val = process.env[key];
			if (val) env[key] = val;
		}
		return env;
	}

	private cleanupAfterSpawnTimeout(): void {
		if (this.pty) {
			try {
				this.pty.kill("SIGKILL");
			} catch {
				/* ok */
			}
			this.pty = null;
		}
		this.transitionTo("FAILED");
		this.failureCode = "SPAWN_TIMEOUT";
	}

	writeInput(data: string): boolean {
		if (this.state !== "RUNNING" || !this.pty || this.disposed) return false;
		try {
			this.pty.write(data);
			this.resetIdleTimer();
			return true;
		} catch {
			return false;
		}
	}

	resize(cols: number, rows: number): boolean {
		if (this.state !== "RUNNING" || !this.pty || this.disposed) return false;
		try {
			this.pty.resize(cols, rows);
			return true;
		} catch {
			return false;
		}
	}

	async terminate(mode: "graceful" | "force"): Promise<void> {
		if (this.state === "TERMINATED" || this.state === "FAILED" || this.disposed) return;
		this.terminationMode = mode;
		this.transitionTo("TERMINATING");
		this.clearTimers();

		if (!this.pty) {
			this.transitionTo("TERMINATED");
			return;
		}

		if (mode === "force") {
			this.forceKill();
			this.transitionTo("TERMINATED");
			return;
		}

		await new Promise<void>((resolve) => {
			const forceTimer = setTimeout(() => {
				this.forceKill();
				resolve();
			}, this.gracefulWindowMs);

			if (this.pty) {
				this.pty.onExit(() => {
					clearTimeout(forceTimer);
					resolve();
				});
				try {
					this.pty.kill("SIGTERM");
				} catch {
					clearTimeout(forceTimer);
					this.forceKill();
					resolve();
				}
			} else {
				clearTimeout(forceTimer);
				resolve();
			}
		});
		this.transitionTo("TERMINATED");
	}

	private forceKill(): void {
		if (!this.pty) return;
		try {
			try {
				process.kill(-this.pty.pid, "SIGKILL");
			} catch {
				this.pty.kill("SIGKILL");
			}
		} catch {
			/* ok */
		}
	}

	private transitionTo(newState: TerminalState): void {
		if (this.state === newState) return;
		this.previousState = this.state;
		this.state = newState;
		this.callbacks.onStateChange(this.sessionId, newState, this.previousState);
	}

	private resetIdleTimer(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		if (this.state !== "RUNNING") return;
		this.idleExpiresAt = new Date(Date.now() + this.idleTimeoutMs).toISOString();
		this.idleTimer = setTimeout(() => {
			if (this.state === "RUNNING") {
				this.callbacks.onError(this.sessionId, new Error("Idle timeout"));
			}
		}, this.idleTimeoutMs);
		this.idleTimer.unref();
	}

	private startAbsoluteTimer(): void {
		this.absoluteTimer = setTimeout(() => {
			if (this.state === "RUNNING" || this.state === "DETACHED" || this.state === "RECONNECTING") {
				this.callbacks.onError(this.sessionId, new Error("Absolute session timeout"));
			}
		}, this.absoluteTimeoutMs);
		this.absoluteTimer.unref();
	}

	private clearTimers(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
		if (this.absoluteTimer) {
			clearTimeout(this.absoluteTimer);
			this.absoluteTimer = null;
		}
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.spawnTimer) {
			clearTimeout(this.spawnTimer);
			this.spawnTimer = null;
		}
	}

	isExpired(): boolean {
		return this.state === "EXPIRED" || this.state === "TERMINATED" || this.state === "FAILED";
	}

	isRunning(): boolean {
		return this.state === "RUNNING";
	}

	startReconnectDeadline(): void {
		this.state = "DETACHED";
		this.callbacks.onStateChange(this.sessionId, "DETACHED", "RUNNING");
		this.reconnectTimer = setTimeout(() => {
			if (this.state === "DETACHED" || this.state === "RECONNECTING") {
				this.state = "EXPIRED";
				this.callbacks.onStateChange(this.sessionId, "EXPIRED", this.previousState);
				void this.terminate("graceful");
			}
		}, this.reconnectDeadlineMs);
		this.reconnectTimer.unref();
	}

	getReplay(afterSequence: number): { entries: Array<{ sequence: number; data: string }>; gap: boolean } {
		return this.replay.getReplay(afterSequence);
	}

	getReplayRange(): { earliest: number; latest: number } | null {
		return this.replay.getAvailableRange();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clearTimers();
		if (this.pty) {
			try {
				this.pty.kill("SIGKILL");
			} catch {
				/* ok */
			}
			this.pty = null;
		}
	}
}

export class PtyRuntimeManager {
	private readonly runtimes = new Map<TerminalSessionId, PtyRuntime>();
	private readonly callbacks: PtyRuntimeCallbacks;

	constructor(callbacks: PtyRuntimeCallbacks) {
		this.callbacks = callbacks;
	}

	create(workspaceRoot: string): PtyRuntime {
		const sessionId = randomUUID();
		const runtime = new PtyRuntime(sessionId, workspaceRoot, this.callbacks);
		this.runtimes.set(sessionId, runtime);
		return runtime;
	}

	get(sessionId: TerminalSessionId): PtyRuntime | undefined {
		return this.runtimes.get(sessionId);
	}

	delete(sessionId: TerminalSessionId): void {
		const runtime = this.runtimes.get(sessionId);
		if (runtime) {
			runtime.dispose();
			this.runtimes.delete(sessionId);
		}
	}

	async shutdown(boundedWindowMs = 30_000): Promise<void> {
		const entries = [...this.runtimes.entries()];
		const timeout = setTimeout(() => {}, boundedWindowMs);
		await Promise.all(
			entries.map(async ([id, runtime]) => {
				if (!runtime.isExpired()) {
					await runtime.terminate("graceful");
				}
				this.runtimes.delete(id);
			}),
		);
		clearTimeout(timeout);
	}

	getActiveCount(): number {
		let count = 0;
		for (const runtime of this.runtimes.values()) {
			if (!runtime.isExpired()) count++;
		}
		return count;
	}
}
