# Pi Pocket Console v0.2 Protocol Specification

**Status:** Phase 0 planning baseline
**Product:** Pi Pocket Console v0.2
**Protocol version:** `1`
**Implementation branch:** `agent/v0.2-hybrid-terminal-pwa`
**Published baseline:** `0.1.0` at commit `e083ad04885620478009b7967d25744e134999c1`

---

## 1. Purpose

This document defines the Phase 1 protocol contract for Pi Pocket Console v0.2.

It covers:

- HTTPS control-plane operations
- authenticated WebSocket transport
- versioned envelopes
- terminal creation and listing
- controller-lease acquisition and transfer
- PTY input and output
- resize
- heartbeats
- replay and reconnect
- lifecycle events
- termination
- diagnostics
- validation
- limits
- compatibility
- error handling

The gateway is authoritative for authentication, authorization, session state, controller-lease state, lifecycle state, sequence numbers, replay state, and limits.

---

## 2. Protocol goals

The protocol must:

1. Be versioned.
2. Reject unknown versions.
3. Reject unknown message types.
4. Authenticate every control-plane operation.
5. Authenticate the WebSocket upgrade.
6. Authorize every terminal-specific operation.
7. Require the active controller lease for input and resize.
8. Use server-authoritative sequence numbers.
9. Support bounded replay.
10. Make replay gaps explicit.
11. Make lifecycle transitions explicit.
12. Avoid silent retries of terminal input.
13. Support deterministic reconnect.
14. Support graceful and forced termination.
15. Bound input, output, replay, and resize behavior.
16. Preserve the existing structured Pi RPC contract.
17. Avoid placing secrets in URLs, logs, payloads, or browser storage.

---

## 3. Transport architecture

### 3.1 HTTPS control plane

Use HTTPS for:

- pairing
- authentication state
- device-session state
- workspace listing
- terminal listing
- terminal creation
- lease acquisition
- lease transfer
- lease release
- termination
- diagnostics
- provider and model status
- structured Pi RPC control operations

### 3.2 Authenticated WebSocket data plane

Use WSS for:

- terminal input
- terminal output
- resize
- heartbeat
- replay acknowledgement
- replay-gap notification
- controller-lease events
- lifecycle events
- reconnect synchronization
- terminal warnings

### 3.3 Required deployment properties

- HTTPS and WSS only
- gateway binds only to `127.0.0.1`
- Tailscale Serve provides private routing
- Tailscale Funnel disabled
- strict host and origin validation
- no secrets in URL query parameters
- no authentication token in WebSocket URL

---

## 4. Content types and encoding

### 4.1 HTTPS

Request and response bodies use:

```text
Content-Type: application/json
```

Character encoding:

```text
UTF-8
```

### 4.2 WebSocket

Phase 1 uses UTF-8 JSON text frames.

Binary terminal frames are deferred.

### 4.3 JSON rules

- object keys use `camelCase`
- timestamps use RFC 3339 UTC
- identifiers are opaque strings
- integer sequence numbers are non-negative
- unknown fields are rejected in security-critical messages unless a specific schema allows extension fields
- `null` is accepted only where explicitly defined
- clients must not depend on object-key ordering

---

## 5. Common types

```ts
type ProtocolVersion = 1;

type Rfc3339Timestamp = string;

type DeviceId = string;
type DeviceSessionId = string;
type WorkspaceId = string;
type TerminalSessionId = string;
type LeaseId = string;
type RequestId = string;
type AuditEventId = string;

type TerminalSequence = number;
type LeaseGeneration = number;
```

Identifiers must be opaque and unpredictable.

Clients must not infer authorization, ordering, ownership, or resource location from identifier structure.

---

## 6. Common WebSocket envelope

```ts
interface ProtocolEnvelope<T> {
  version: 1;
  type: string;
  sessionId?: TerminalSessionId;
  requestId?: RequestId;
  sequence?: TerminalSequence;
  payload: T;
}
```

### 6.1 Envelope rules

- `version` is required and must equal `1`.
- `type` is required and must match a known schema.
- `sessionId` is required for terminal-scoped messages unless the message schema says otherwise.
- `requestId` is required for request/response-correlated client messages.
- `sequence` is server-assigned for PTY output and selected ordered events.
- `payload` is always present and may be `{}` only where explicitly allowed.

### 6.2 Rejection conditions

Reject a message when:

- version is unknown
- type is unknown
- JSON is invalid
- schema is invalid
- message exceeds size limits
- required session ID is absent
- session ID is unauthorized
- lease is absent where required
- lease generation is stale
- lifecycle state does not permit the operation
- request ID is missing where required
- duplicate request ID violates idempotency policy

---

## 7. HTTPS response envelope

Successful response:

```ts
interface ApiSuccess<T> {
  ok: true;
  requestId: RequestId;
  data: T;
}
```

