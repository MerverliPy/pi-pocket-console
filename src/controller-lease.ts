interface Lease {
	sessionId: string;
	clientId: string;
	expiresAt: number;
}

export class ControllerLeases {
	private readonly leases = new Map<string, Lease>();

	constructor(private readonly ttlMs = 45_000) {}

	claim(instanceId: string, sessionId: string, clientId: string, now = Date.now()): boolean {
		const current = this.leases.get(instanceId);
		if (current) {
			if (current.sessionId === sessionId && current.clientId === clientId) {
			} else if (current.expiresAt > now) {
				return false;
			}
		}
		this.leases.set(instanceId, { sessionId, clientId, expiresAt: now + this.ttlMs });
		return true;
	}

	release(instanceId: string, sessionId?: string, clientId?: string): void {
		const current = this.leases.get(instanceId);
		if (!current) {
			return;
		}
		if (sessionId !== undefined && clientId !== undefined) {
			if (current.sessionId !== sessionId || current.clientId !== clientId) {
				return;
			}
		} else if (sessionId !== undefined) {
			if (current.sessionId !== sessionId) {
				return;
			}
		}
		this.leases.delete(instanceId);
	}

	clear(): void {
		this.leases.clear();
	}
}
