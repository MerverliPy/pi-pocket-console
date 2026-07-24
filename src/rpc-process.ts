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

interface PendingRequest {
	resolve(response: RpcResponse): void;
	reject(error: Error): void;
}

export function resolveRpcEntryPath(): string {
	return fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
}

export class PocketRpcProcess {
	readonly child: ChildProcess;

	private exited = false;
	private exitNotified = false;
	private nextRequestId = 0;
	private stdoutBuffer = "";
	private stderrBuffer = "";
	private readonly pendingRequests = new Map<string, PendingRequest>();
	private readonly messageListeners = new Set<(message: RpcOutboundMessage) => void>();
	private readonly exitListeners = new Set<(error?: Error) => void>();

	constructor(cwd: string) {
		this.child = spawn(process.execPath, [resolveRpcEntryPath()], {
			cwd,
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		if (!this.child.stdin || !this.child.stdout) {
			throw new Error("Failed to create Pi RPC process stdio");
		}
		this.attachListeners();
	}

	private attachListeners(): void {
		this.child.stdout?.setEncoding("utf8");
		this.child.stdout?.on("data", (chunk: string) => {
			this.stdoutBuffer += chunk;
			for (;;) {
				const newlineIndex = this.stdoutBuffer.indexOf("\n");
				if (newlineIndex === -1) {
					break;
				}
				const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
				this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
				if (line) {
					this.handleLine(line);
				}
			}
		});

		this.child.stderr?.setEncoding("utf8");
		this.child.stderr?.on("data", (chunk: string) => {
			this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-16_384);
		});

		this.child.once("error", (error) => {
			this.handleExit(new Error(`Pi RPC process error: ${error.message}${this.stderrSuffix()}`));
		});
		this.child.once("exit", (code, signal) => {
			this.handleExit(new Error(`Pi RPC process exited (code=${code} signal=${signal})${this.stderrSuffix()}`));
		});
	}

	private stderrSuffix(): string {
		const stderr = this.stderrBuffer.trim();
		return stderr ? `. Stderr: ${stderr}` : "";
	}

	private handleLine(line: string): void {
		let parsed: RpcOutboundMessage;
		try {
			parsed = JSON.parse(line) as RpcOutboundMessage;
		} catch (error) {
			this.handleExit(
				new Error(`Pi RPC emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}`),
			);
			this.child.kill("SIGTERM");
			return;
		}

		for (const listener of this.messageListeners) {
			listener(parsed);
		}

		if (parsed.type !== "response" || !parsed.id) {
			return;
		}
		const pending = this.pendingRequests.get(parsed.id);
		if (!pending) {
			return;
		}
		this.pendingRequests.delete(parsed.id);
		pending.resolve(parsed);
	}

	private handleExit(error: Error): void {
		this.exited = true;
		for (const [id, pending] of this.pendingRequests) {
			this.pendingRequests.delete(id);
			pending.reject(error);
		}
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
			return Promise.reject(new Error(`Pi RPC process is not running${this.stderrSuffix()}`));
		}
		const id = command.id ?? `pocket_${++this.nextRequestId}_${randomUUID()}`;
		const fullCommand = { ...command, id };
		return new Promise<RpcResponse>((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });
			this.child.stdin?.write(`${JSON.stringify(fullCommand)}\n`, (error) => {
				if (!error) {
					return;
				}
				this.pendingRequests.delete(id);
				reject(error);
			});
		});
	}

	sendUiResponse(response: RpcExtensionUIResponse): void {
		if (this.exited) {
			throw new Error(`Pi RPC process is not running${this.stderrSuffix()}`);
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
		this.messageListeners.clear();
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