Error response:

```ts
interface ApiFailure {
  ok: false;
  requestId: RequestId;
  error: ProtocolError;
}
```

### 7.1 Request ID

The gateway returns a request ID for every control-plane request.

Clients may provide:

```text
X-Request-ID
```

The gateway may replace invalid values.

Request IDs must not contain secrets.

---

## 8. Error model

```ts
interface ProtocolError {
  code: ErrorCode;
  message: string;
  impact: string;
  executed: "yes" | "no" | "unknown";
  retryable: boolean;
  safeNextAction?: string;
  details?: Record<string, unknown>;
}
```

### 8.1 Error requirements

Every user-visible error must communicate:

1. what failed
2. current impact
3. whether anything executed
4. safest next action

### 8.2 Error-code taxonomy

#### Authentication

```text
AUTH_REQUIRED
AUTH_EXPIRED
AUTH_REVOKED
PAIRING_REQUIRED
PAIRING_CODE_INVALID
PAIRING_CODE_EXPIRED
PAIRING_RATE_LIMITED
ORIGIN_REJECTED
CSRF_REJECTED
```

#### Authorization

```text
SESSION_FORBIDDEN
TERMINAL_FORBIDDEN
WORKSPACE_FORBIDDEN
LEASE_REQUIRED
LEASE_FORBIDDEN
LEASE_STALE
LEASE_TRANSFER_REQUIRED
```

#### Validation

```text
INVALID_REQUEST
INVALID_MESSAGE
UNKNOWN_PROTOCOL_VERSION
UNKNOWN_MESSAGE_TYPE
MESSAGE_TOO_LARGE
INVALID_TERMINAL_SIZE
INVALID_SEQUENCE
INVALID_WORKSPACE
INVALID_LAUNCHER
```

#### Lifecycle

```text
TERMINAL_NOT_FOUND
TERMINAL_NOT_RUNNING
TERMINAL_CREATING
TERMINAL_TERMINATING
TERMINAL_TERMINATED
TERMINAL_EXPIRED
TERMINAL_FAILED
RECONNECT_EXPIRED
```

#### Resource limits

```text
TERMINAL_DEVICE_LIMIT
TERMINAL_GLOBAL_LIMIT
INPUT_RATE_LIMIT
RESIZE_RATE_LIMIT
OUTPUT_LIMIT
REPLAY_GAP
SPAWN_TIMEOUT
RESOURCE_EXHAUSTED
```

#### Internal

```text
PTY_SPAWN_FAILED
PTY_IO_FAILED
PROCESS_CLEANUP_FAILED
GATEWAY_UNAVAILABLE
INTERNAL_ERROR
```

### 8.3 Error-detail restrictions

`details` must not contain:

- pairing code
- cookie
- session secret
- provider key
- SSH key
- raw environment variables
- raw terminal output by default
- unredacted canonical host paths by default

---

## 9. Authentication and session requirements

### 9.1 Authentication mechanism

Phase 1 uses a paired-device session represented by a secure HTTP-only cookie.

Required cookie properties:

- `Secure`
- `HttpOnly`
- `SameSite=Strict` where compatible
- no JavaScript access
- no URL token
- expiry enforced server-side
- rotation after pairing
- invalidation on logout or revocation

### 9.2 WebSocket authentication

Authentication occurs during WebSocket upgrade.

The gateway must validate:

- authenticated device session
- origin
- host
- session validity
- expiry
- revocation

The gateway must not accept authentication only after an unauthenticated WebSocket is established.

---

## 10. Pairing API

### 10.1 Inspect pairing prerequisites

```http
GET /api/v1/pairing/status
```

Response:

```ts
interface PairingStatus {
  privateConnection: "verified" | "unverified";
  hostIdentity: string;
  gatewayAvailable: boolean;
  pairingAvailable: boolean;
  codeRequired: boolean;
}
```

### 10.2 Submit pairing code

```http
POST /api/v1/pairing/complete
```

Request:

```ts
interface PairingCompleteRequest {
  code: string;
  deviceLabel: string;
}
```

Response:

```ts
interface PairingCompleteResponse {
  deviceId: DeviceId;
  deviceLabel: string;
  sessionIssuedAt: Rfc3339Timestamp;
  sessionExpiresAt: Rfc3339Timestamp;
}
```

Rules:

- code is one-time
- code is short-lived
- code is never logged
- code is never returned
- code is never persisted in browser storage
- attempt limits apply
- successful pairing rotates authentication state

### 10.3 Authentication state

```http
GET /api/v1/auth/session
```

Response:

```ts
interface AuthSessionState {
  authenticated: boolean;
  deviceId?: DeviceId;
  deviceLabel?: string;
  issuedAt?: Rfc3339Timestamp;
  expiresAt?: Rfc3339Timestamp;
  idleExpiresAt?: Rfc3339Timestamp;
}
```

