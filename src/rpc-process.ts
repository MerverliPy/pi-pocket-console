import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type {
	AgentSessionEvent,
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
} from "@earendil-works/pi-coding-agent";

export type RpcOutboundMessage = AgentSessionEvent | RpcExtensionUIRequest | RpcResponse;

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const MAX_LINE_LENGTH = 1_048_576;
const MAX_BUFFER_SIZE = 8 * MAX_LINE_LENGTH;
const MAX_STDERR_BYTES = 16_384;

interface PendingRequest {
	resolve(response: RpcResponse): void;
	reject(error: Error): void;
	timer?: ReturnType<typeof setTimeout>;
}

export function resolveRpcEntryPath(): string {
	return fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
}

function isMinimalRpcResponse(value: unknown): value is { type: string; id?: string } {
	return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).type === "string";
}

export interface ProcessErrorDetail {
	errorId: string;
	message: string;
	stderr: string;
	code?: number | null;
	signal?: string | null;
}

export class PocketRpcProcess {
	readonly child: ChildProcess;

	private exited = false;
	private exitNotified = false;
	private disposed = false;
	private nextRequestId = 0;
	private stdoutBuffer = "";
	private stderrBuffer = "";
	private readonly processId: string;
	private readonly commandTimeoutMs: number;
	private readonly pendingRequests = new Map<string, PendingRequest>();
	private readonly messageListeners = new Set<(message: RpcOutboundMessage) => void>();
	private readonly exitListeners = new Set<(error?: Error) => void>();

	constructor(cwd: string, commandTimeoutMs?: number, entryPath?: string) {
		this.processId = randomUUID().slice(0, 8);
		this.commandTimeoutMs = commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
		this.child = spawn(process.execPath, [entryPath ?? resolveRpcEntryPath()], {
			cwd,
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		if (!this.child.stdin || !this.child.stdout) {
			throw new Error("Failed to create Pi RPC process stdio");
		}
		this.attachListeners();
	}

	get processErrorDetail(): ProcessErrorDetail | undefined {
		if (this.stderrBuffer || this.exited) {
			const stderr = this.stderrBuffer.trim();
			const code = this.child.exitCode;
			const signal = this.child.signalCode;
			return {
				errorId: this.processId,
				message: `Pi RPC process exited (pid=${this.child.pid}, code=${code}, signal=${signal})`,
				stderr,
				code,
				signal,
			};
		}
		return undefined;
	}

	private attachListeners(): void {
		this.child.stdout?.setEncoding("utf8");
		this.child.stdout?.on("data", (chunk: string) => {
			if (this.stdoutBuffer.length + chunk.length > MAX_BUFFER_SIZE) {
				this.handleExit(new Error("Pi RPC stdout buffer too large"));
				this.child.kill("SIGTERM");
				return;
			}
			this.stdoutBuffer += chunk;
			for (;;) {
				const newlineIndex = this.stdoutBuffer.indexOf("\n");
				if (newlineIndex === -1) {
					break;
				}
				const line = this.stdoutBuffer.slice(0, newlineIndex);
				this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
				if (line.length > MAX_LINE_LENGTH) {
					this.handleExit(new Error("Pi RPC emitted an oversized line"));
					this.child.kill("SIGTERM");
					return;
				}
				const trimmed = line.trim();
				if (trimmed) {
					this.handleLine(trimmed);
				}
			}
		});

		this.child.stderr?.setEncoding("utf8");
		this.child.stderr?.on("data", (chunk: string) => {
			this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-MAX_STDERR_BYTES);
		});

		this.child.once("error", (_error) => {
			this.handleExit(new Error(`Pi RPC process error (pid=${this.child.pid})`));
		});
		this.child.once("exit", (code, signal) => {
			const publicMsg = `Pi RPC process exited (code=${code}, signal=${signal})`;
			this.handleExit(new Error(publicMsg));
		});
	}

	private handleLine(line: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (_error) {
			this.handleExit(new Error("Pi RPC emitted invalid JSON"));
			this.child.kill("SIGTERM");
			return;
		}

		if (!isMinimalRpcResponse(parsed)) {
			return;
		}

		for (const listener of this.messageListeners) {
			listener(parsed as RpcOutboundMessage);
		}

		if (parsed.type !== "response" || !parsed.id) {
			return;
		}
		const pending = this.pendingRequests.get(parsed.id);
		if (!pending) {
			return;
		}
		this.pendingRequests.delete(parsed.id);
		clearTimeout(pending.timer);
		pending.resolve(parsed as RpcResponse);
	}

	private clearAllPendingRequests(error: Error): void {
		for (const [id, pending] of this.pendingRequests) {
			this.pendingRequests.delete(id);
			clearTimeout(pending.timer);
			pending.reject(error);
		}
	}

	private handleExit(error: Error): void {
		if (this.exited) {
			return;
		}
		this.exited = true;
		this.clearAllPendingRequests(error);
		if (this.exitNotified) {
			return;
		}
		this.exitNotified = true;
		for (const listener of this.exitListeners) {
			listener(error);
		}
	}

	send(command: RpcCommand): Promise<RpcResponse> {
		if (this.exited) {
			return Promise.reject(new Error(`Pi RPC process is not running (errorId=${this.processId})`));
		}
		const id = command.id ?? `pocket_${++this.nextRequestId}_${randomUUID()}`;
		const fullCommand = { ...command, id };
		return new Promise<RpcResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this.pendingRequests.delete(id)) {
					reject(new Error(`Command "${command.type}" timed out (errorId=${this.processId})`));
				}
			}, this.commandTimeoutMs);
			timer.unref();
			if (this.pendingRequests.has(id)) {
				clearTimeout(timer);
				reject(new Error(`Duplicate request id: ${id}`));
				return;
			}
			this.pendingRequests.set(id, { resolve, reject, timer });
			this.child.stdin?.write(`${JSON.stringify(fullCommand)}\n`, (error) => {
				if (error) {
					this.pendingRequests.delete(id);
					clearTimeout(timer);
					reject(error);
				}
			});
		});
	}

	sendUiResponse(response: RpcExtensionUIResponse): void {
		if (this.exited) {
			throw new Error(`Pi RPC process is not running (errorId=${this.processId})`);
		}
		this.child.stdin?.write(`${JSON.stringify(response)}\n`);
	}

	onMessage(listener: (message: RpcOutboundMessage) => void): () => void {
		this.messageListeners.add(listener);
		return () => this.messageListeners.delete(listener);
	}

	onExit(listener: (error?: Error) => void): () => void {
		this.exitListeners.add(listener);
		return () => this.exitListeners.delete(listener);
	}

	async dispose(): Promise<void> {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.messageListeners.clear();
		const exitError = new Error("Pi RPC process was disposed");
		this.clearAllPendingRequests(exitError);
		if (this.exited) {
			return;
		}
		await new Promise<void>((resolve) => {
			const forceTimer = setTimeout(() => {
				if (!this.exited) {
					this.child.kill("SIGKILL");
				}
			}, 3_000);
			forceTimer.unref();
			this.child.once("exit", () => {
				clearTimeout(forceTimer);
				resolve();
			});
			this.child.kill("SIGTERM");
		});
	}
}
