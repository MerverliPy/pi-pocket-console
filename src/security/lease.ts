import type {
	ControllerLease,
	DeviceId,
	LeaseGeneration,
	LeaseId,
	LeaseState,
	LeaseSummary,
	TerminalSessionId,
} from "../protocol/types.ts";

export type LeaseRevocationReason =
	| "transfer"
	| "release"
	| "expiry"
	| "session-termination"
	| "administrative-revocation";

export interface LeaseRecord {
	lease: ControllerLease;
	active: boolean;
}

export class LeaseManager {
	private lease: LeaseRecord | null = null;
	private generation: LeaseGeneration = 0;

	private generateLeaseId(): LeaseId {
		const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
		let id = "";
		for (let i = 0; i < 32; i++) {
			id += chars[Math.floor(Math.random() * chars.length)];
		}
		return id;
	}

	acquire(sessionId: TerminalSessionId, deviceId: DeviceId, durationMs: number): ControllerLease {
		if (this.lease) {
			this.lease.active = false;
		}
		this.lease = null;
		this.generation += 1;

		const now = new Date().toISOString();
		const lease: ControllerLease = {
			leaseId: this.generateLeaseId(),
			sessionId,
			deviceId,
			generation: this.generation,
			issuedAt: now,
			expiresAt: new Date(Date.now() + durationMs).toISOString(),
		};

		this.lease = { lease, active: true };
		return lease;
	}

	revoke(_reason: LeaseRevocationReason): { previousGeneration: LeaseGeneration; newGeneration: LeaseGeneration } {
		const previousGeneration = this.generation;
		this.generation += 1;

		if (this.lease) {
			this.lease.active = false;
		}
		this.lease = null;

		return { previousGeneration, newGeneration: this.generation };
	}

	transfer(targetDeviceId: DeviceId, durationMs: number): ControllerLease | null {
		if (!this.lease || !this.lease.active) {
			return null;
		}

		const sessionId = this.lease.lease.sessionId;
		return this.acquire(sessionId, targetDeviceId, durationMs);
	}

	isValid(leaseId: LeaseId, generation: LeaseGeneration): boolean {
		if (!this.lease || !this.lease.active) {
			return false;
		}
		if (this.lease.lease.leaseId !== leaseId) {
			return false;
		}
		if (this.lease.lease.generation !== generation) {
			return false;
		}
		const now = Date.now();
		const expiresAt = new Date(this.lease.lease.expiresAt).getTime();
		if (now >= expiresAt) {
			this.lease.active = false;
			return false;
		}
		return true;
	}

	isExpired(): boolean {
		if (!this.lease) {
			return true;
		}
		const expiresAt = new Date(this.lease.lease.expiresAt).getTime();
		if (Date.now() >= expiresAt) {
			this.lease.active = false;
			return true;
		}
		return false;
	}

	getCurrentLease(): ControllerLease | null {
		if (!this.lease || !this.lease.active || this.isExpired()) {
			return null;
		}
		return this.lease.lease;
	}

	getGeneration(): LeaseGeneration {
		return this.generation;
	}

	getSummary(currentDeviceId?: DeviceId): LeaseSummary {
		const lease = this.getCurrentLease();
		if (!lease) {
			return { state: "none" };
		}

		let state: LeaseState = "owned-by-other-device";
		if (currentDeviceId && lease.deviceId === currentDeviceId) {
			state = "owned";
		}

		return {
			state,
			generation: lease.generation,
			expiresAt: lease.expiresAt,
		};
	}

	invalidateOnSessionExpiry(): void {
		if (this.lease) {
			this.lease.active = false;
		}
		this.generation += 1;
	}
}