### 10.4 Logout

```http
POST /api/v1/auth/logout
```

Effects:

- invalidate current device session
- revoke session cookie
- close current WebSocket
- do not silently terminate unrelated terminal sessions unless policy requires it
- client clears non-sensitive authenticated view state

---

## 11. Workspace API

### 11.1 List workspaces

```http
GET /api/v1/workspaces
```

Response:

```ts
interface WorkspaceSummary {
  id: WorkspaceId;
  displayName: string;
  enabled: boolean;
  allowedLaunchers: LauncherId[];
}
```

The gateway must not expose canonical host paths by default.

### 11.2 Workspace authorization

Every workspace-specific request must:

- authenticate device session
- resolve workspace ID server-side
- verify workspace enabled
- verify requested launcher allowed
- use canonical server-side root
- reject browser-supplied absolute path

---

## 12. Launcher types

```ts
type LauncherId =
  | "default-shell"
  | "pi"
  | "opencode"
  | "tmux-create"
  | "tmux-attach";
```

Phase 1 requires only:

```text
default-shell
```

Other launchers remain disabled until explicitly implemented and reviewed.

Clients must not submit arbitrary executable paths.

---

## 13. Terminal control API

## 13.1 List terminals

```http
GET /api/v1/terminals
```

Response:

```ts
interface TerminalSummary {
  sessionId: TerminalSessionId;
  workspaceId: WorkspaceId;
  launcherId: LauncherId;
  state: TerminalState;
  createdAt: Rfc3339Timestamp;
  lastActivityAt: Rfc3339Timestamp;
  reconnectDeadline?: Rfc3339Timestamp;
  lease: LeaseSummary;
}
```

Only authorized terminal sessions are returned.

---

## 13.2 Create terminal

```http
POST /api/v1/terminals
```

Request:

```ts
interface CreateTerminalRequest {
  workspaceId: WorkspaceId;
  launcherId: LauncherId;
  cols: number;
  rows: number;
  clientRequestId: RequestId;
}
```

Response:

```ts
interface CreateTerminalResponse {
  session: TerminalSummary;
  websocketPath: "/api/v1/ws";
}
```

Rules:

- `clientRequestId` is required
- request is idempotent within a bounded server window
- terminal creation limits apply
- workspace and launcher are server-authorized
- terminal size is validated
- browser does not provide executable path
- browser does not provide working directory
- server creates the PTY only after authorization passes

### Executed semantics

- authorization failure: `executed = "no"`
- spawn attempt started but result unknown: `executed = "unknown"`
- PTY successfully created: success response

---

## 13.3 Read terminal details

```http
GET /api/v1/terminals/{sessionId}
```

Response:

```ts
interface TerminalDetails extends TerminalSummary {
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
```

---

## 13.4 Terminate terminal

```http
POST /api/v1/terminals/{sessionId}/terminate
```

Request:

```ts
interface TerminateTerminalRequest {
  mode: "graceful" | "force";
  reason?: string;
  clientRequestId: RequestId;
}
```

Response:

```ts
interface TerminateTerminalResponse {
  accepted: true;
  state: "TERMINATING" | "TERMINATED";
}
```

Rules:

- authorization required
- destructive confirmation occurs in UI
- repeated identical request is idempotent
- terminal stops accepting input once termination begins
- force termination remains explicit
- result must not claim cleanup success before process-tree cleanup completes

---

## 14. Controller lease API

## 14.1 Lease type

```ts
interface ControllerLease {
  leaseId: LeaseId;
  sessionId: TerminalSessionId;
  deviceId: DeviceId;
  generation: LeaseGeneration;
  issuedAt: Rfc3339Timestamp;
  expiresAt: Rfc3339Timestamp;
}
```

```ts
interface LeaseSummary {
  state: "none" | "owned" | "owned-by-other-device";
  generation?: LeaseGeneration;
  expiresAt?: Rfc3339Timestamp;
}
```

---

## 14.2 Acquire lease

```http
POST /api/v1/terminals/{sessionId}/lease/acquire
```

Request:

```ts
interface AcquireLeaseRequest {
  clientRequestId: RequestId;
}
```

Response:

```ts
interface AcquireLeaseResponse {
  lease: ControllerLease;
}
```

Rules:

- acquire succeeds only when policy permits
- no silent takeover
- reconnect does not imply acquire
- lease ID is never placed in URL
- device and session binding is server-side

---

## 14.3 Transfer lease

```http
POST /api/v1/terminals/{sessionId}/lease/transfer
```

Request:

```ts
interface TransferLeaseRequest {
  expectedGeneration: LeaseGeneration;
  targetDeviceId: DeviceId;
  clientRequestId: RequestId;
}
```

Response:

