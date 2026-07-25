import { randomUUID } from "node:crypto";
import type { RpcCommand, RpcExtensionUIResponse, RpcResponse } from "@earendil-works/pi-coding-agent";
import { PocketRpcProcess, type RpcOutboundMessage } from "./rpc-process.ts";

export type InstanceStatus = "starting" | "online" | "stopping" | "stopped" | "error";

export interface InstanceSummary {
	id: string;
	status: InstanceStatus;
	cwd: string;
	createdAt: string;
	lastSeenAt: string;
	label?: string;
	sessionId?: string;
	sessionFile?: string;
}

export type PocketStreamMessage =
	| RpcOutboundMessage
	| { type: "instance_status"; instanceId: string; status: InstanceStatus; error?: string };

export interface InstanceController {
	list(): InstanceSummary[];
	spawn(label?: string): Promise<InstanceSummary>;
	status(instanceId: string): InstanceSummary | undefined;
	stop(instanceId: string): Promise<InstanceSummary | undefined>;
	send(instanceId: string, command: RpcCommand): Promise<RpcResponse>;
	sendUiResponse(instanceId: string, response: RpcExtensionUIResponse): void;
	subscribe(instanceId: string, listener: (message: PocketStreamMessage) => void): (() => void) | undefined;
	shutdown(): Promise<void>;
}

interface LiveInstance {
	record: InstanceSummary;
	process?: PocketRpcProcess;
	listeners: Set<(message: PocketStreamMessage) => void>;
	unsubscribeMessage?: () => void;
	unsubscribeExit?: () => void;
}

function clone(record: InstanceSummary): InstanceSummary {
	return { ...record };
}

export class InstanceManager implements InstanceController {
	private readonly instances = new Map<string, LiveInstance>();

	constructor(
		private readonly workspaceRoot: string,
		private readonly maxInstances: number = 1,
	) {}

	private update(live: LiveInstance, updates: Partial<InstanceSummary>): void {
		live.record = {
			...live.record,
			...updates,
			lastSeenAt: new Date().toISOString(),
		};
	}

	private publish(live: LiveInstance, message: PocketStreamMessage): void {
		for (const listener of live.listeners) {
			listener(message);
		}
	}

	list(): InstanceSummary[] {
		return [...this.instances.values()].map((live) => clone(live.record));
	}

	status(instanceId: string): InstanceSummary | undefined {
		const live = this.instances.get(instanceId);
		return live ? clone(live.record) : undefined;
	}

	async spawn(label?: string): Promise<InstanceSummary> {
		let liveCount = 0;
		for (const live of this.instances.values()) {
			if (live.record.status !== "stopped") {
				liveCount += 1;
			}
		}
		if (liveCount >= this.maxInstances) {
			throw new Error("capacity_exceeded");
		}

		const now = new Date().toISOString();
		const live: LiveInstance = {
			record: {
				id: randomUUID(),
				status: "starting",
				cwd: this.workspaceRoot,
				createdAt: now,
				lastSeenAt: now,
				label,
			},
			listeners: new Set(),
		};
		this.instances.set(live.record.id, live);

		try {
			const rpcProcess = new PocketRpcProcess(this.workspaceRoot);
			live.process = rpcProcess;
			live.unsubscribeMessage = rpcProcess.onMessage((message) => {
				if (message.type === "response" && message.command === "get_state" && message.success && "data" in message) {
					this.update(live, {
						sessionId: message.data.sessionId,
						sessionFile: message.data.sessionFile,
					});
				}
				this.publish(live, message);
			});
			live.unsubscribeExit = rpcProcess.onExit((error) => {
				if (live.record.status === "stopping" || live.record.status === "stopped") {
					return;
				}
				this.update(live, { status: "error" });
				this.publish(live, {
					type: "instance_status",
					instanceId: live.record.id,
					status: "error",
					error: error?.message,
				});
			});

			const state = await rpcProcess.send({ type: "get_state" });
			if (!state.success) {
				throw new Error(state.error);
			}
			this.update(live, { status: "online" });
			this.publish(live, {
				type: "instance_status",
				instanceId: live.record.id,
				status: "online",
			});
			return clone(live.record);
		} catch (error) {
			live.unsubscribeMessage?.();
			live.unsubscribeExit?.();
			await live.process?.dispose();
			live.process = undefined;
			this.instances.delete(live.record.id);
			throw error;
		}
	}

	async stop(instanceId: string): Promise<InstanceSummary | undefined> {
		const live = this.instances.get(instanceId);
		if (!live) {
			return undefined;
		}
		if (live.record.status === "stopped") {
			return clone(live.record);
		}

		this.update(live, { status: "stopping" });
		this.publish(live, { type: "instance_status", instanceId, status: "stopping" });
		live.unsubscribeMessage?.();
		live.unsubscribeExit?.();
		await live.process?.dispose();
		live.process = undefined;
		this.update(live, { status: "stopped" });
		this.publish(live, { type: "instance_status", instanceId, status: "stopped" });
		return clone(live.record);
	}

	async send(instanceId: string, command: RpcCommand): Promise<RpcResponse> {
		const live = this.instances.get(instanceId);
		if (!live?.process || live.record.status !== "online") {
			throw new Error(`Instance is not online: ${instanceId}`);
		}
		return live.process.send(command);
	}

	sendUiResponse(instanceId: string, response: RpcExtensionUIResponse): void {
		const live = this.instances.get(instanceId);
		if (!live?.process || live.record.status !== "online") {
			throw new Error(`Instance is not online: ${instanceId}`);
		}
		live.process.sendUiResponse(response);
	}

	subscribe(instanceId: string, listener: (message: PocketStreamMessage) => void): (() => void) | undefined {
		const live = this.instances.get(instanceId);
		if (!live) {
			return undefined;
		}
		live.listeners.add(listener);
		return () => live.listeners.delete(listener);
	}

	async shutdown(): Promise<void> {
		await Promise.all(
			[...this.instances.values()]
				.filter((live) => live.process)
				.map((live) => this.stop(live.record.id).then(() => undefined)),
		);
	}
}
