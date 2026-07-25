import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AttachmentManager } from "../src/security/attachment.ts";
import { LeaseManager } from "../src/security/lease.ts";

describe("LeaseManager", () => {
	test("acquire returns a valid lease", () => {
		const manager = new LeaseManager();
		const lease = manager.acquire("session-1", "device-a", 300_000);

		assert.equal(lease.sessionId, "session-1");
		assert.equal(lease.deviceId, "device-a");
		assert.equal(lease.generation, 1);
		assert.ok(lease.leaseId.length > 0);
		assert.ok(lease.issuedAt);
		assert.ok(lease.expiresAt);
	});

	test("acquire increments generation", () => {
		const manager = new LeaseManager();
		const lease1 = manager.acquire("session-1", "device-a", 300_000);
		assert.equal(lease1.generation, 1);

		const lease2 = manager.acquire("session-1", "device-b", 300_000);
		assert.equal(lease2.generation, 2);
		assert.notEqual(lease2.leaseId, lease1.leaseId);
	});

	test("isValid returns true for active lease", () => {
		const manager = new LeaseManager();
		const lease = manager.acquire("session-1", "device-a", 300_000);

		assert.equal(manager.isValid(lease.leaseId, lease.generation), true);
	});

	test("isValid returns false for wrong leaseId", () => {
		const manager = new LeaseManager();
		manager.acquire("session-1", "device-a", 300_000);

		assert.equal(manager.isValid("wrong-id", 1), false);
	});

	test("isValid returns false for stale generation", () => {
		const manager = new LeaseManager();
		const lease = manager.acquire("session-1", "device-a", 300_000);

		assert.equal(manager.isValid(lease.leaseId, 99), false);
	});

	test("isValid returns false after revoke", () => {
		const manager = new LeaseManager();
		const lease = manager.acquire("session-1", "device-a", 300_000);

		manager.revoke("release");
		assert.equal(manager.isValid(lease.leaseId, lease.generation), false);
	});

	test("revoke returns generation info", () => {
		const manager = new LeaseManager();
		manager.acquire("session-1", "device-a", 300_000);

		const result = manager.revoke("expiry");
		assert.equal(result.previousGeneration, 1);
		assert.equal(result.newGeneration, 2);
	});

	test("transfer creates new lease for target device", () => {
		const manager = new LeaseManager();
		manager.acquire("session-1", "device-a", 300_000);

		const newLease = manager.transfer("device-b", 300_000);
		assert.ok(newLease);
		assert.equal(newLease.deviceId, "device-b");
		assert.equal(newLease.generation, 2);
	});

	test("transfer returns null when no active lease", () => {
		const manager = new LeaseManager();
		const result = manager.transfer("device-b", 300_000);
		assert.equal(result, null);
	});

	test("getSummary returns 'none' when no lease", () => {
		const manager = new LeaseManager();
		assert.deepEqual(manager.getSummary(), { state: "none" });
	});

	test("getSummary returns 'owned' for matching device", () => {
		const manager = new LeaseManager();
		manager.acquire("session-1", "device-a", 300_000);

		const summary = manager.getSummary("device-a");
		assert.equal(summary.state, "owned");
		assert.equal(summary.generation, 1);
	});

	test("getSummary returns 'owned-by-other-device' for different device", () => {
		const manager = new LeaseManager();
		manager.acquire("session-1", "device-a", 300_000);

		const summary = manager.getSummary("device-b");
		assert.equal(summary.state, "owned-by-other-device");
	});

	test("invalidateOnSessionExpiry makes lease invalid", () => {
		const manager = new LeaseManager();
		const lease = manager.acquire("session-1", "device-a", 300_000);

		manager.invalidateOnSessionExpiry();
		assert.equal(manager.isValid(lease.leaseId, lease.generation), false);
	});

	test("isValid returns false for expired lease", () => {
		const manager = new LeaseManager();
		const lease = manager.acquire("session-1", "device-a", 1);

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				assert.equal(manager.isValid(lease.leaseId, lease.generation), false);
				resolve();
			}, 5);
		});
	});
});

describe("AttachmentManager", () => {
	test("establishTransport creates an active transport", () => {
		const manager = new AttachmentManager();
		const transport = manager.establishTransport("conn-1", "device-a");

		assert.equal(transport.connectionId, "conn-1");
		assert.equal(transport.authenticated, true);
		assert.equal(transport.deviceId, "device-a");
		assert.ok(transport.establishedAt);
	});

	test("isTransportActive returns true after establish", () => {
		const manager = new AttachmentManager();
		manager.establishTransport("conn-1", "device-a");

		assert.equal(manager.isTransportActive(), true);
	});

	test("loseTransport clears transport and attachments", () => {
		const manager = new AttachmentManager();
		manager.establishTransport("conn-1", "device-a");
		manager.attach("conn-1", "session-1");

		manager.loseTransport();
		assert.equal(manager.isTransportActive(), false);
		assert.equal(manager.getTransport(), null);
		assert.equal(manager.isAttached("session-1"), false);
	});

	test("attach creates an attachment", () => {
		const manager = new AttachmentManager();
		manager.establishTransport("conn-1", "device-a");
		const attachment = manager.attach("conn-1", "session-1");

		assert.equal(attachment.sessionId, "session-1");
		assert.equal(attachment.connectionId, "conn-1");
		assert.ok(attachment.attachedAt);
	});

	test("attach with lastReceivedSequence", () => {
		const manager = new AttachmentManager();
		manager.establishTransport("conn-1", "device-a");
		const attachment = manager.attach("conn-1", "session-1", 42);

		assert.equal(attachment.lastReceivedSequence, 42);
	});

	test("attach without sequence defaults to -1", () => {
		const manager = new AttachmentManager();
		manager.establishTransport("conn-1", "device-a");
		const attachment = manager.attach("conn-1", "session-1");

		assert.equal(attachment.lastReceivedSequence, -1);
	});

	test("isAttached returns true after attach", () => {
		const manager = new AttachmentManager();
		manager.establishTransport("conn-1", "device-a");
		manager.attach("conn-1", "session-1");

		assert.equal(manager.isAttached("session-1"), true);
	});

	test("detach removes attachment", () => {
		const manager = new AttachmentManager();
		manager.establishTransport("conn-1", "device-a");
		manager.attach("conn-1", "session-1");
		manager.detach("session-1");

		assert.equal(manager.isAttached("session-1"), false);
		assert.equal(manager.getAttachment("session-1"), null);
	});

	test("updateLastReceivedSequence updates sequence", () => {
		const manager = new AttachmentManager();
		manager.establishTransport("conn-1", "device-a");
		manager.attach("conn-1", "session-1", 10);
		manager.updateLastReceivedSequence("session-1", 25);

		const attachment = manager.getAttachment("session-1");
		assert.ok(attachment);
		assert.equal(attachment.lastReceivedSequence, 25);
	});

	test("getActiveAttachments returns all attachments", () => {
		const manager = new AttachmentManager();
		manager.establishTransport("conn-1", "device-a");
		manager.attach("conn-1", "session-1");
		manager.attach("conn-1", "session-2");

		const active = manager.getActiveAttachments();
		assert.equal(active.length, 2);
	});
});