```ts
interface TransferLeaseResponse {
  lease: ControllerLease;
  revokedDeviceId?: DeviceId;
}
```

Rules:

- transfer is atomic
- current authorization required
- generation must match
- gateway increments generation
- previous controller receives revocation event
- transfer does not duplicate writable ownership

---

## 14.4 Release lease

```http
POST /api/v1/terminals/{sessionId}/lease/release
```

Request:

```ts
interface ReleaseLeaseRequest {
  expectedGeneration: LeaseGeneration;
  clientRequestId: RequestId;
}
```

Response:

```ts
interface ReleaseLeaseResponse {
  released: true;
  generation: LeaseGeneration;
}
```

---

## 15. WebSocket connection flow

1. Client confirms authenticated HTTPS session.
2. Client opens WSS connection to `/api/v1/ws`.
3. Gateway validates host, origin, cookie, session, expiry, and revocation.
4. Gateway sends `connection.ready`.
5. Client sends `client.hello`.
6. Gateway validates client protocol capabilities.
7. Client may attach to authorized terminal sessions.
8. Gateway sends authoritative state and replay availability.
9. Input remains rejected until a valid lease is active.

---

## 16. Connection messages

### 16.1 `connection.ready`

Server to client:

```ts
interface ConnectionReadyPayload {
  connectionId: string;
  serverTime: Rfc3339Timestamp;
  protocolVersion: 1;
  heartbeatIntervalMs: number;
  maxMessageBytes: number;
}
```

Envelope:

```json
{
  "version": 1,
  "type": "connection.ready",
  "payload": {
    "connectionId": "opaque",
    "serverTime": "2026-07-24T23:00:00Z",
    "protocolVersion": 1,
    "heartbeatIntervalMs": 15000,
    "maxMessageBytes": 65536
  }
}
```

---

### 16.2 `client.hello`

Client to server:

```ts
interface ClientHelloPayload {
  clientName: "pi-pocket-console-web";
  clientVersion: string;
  supportedProtocolVersions: [1];
  platform: "ios-pwa" | "tablet-web" | "desktop-web";
}
```

---

### 16.3 `connection.error`

Server to client:

```ts
interface ConnectionErrorPayload {
  error: ProtocolError;
  closeAfter: boolean;
}
```

---

## 17. Terminal attachment

### 17.1 `terminal.attach`

Client to server:

```ts
interface TerminalAttachPayload {
  lastReceivedSequence?: TerminalSequence;
}
```

Requirements:

- `sessionId` required
- `requestId` required
- authorization required
- attach does not acquire lease
- `lastReceivedSequence` may be omitted for first attach

---

### 17.2 `terminal.attached`

Server to client:

```ts
interface TerminalAttachedPayload {
  state: TerminalState;
  replay: {
    available: boolean;
    earliestSequence?: TerminalSequence;
    latestSequence?: TerminalSequence;
    gap: boolean;
  };
  lease: LeaseSummary;
}
```

---

### 17.3 `terminal.detach`

Client to server:

```ts
interface TerminalDetachPayload {
  reason: "navigation" | "background" | "manual" | "shutdown";
}
```

Detaching the client does not necessarily terminate the PTY.

---

## 18. Terminal input

### 18.1 `terminal.input`

Client to server:

```ts
interface TerminalInputPayload {
  leaseId: LeaseId;
  leaseGeneration: LeaseGeneration;
  data: string;
}
```

Requirements:

- `sessionId` required
- `requestId` required
- active lease required
- UTF-8 data
- maximum message size enforced
- lifecycle state must permit input
- no automatic retry after transport uncertainty

### 18.2 Input acknowledgement

Server to client:

```ts
interface TerminalInputAcceptedPayload {
  accepted: true;
}
```

Message type:

```text
terminal.input.accepted
```

If acknowledgement is not received before disconnect, the client must treat execution state as `unknown`, not resend automatically.

### 18.3 Input rejection

Message type:

```text
terminal.input.rejected
```

Payload:

```ts
interface TerminalInputRejectedPayload {
  error: ProtocolError;
}
```

---

## 19. Terminal output

### 19.1 `terminal.output`

Server to client:

```ts
interface TerminalOutputPayload {
  data: string;
}
```

Envelope requirements:

- `sessionId` required
- `sequence` required
- sequence strictly increases per terminal session
- data is UTF-8 terminal output
- output is replayable only within buffer limits

Example:

```json
{
  "version": 1,
  "type": "terminal.output",
  "sessionId": "term_opaque",
  "sequence": 1042,
  "payload": {
    "data": "calvin@CALVINPC:~/Generation-Ark$ "
  }
}
```

### 19.2 Sequence rules

- sequence starts at a server-selected non-negative value
- sequence order is per terminal session
- clients must process in order
- duplicate sequence values are ignored after first accepted delivery
- gaps trigger replay or explicit gap handling
- client must not invent sequence values

