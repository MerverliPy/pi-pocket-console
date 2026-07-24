interface Lease {
	owner: string;
	expiresAt: number;
}

export class ControllerLeases {
	private readonly leases = new Map<string, Lease>();

	constructor(private readonly ttlMs = 45_000) {}

	claim(instanceId: string, owner: string, now = Date.now()): boolean {
		const current = this.leases.get(instanceId);
		if (current && current.owner !== owner && current.expiresAt > now) {
			return false;
		}
		this.leases.set(instanceId, { owner, expiresAt: now + this.ttlMs });
		return true;
	}

	release(instanceId: string, owner?: string): void {
		const current = this.leases.get(instanceId);
		if (!current || (owner !== undefined && current.owner !== owner)) {
			return;
		}
		this.leases.delete(instanceId);
	}

	clear(): void {
		this.leases.clear();
	}
}
