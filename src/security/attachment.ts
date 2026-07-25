import type { TerminalSessionId } from "../protocol/types.ts";

export interface TransportConnection {
	connectionId: string;
	authenticated: boolean;
	deviceId?: string;
	establishedAt: string;
}

export interface TerminalAttachment {
	sessionId: TerminalSessionId;
	connectionId: string;
	attachedAt: string;
	lastReceivedSequence: number;
}

export class AttachmentManager {
	private transport: TransportConnection | null = null;
	private readonly attachments = new Map<TerminalSessionId, TerminalAttachment>();

	establishTransport(connectionId: string, deviceId: string): TransportConnection {
		const transport: TransportConnection = {
			connectionId,
			authenticated: true,
			deviceId,
			establishedAt: new Date().toISOString(),
		};
		this.transport = transport;
		return transport;
	}

	loseTransport(): void {
		if (this.transport) {
			this.transport.authenticated = false;
			this.attachments.clear();
			this.transport = null;
		}
	}

	getTransport(): TransportConnection | null {
		return this.transport;
	}

	isTransportActive(): boolean {
		return this.transport?.authenticated === true;
	}

	attach(connectionId: string, sessionId: TerminalSessionId, lastReceivedSequence?: number): TerminalAttachment {
		this.detach(sessionId);

		const attachment: TerminalAttachment = {
			sessionId,
			connectionId,
			attachedAt: new Date().toISOString(),
			lastReceivedSequence: lastReceivedSequence ?? -1,
		};
		this.attachments.set(sessionId, attachment);
		return attachment;
	}

	detach(sessionId: TerminalSessionId): void {
		this.attachments.delete(sessionId);
	}

	getAttachment(sessionId: TerminalSessionId): TerminalAttachment | null {
		return this.attachments.get(sessionId) ?? null;
	}

	isAttached(sessionId: TerminalSessionId): boolean {
		return this.attachments.has(sessionId);
	}

	updateLastReceivedSequence(sessionId: TerminalSessionId, sequence: number): void {
		const attachment = this.attachments.get(sessionId);
		if (attachment) {
			attachment.lastReceivedSequence = sequence;
		}
	}

	getActiveAttachments(): TerminalAttachment[] {
		return Array.from(this.attachments.values());
	}
}