---

## 20. Replay protocol

### 20.1 Replay request

Use `terminal.attach` with `lastReceivedSequence`.

The gateway calculates:

- no replay needed
- replay available
- replay gap

### 20.2 `terminal.replay.begin`

Server to client:

```ts
interface TerminalReplayBeginPayload {
  fromSequence: TerminalSequence;
  toSequence: TerminalSequence;
}
```

### 20.3 Replay output

Replay uses ordinary `terminal.output` messages with original sequence values.

### 20.4 `terminal.replay.end`

Server to client:

```ts
interface TerminalReplayEndPayload {
  lastSequence: TerminalSequence;
}
```

### 20.5 Replay acknowledgement

Client to server:

```ts
interface TerminalReplayAckPayload {
  lastReceivedSequence: TerminalSequence;
}
```

Message type:

```text
terminal.replay.ack
```

Rules:

- acknowledgement cannot exceed latest server sequence
- malformed or impossible acknowledgement is rejected
- acknowledgement does not grant authorization
- acknowledgement does not modify lease ownership

### 20.6 Replay gap

Server to client:

```ts
interface TerminalReplayGapPayload {
  requestedAfter: TerminalSequence;
  earliestAvailable: TerminalSequence;
  latestAvailable: TerminalSequence;
  lostOutput: true;
  safeNextAction: string;
}
```

Message type:

```text
terminal.replay.gap
```

A replay gap must never be concealed.

---

## 21. Resize protocol

### 21.1 `terminal.resize`

Client to server:

```ts
interface TerminalResizePayload {
  leaseId: LeaseId;
  leaseGeneration: LeaseGeneration;
  cols: number;
  rows: number;
}
```

Requirements:

- active lease required
- valid lifecycle state
- positive bounded integers
- rate limit applies
- client should coalesce viewport bursts
- gateway remains authoritative

### 21.2 `terminal.resize.accepted`

Server to client:

```ts
interface TerminalResizeAcceptedPayload {
  cols: number;
  rows: number;
}
```

### 21.3 Invalid resize

Use `INVALID_TERMINAL_SIZE` or `RESIZE_RATE_LIMIT`.

---

## 22. Heartbeat protocol

### 22.1 `connection.ping`

Server to client:

```ts
interface ConnectionPingPayload {
  sentAt: Rfc3339Timestamp;
}
```

### 22.2 `connection.pong`

Client to server:

```ts
interface ConnectionPongPayload {
  sentAt: Rfc3339Timestamp;
  receivedAt: Rfc3339Timestamp;
}
```

Heartbeat confirms transport liveness only.

It does not:

- extend terminal absolute duration
- transfer lease
- prove PTY responsiveness
- authorize input

---

## 23. Lease events

### 23.1 `lease.granted`

Server to client:

```ts
interface LeaseGrantedPayload {
  lease: ControllerLease;
}
```

### 23.2 `lease.revoked`

Server to client:

```ts
interface LeaseRevokedPayload {
  previousGeneration: LeaseGeneration;
  newGeneration: LeaseGeneration;
  reason:
    | "transfer"
    | "release"
    | "expiry"
    | "session-termination"
    | "administrative-revocation";
}
```

### 23.3 `lease.expiring`

Server to client:

```ts
interface LeaseExpiringPayload {
  generation: LeaseGeneration;
  expiresAt: Rfc3339Timestamp;
}
```

### 23.4 `lease.changed`

Server to the currently attached authorized client:

```ts
interface LeaseChangedPayload {
  state: LeaseSummary;
}
```

No event reveals unnecessary device-secret information.

---

## 24. Terminal lifecycle states

```ts
type TerminalState =
  | "CREATING"
  | "RUNNING"
  | "DETACHED"
  | "RECONNECTING"
  | "TERMINATING"
  | "TERMINATED"
  | "EXPIRED"
  | "FAILED";
```

The gateway is authoritative.

Clients must not infer lifecycle solely from WebSocket state.

---

## 25. Lifecycle events

### 25.1 `terminal.state`

Server to client:

```ts
interface TerminalStatePayload {
  previousState?: TerminalState;
  state: TerminalState;
  changedAt: Rfc3339Timestamp;
  reasonCode?: string;
  reconnectDeadline?: Rfc3339Timestamp;
}
```

### 25.2 `terminal.process.exit`

Server to client:

```ts
interface TerminalProcessExitPayload {
  exitCode?: number;
  signal?: string;
  expected: boolean;
}
```

Do not expose platform-sensitive internals beyond the approved diagnostics policy.

### 25.3 `terminal.warning`

Server to client:

