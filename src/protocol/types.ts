export type ProtocolVersion = 1;

export type Rfc3339Timestamp = string;

export type DeviceId = string;
export type DeviceSessionId = string;
export type WorkspaceId = string;
export type TerminalSessionId = string;
export type LeaseId = string;
export type RequestId = string;
export type AuditEventId = string;

export type TerminalSequence = number;
export type LeaseGeneration = number;

export type TerminalState =
	| "CREATING"
	| "RUNNING"
	| "DETACHED"
	| "RECONNECTING"
	| "TERMINATING"
	| "TERMINATED"
	| "EXPIRED"
	| "FAILED";

export interface ProtocolEnvelope<T> {
	version: 1;
	type: string;
	sessionId?: TerminalSessionId;
	requestId?: RequestId;
	sequence?: TerminalSequence;
	payload: T;
}

export interface ApiSuccess<T> {
	ok: true;
	requestId: RequestId;
	data: T;
}

export interface ApiFailure {
	ok: false;
	requestId: RequestId;
	error: ProtocolError;
}

export type ExecutedStatus = "yes" | "no" | "unknown";

export interface ProtocolError {
	code: string;
	message: string;
	impact: string;
	executed: ExecutedStatus;
	retryable: boolean;
	safeNextAction?: string;
	details?: Record<string, unknown>;
}

export interface OwnedProcessIdentity {
	pid: number;
	processGroupId?: number;
	startedAt: Rfc3339Timestamp;
	platformHandle?: string;
}

export interface TerminalSizeLimits {
	minCols: number;
	maxCols: number;
	minRows: number;
	maxRows: number;
}

export interface ControllerLease {
	leaseId: LeaseId;
	sessionId: TerminalSessionId;
	deviceId: DeviceId;
	generation: LeaseGeneration;
	issuedAt: Rfc3339Timestamp;
	expiresAt: Rfc3339Timestamp;
}

export type LeaseState = "none" | "owned" | "owned-by-other-device";

export interface LeaseSummary {
	state: LeaseState;
	generation?: LeaseGeneration;
	expiresAt?: Rfc3339Timestamp;
}

export interface TerminalLifecycleRecord {
	sessionId: TerminalSessionId;
	state: TerminalState;
	previousState?: TerminalState;
	workspaceId: WorkspaceId;
	launcherId: string;
	createdAt: Rfc3339Timestamp;
	stateChangedAt: Rfc3339Timestamp;
	lastActivityAt: Rfc3339Timestamp;
	reconnectDeadline?: Rfc3339Timestamp;
	idleExpiresAt?: Rfc3339Timestamp;
	absoluteExpiresAt?: Rfc3339Timestamp;
	terminationMode?: "graceful" | "force";
	leaseGeneration: LeaseGeneration;
	lastOutputSequence: TerminalSequence;
	failureCode?: string;
	cleanupResult?: "succeeded" | "failed" | "partial";
	processMayStillBeActive?: boolean;
}

export type LauncherId = "default-shell" | "pi" | "opencode" | "tmux-create" | "tmux-attach";

export interface PairingStatus {
	privateConnection: "verified" | "unverified";
	hostIdentity: string;
	gatewayAvailable: boolean;
	pairingAvailable: boolean;
	codeRequired: boolean;
}

export interface PairingCompleteRequest {
	code: string;
	deviceLabel: string;
}

export interface PairingCompleteResponse {
	deviceId: DeviceId;
	deviceLabel: string;
	sessionIssuedAt: Rfc3339Timestamp;
	sessionExpiresAt: Rfc3339Timestamp;
}

export interface AuthSessionState {
	authenticated: boolean;
	deviceId?: DeviceId;
	deviceLabel?: string;
	issuedAt?: Rfc3339Timestamp;
	expiresAt?: Rfc3339Timestamp;
	idleExpiresAt?: Rfc3339Timestamp;
}

export interface WorkspaceSummary {
	id: WorkspaceId;
	displayName: string;
	enabled: boolean;
	allowedLaunchers: LauncherId[];
}

export interface TerminalSummary {
	sessionId: TerminalSessionId;
	workspaceId: WorkspaceId;
	launcherId: LauncherId;
	state: TerminalState;
	createdAt: Rfc3339Timestamp;
	lastActivityAt: Rfc3339Timestamp;
	reconnectDeadline?: Rfc3339Timestamp;
	lease: LeaseSummary;
}

export interface CreateTerminalRequest {
	workspaceId: WorkspaceId;
	launcherId: LauncherId;
	cols: number;
	rows: number;
	clientRequestId: RequestId;
}

export interface CreateTerminalResponse {
	session: TerminalSummary;
	websocketPath: string;
}

export interface TerminalDetails extends TerminalSummary {
	processLabel?: string;
	reconnectPolicy: {
		deadlineSeconds: number;
		replayAvailable: boolean;
	};
	limits: {
		maxInputBytes: number;
		maxResizeRatePerSecond: number;
	};
}

export interface TerminateTerminalRequest {
	mode: "graceful" | "force";
	reason?: string;
	clientRequestId: RequestId;
}

export interface TerminateTerminalResponse {
	accepted: true;
	state: "TERMINATING" | "TERMINATED";
}