```ts
interface TerminalWarningPayload {
  code:
    | "OUTPUT_DROPPED"
    | "REPLAY_NEAR_LIMIT"
    | "IDLE_EXPIRY_NEAR"
    | "ABSOLUTE_EXPIRY_NEAR"
    | "LEASE_EXPIRY_NEAR";
  message: string;
  safeNextAction?: string;
}
```

### 25.4 `terminal.failure`

Server to client:

```ts
interface TerminalFailurePayload {
  error: ProtocolError;
}
```

---

## 26. Reconnect behavior

### 26.1 Transport loss

On WebSocket loss:

- client pauses terminal input
- client does not queue input for automatic execution
- PTY remains alive according to policy
- gateway may transition visible state to `DETACHED`
- active lease remains subject to lease policy
- reconnect deadline starts or continues

### 26.2 Reconnect flow

1. Re-authenticate WebSocket.
2. Send `client.hello`.
3. Send `terminal.attach` with last received sequence.
4. Receive authoritative state.
5. Receive replay or replay-gap event.
6. Receive current lease summary.
7. Resume input only when current lease is valid.

### 26.3 Reconnect expiry

When deadline expires:

- gateway emits `terminal.state` with `EXPIRED`
- input is rejected
- cleanup follows lifecycle policy
- client must not present reconnect as available
- safe next action is shown

---

## 27. Idempotency rules

Idempotent control operations require `clientRequestId`.

Applicable operations:

- terminal creation
- graceful termination
- force termination
- lease acquisition
- lease transfer
- lease release

Gateway behavior:

- same authenticated device
- same operation
- same request ID
- within bounded idempotency window

Return the original result where safe.

A request ID reused for a different operation is rejected.

Terminal input is not idempotently retried.

---

## 28. Ordering rules

### 28.1 Per-terminal output

`terminal.output` is strictly ordered by `sequence`.

### 28.2 Lifecycle ordering

Lifecycle events are ordered by gateway transition time.

### 28.3 Lease ordering

Lease generation strictly increases on ownership-changing events.

### 28.4 Cross-stream ordering

No total ordering is guaranteed across:

- HTTPS responses
- WebSocket output
- lifecycle events
- lease events

Clients must reconcile using:

- terminal state
- lease generation
- output sequence
- request ID

---

## 29. Size and rate limits

Initial provisional limits:

| Resource | Limit |
|---|---:|
| Maximum WebSocket message | `64 KiB` |
| Maximum terminal input payload | `64 KiB` |
| Resize rate | `10 events/second` |
| Replay buffer | `2 MiB per terminal` |
| Active terminals per device | `3` |
| Global active terminals | `10` |
| Reconnect deadline | `60 seconds` |
| Pairing attempts | `5 per 10 minutes` |
| Graceful termination window | `5 seconds` |
| Absolute session duration | `12 hours` |
| Idle session timeout | `60 minutes` |

All values require load and physical validation.

The gateway may advertise stricter values.

Clients must not assume provisional values are permanent.

---

## 30. Terminal dimensions

Initial validation policy:

```ts
interface TerminalSizeLimits {
  minCols: number;
  maxCols: number;
  minRows: number;
  maxRows: number;
}
```

Exact values remain implementation-defined.

Requirements:

- positive integers
- bounded values
- reject zero
- reject negative
- reject fractional
- reject extreme dimensions
- coalesce repeated resize requests
- do not resize before iOS viewport stabilization

---

## 31. Structured Pi RPC compatibility

The existing structured Pi RPC remains separate from PTY transport.

Requirements:

- preserve existing request and approval semantics
- do not treat raw terminal text as structured result
- do not infer approval from terminal output
- keep operation IDs distinct
- preserve existing regression tests
- share authentication, workspace policy, diagnostics, and audit policy where appropriate

The exact structured RPC schema is not redefined by this document unless a later versioned adapter requires it.

---

## 32. Diagnostics API

```http
GET /api/v1/diagnostics
```

Response:

```ts
interface DiagnosticsSummary {
  gateway: {
    status: "healthy" | "degraded" | "unavailable";
    boundAddress: "127.0.0.1";
  };
  tailscale: {
    serveConfigured: boolean;
    funnelEnabled: false;
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
```

Diagnostics must not expose secrets.

### 32.1 Diagnostic event

```ts
interface DiagnosticEventSummary {
  eventId: AuditEventId;
  timestamp: Rfc3339Timestamp;
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  safeNextAction?: string;
}
```

---

## 33. Close codes

Suggested WebSocket close codes:

| Code | Meaning |
|---:|---|
| `1000` | Normal closure |
| `1001` | Client navigating or shutting down |
| `1008` | Policy violation |
| `1009` | Message too large |
| `1011` | Internal gateway error |
| `4001` | Authentication required |
| `4002` | Authentication expired |
| `4003` | Origin rejected |
| `4004` | Protocol version rejected |
| `4005` | Session revoked |
| `4006` | Rate limited |

Custom codes remain within the application-defined range.

The close reason must be brief and must not contain secrets.

---

## 34. Compatibility and versioning

### 34.1 Version negotiation

Client sends supported versions in `client.hello`.

Gateway selects only version `1` in v0.2.

If no common version exists:

- send `connection.error`
- use `UNKNOWN_PROTOCOL_VERSION`
- close connection

### 34.2 Backward compatibility

Within protocol version `1`:

- adding optional response fields is permitted only when clients are required to ignore unknown non-security fields
- adding a new message type requires client compatibility handling
- changing field meaning is prohibited
- weakening validation is prohibited
- changing authorization requirements is prohibited without explicit protocol revision

### 34.3 Protocol revision triggers

Create a new protocol version when:

- field meaning changes
- sequence semantics change
- lease semantics change
- authentication model changes
- binary framing is introduced incompatibly
- lifecycle semantics change incompatibly

---

## 35. Logging and redaction rules

May log:

- request ID
- event type
- terminal session ID
- workspace ID
- launcher ID
- state transition
- lease generation
- byte counts
- rate-limit outcome
- redacted error code

Must not log:

- pairing code
- cookie
- session secret
- provider key
- SSH key
- shell credential
- raw environment variable
- raw terminal input by default
- raw terminal output by default
- sensitive canonical path by default

Control characters must be normalized in logs.

---

## 36. Client state machine requirements

Client must distinguish:

- transport connected
- authenticated
- terminal attached
- replaying
- lease owned
- input enabled
- lifecycle running
- offline
- reconnecting
- expired
- terminated
- failed

Input is enabled only when all are true:

1. transport connected
2. authenticated
3. terminal attached
4. terminal state permits input
5. active lease belongs to current device
6. lease generation is current
7. replay synchronization is complete
8. client is not offline

---

## 37. Security invariants

1. Tailnet access alone does not authorize the application.
2. Paired-device authentication alone does not authorize every terminal.
3. Terminal authorization alone does not grant writable control.
4. Writable control requires current lease.
5. Lease does not permit workspace escape.
6. Browser cannot select arbitrary executable.
7. Browser cannot select arbitrary working directory.
8. Output replay is bounded.
9. Replay sequence is server-authoritative.
10. Offline input is not silently queued.
11. Reconnect does not silently transfer control.
12. Termination is explicit and auditable.
13. Secrets do not enter browser persistence.
14. Secrets do not enter logs or diagnostics.
15. Existing structured Pi approval behavior remains intact.

---

## 38. Protocol test matrix

### Envelope

- valid version accepted
- unknown version rejected
- unknown type rejected
- missing payload rejected
- oversized message rejected
- invalid JSON rejected
- unknown security-critical field rejected

### Authentication

- unauthenticated HTTPS rejected
- unauthenticated WebSocket rejected
- expired cookie rejected
- revoked cookie rejected
- cross-origin upgrade rejected
- pairing rate limit enforced

### Terminal creation

- allowed workspace accepted
- disabled workspace rejected
- arbitrary launcher rejected
- arbitrary path rejected
- device limit enforced
- global limit enforced
- duplicate idempotent request returns original result

### Lease

- acquire succeeds when available
- stale generation rejected
- transfer atomic
- previous controller revoked
- reconnect does not steal
- concurrent input prevented

### Input

- active lease accepted
- no lease rejected
- stale lease rejected
- oversized input rejected
- uncertain input not automatically retried
- input rejected during termination

### Resize

- valid resize accepted
- invalid dimensions rejected
- no lease rejected
- rate limit enforced
- burst coalescing validated

### Replay

- no-gap replay
- replay with duplicate output ignored
- gap explicitly reported
- impossible acknowledgement rejected
- unauthorized replay rejected
- replay after expiry rejected

### Lifecycle

- creating to running
- running to detached
- detached to reconnecting
- reconnecting to running
- reconnect expiry
- graceful termination
- forced termination
- PTY failure
- gateway shutdown cleanup

### Redaction

- fake cookie absent
- fake pairing code absent
- fake provider key absent
- terminal output absent by default
- environment variables absent
- control-character log injection normalized

---

## 39. Phase 1 protocol acceptance gates

Do not claim the protocol complete unless:

1. All HTTPS operations require valid authentication where applicable.
2. WebSocket authentication occurs during upgrade.
3. Origin and host validation pass.
4. Unknown protocol versions are rejected.
5. Unknown message types are rejected.
6. Malformed messages are rejected.
7. Oversized messages are rejected.
8. Session authorization is checked per operation.
9. Input requires current lease.
10. Resize requires current lease.
11. Stale lease generations are rejected.
12. Lease transfer is atomic.
13. Server output sequence is monotonic per terminal.
14. Replay duplicates are handled safely.
15. Replay gaps are explicit.
16. Input is never silently retried.
17. Reconnect does not silently steal control.
18. Lifecycle events match the authoritative state machine.
19. Termination operations are idempotent.
20. Process cleanup outcome is not overstated.
21. Resource limits are enforced.
22. Browser clients cannot choose arbitrary executables.
23. Browser clients cannot choose arbitrary working directories.
24. Diagnostics remain redacted.
25. Existing structured Pi RPC behavior still passes.
26. Physical iPhone reconnect and resize flows pass.
27. Offline UI does not imply command execution.
28. Emergency termination remains reachable.