export interface AcquireLeaseRequest {
	clientRequestId: RequestId;
}

export interface AcquireLeaseResponse {
	lease: ControllerLease;
}

export interface TransferLeaseRequest {
	expectedGeneration: LeaseGeneration;
	targetDeviceId: DeviceId;
	clientRequestId: RequestId;
}

export interface TransferLeaseResponse {
	lease: ControllerLease;
	revokedDeviceId?: DeviceId;
}

export interface ReleaseLeaseRequest {
	expectedGeneration: LeaseGeneration;
	clientRequestId: RequestId;
}

export interface ReleaseLeaseResponse {
	released: true;
	generation: LeaseGeneration;
}

export interface ConnectionReadyPayload {
	connectionId: string;
	serverTime: Rfc3339Timestamp;
	protocolVersion: 1;
	heartbeatIntervalMs: number;
	maxMessageBytes: number;
}

export interface ClientHelloPayload {
	clientName: "pi-pocket-console-web";
	clientVersion: string;
	supportedProtocolVersions: [1];
	platform: "ios-pwa" | "tablet-web" | "desktop-web";
}

export interface ConnectionErrorPayload {
	error: ProtocolError;
	closeAfter: boolean;
}

export interface TerminalAttachPayload {
	lastReceivedSequence?: TerminalSequence;
}

export interface TerminalAttachedPayload {
	state: TerminalState;
	replay: {
		available: boolean;
		earliestSequence?: TerminalSequence;
		latestSequence?: TerminalSequence;
		gap: boolean;
	};
	lease: LeaseSummary;
}

export interface TerminalDetachPayload {
	reason: "navigation" | "background" | "manual" | "shutdown";
}

export interface TerminalInputPayload {
	leaseId: LeaseId;
	leaseGeneration: LeaseGeneration;
	data: string;
}

export interface TerminalInputAcceptedPayload {
	accepted: true;
}

export interface TerminalInputRejectedPayload {
	error: ProtocolError;
}

export interface TerminalOutputPayload {
	data: string;
}

export interface TerminalResizePayload {
	leaseId: LeaseId;
	leaseGeneration: LeaseGeneration;
	cols: number;
	rows: number;
}

export interface TerminalResizeAcceptedPayload {
	cols: number;
	rows: number;
}

export interface ConnectionPingPayload {
	sentAt: Rfc3339Timestamp;
}

export interface ConnectionPongPayload {
	sentAt: Rfc3339Timestamp;
	receivedAt: Rfc3339Timestamp;
}

export interface TerminalReplayBeginPayload {
	fromSequence: TerminalSequence;
	toSequence: TerminalSequence;
}

export interface TerminalReplayEndPayload {
	lastSequence: TerminalSequence;
}

export interface TerminalReplayAckPayload {
	lastReceivedSequence: TerminalSequence;
}

export interface TerminalReplayGapPayload {
	requestedAfter: TerminalSequence;
	earliestAvailable: TerminalSequence;
	latestAvailable: TerminalSequence;
	lostOutput: true;
	safeNextAction: string;
}

export interface LeaseGrantedPayload {
	lease: ControllerLease;
}

export type LeaseRevocationReason =
	| "transfer"
	| "release"
	| "expiry"
	| "session-termination"
	| "administrative-revocation";

export interface LeaseRevokedPayload {
	previousGeneration: LeaseGeneration;
	newGeneration: LeaseGeneration;
	reason: LeaseRevocationReason;
}

export interface LeaseExpiringPayload {
	generation: LeaseGeneration;
	expiresAt: Rfc3339Timestamp;
}

export interface LeaseChangedPayload {
	state: LeaseSummary;
}

export interface TerminalStatePayload {
	previousState?: TerminalState;
	state: TerminalState;
	changedAt: Rfc3339Timestamp;
	reasonCode?: string;
	reconnectDeadline?: Rfc3339Timestamp;
}

export interface TerminalProcessExitPayload {
	exitCode?: number;
	signal?: string;
	expected: boolean;
}

export type TerminalWarningCode =
	| "OUTPUT_DROPPED"
	| "REPLAY_NEAR_LIMIT"
	| "IDLE_EXPIRY_NEAR"
	| "ABSOLUTE_EXPIRY_NEAR"
	| "LEASE_EXPIRY_NEAR";

export interface TerminalWarningPayload {
	code: TerminalWarningCode;
	message: string;
	safeNextAction?: string;
}

export interface TerminalFailurePayload {
	error: ProtocolError;
}

export interface DiagnosticsSummary {
	gateway: {
		status: "healthy" | "degraded" | "unavailable";
		boundAddress: "127.0.0.1";
	};
	tailscale: {
		serveConfigured: boolean;
		funnelEnabled: boolean;
	};
	authentication: {
		authenticated: boolean;
		expiresAt?: Rfc3339Timestamp;
	};
	terminalLimits: {
		activeForDevice: number;
		activeGlobal: number;
	};
	redactedEvents: DiagnosticEventSummary[];
}

export interface DiagnosticEventSummary {
	eventId: AuditEventId;
	timestamp: Rfc3339Timestamp;
	severity: "info" | "warning" | "error";
	code: string;
	message: string;
	safeNextAction?: string;
}