---

## 40. Open protocol decisions

The following remain unresolved and require explicit review:

- exact pairing code format and entropy
- exact pairing expiry
- exact cookie lifetime
- exact CSRF mechanism
- exact lease duration
- heartbeat interval
- heartbeat timeout
- idempotency retention window
- maximum terminal dimensions
- exact replay eviction response
- whether output frames remain JSON or later use binary framing
- exact terminal-title and clipboard escape handling
- exact diagnostics retention
- exact event severity taxonomy
- exact structured Pi RPC adapter changes, if any
- exact close-code mapping
- gateway restart restoration protocol

These must not be silently decided during implementation.

---

## 41. Recommended next artifact

The next Phase 0 artifact should be:

```text
docs/PTY-LIFECYCLE.md
```

It should define:

- state invariants
- transition authorization
- lease requirements
- process behavior
- replay behavior
- cleanup deadlines
- graceful and forced termination
- disconnect behavior
- reconnect behavior
- expiry
- failures
- gateway shutdown
- idempotency
- audit events
- client-visible states

Do not begin full terminal implementation until architecture, threat model, protocol, PTY lifecycle, visual system, and iPhone acceptance documents are reviewed together.

---

## Phase 0 consistency reconciliation — authoritative protocol rules

**Reconciled:** 2026-07-24
**Precedence:** This section supersedes any conflicting earlier protocol limits or semantics.

### Limits

- Maximum complete WebSocket UTF-8 JSON text frame: **64 KiB**.
- Maximum decoded `terminal.input.data`: **48 KiB**.
- A frame exceeding 64 KiB is rejected before message dispatch.
- Input whose decoded `data` exceeds 48 KiB is rejected with the canonical payload-too-large error and `executed = "no"`.

### Transport and attachment

- One authenticated application WebSocket transport may carry application traffic.
- A terminal attachment is a separate, explicit subscription established by `terminal.attach` and removed by `terminal.detach` or transport loss.
- Phase 1 permits **one authorized attached browser client per terminal**.
- `lease.changed` is delivered only to the currently attached authorized client. No Phase 1 delivery to non-controller observers exists.
- Multi-viewer and read-only observer semantics are deferred.

### Authentication expiry and lease invalidation

When the owning device session expires or is revoked, the gateway immediately makes its controller lease unusable, invalidates or increments the lease generation, rejects further input and resize, and emits the authenticated client-visible expiry state when possible. The PTY may continue only under terminal lifecycle policy. Reauthentication does not restore the old lease; the client must explicitly reacquire writable control.

### Idle activity

Idle timeout resets only after accepted user input or an explicit authorized keep-alive/session action. PTY output, heartbeat, replay delivery, and resize alone do not reset it. Absolute expiry is unaffected by all activity.

### Pairing status privacy

`GET /api/v1/pairing/status` is rate-limited and returns only a generic private-connection status, a user-safe host display label, and pairing availability. It must not return canonical hostnames, operating-system account names, filesystem paths, detailed build/version data, or diagnostics.

### Streaming PTY output

PTY byte streams are decoded with a stateful streaming UTF-8 decoder. Incomplete multibyte sequences are buffered between OS reads. Malformed sequences produce U+FFFD replacement characters. JSON escaping is applied after decoding. Output sequence numbers are assigned to emitted protocol chunks after decoding and chunking, not to raw OS read boundaries. Tests must cover split UTF-8, NUL, ESC, malformed sequences, and sustained output. Raw byte and binary WebSocket framing are deferred.

### Failure publication

On unrecoverable error, the gateway atomically disables input and revokes the lease, performs best-effort cleanup in an internal non-public cleanup substate, and publishes public `FAILED` only after the cleanup attempt completes. The failure payload includes `cleanupResult` and `processMayStillBeActive`. Public `FAILED` has no outgoing lifecycle transition.

### Owned process identity

Forced cleanup uses an internal terminal-bound identity equivalent to:

```ts
interface OwnedProcessIdentity {
  pid: number;
  processGroupId?: number;
  startedAt: Rfc3339Timestamp;
  platformHandle?: string;
}
```

`platformHandle` is never sent to clients. Cleanup requires session binding and start-time/platform-handle validation sufficient to prevent PID-reuse targeting.
