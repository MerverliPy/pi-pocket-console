# Pi Pocket Console v0.2 Architecture

**Status:** Phase 0 planning baseline
**Product:** Pi Pocket Console v0.2
**Architecture:** Hybrid iPhone-first terminal PWA
**Implementation branch:** `agent/v0.2-hybrid-terminal-pwa`
**Published baseline:** `0.1.0` at commit `e083ad04885620478009b7967d25744e134999c1`

---

## 1. Purpose

This document defines the canonical system architecture for Pi Pocket Console v0.2.

The release preserves the verified `0.1.0` structured Pi controller and adds a first-class real PTY terminal. The terminal does not replace the structured controller. Both surfaces remain first-class and coordinated through one private gateway.

The architecture must remain:

- iPhone-first
- Tailscale-only
- loopback-bound
- authenticated
- lease-controlled
- replay-bounded
- recovery-aware
- explicit about offline behavior
- compatible with the existing structured Pi controller

---

## 2. Immutable baseline

The published `0.1.0` baseline is immutable unless the user explicitly authorizes a release rewrite.

Verified baseline:

```text
Repository: MerverliPy/pi-pocket-console
Default branch: main
Published release: 0.1.0
Commit: e083ad04885620478009b7967d25744e134999c1
Tree: a10fccea110366f6d8d5e31100544ad989b4fc74
```

v0.2 work occurs on:

```text
agent/v0.2-hybrid-terminal-pwa
```

Prohibited baseline actions:

- force-push
- retag
- delete the published release
- rewrite published history
- silently replace the structured controller
- modify `main` without explicit authorization

---

## 3. Product architecture

Pi Pocket Console v0.2 contains two coordinated first-class surfaces:

```text
Pi Pocket Console
├─ Terminal
│  ├─ Real PTY sessions
│  ├─ bash / zsh
│  ├─ tmux
│  ├─ Pi
│  ├─ OpenCode
│  ├─ vim / nvim
│  └─ compatible terminal TUIs
│
└─ Structured Console
   ├─ Chat and prompts
   ├─ Agent management
   ├─ Provider/model status
   ├─ Approvals
   ├─ Workspaces
   ├─ Files
   ├─ Diagnostics
   └─ Session controls
```

The Structured Console remains the semantic-control baseline. The Terminal adds unrestricted terminal interaction only within the gateway’s configured launcher, workspace, authentication, lease, and resource policies.

---

## 4. Canonical deployment topology

```text
┌─────────────────────────────────────────────┐
│ iPhone 16 Pro PWA                           │
│                                             │
│ Application shell                           │
│ ├─ Structured Console                       │
│ ├─ Terminal                                 │
│ ├─ Sessions                                 │
│ ├─ Files                                    │
│ ├─ Diagnostics                              │
│ ├─ Settings                                 │
│ ├─ Offline-safe preferences and drafts      │
│ └─ iOS viewport / keyboard controllers      │
│                                             │
│ xterm.js terminal viewport                  │
└──────────────────────┬──────────────────────┘
                       │ HTTPS + WSS
┌──────────────────────▼──────────────────────┐
│ Tailscale Serve                             │
│ Tailnet-only private routing boundary       │
│ Funnel disabled                             │
└──────────────────────┬──────────────────────┘
                       │ loopback
┌──────────────────────▼──────────────────────┐
│ Pi Pocket Console Gateway                   │
│                                             │
│ ├─ HTTP control API                         │
│ ├─ Authenticated WebSocket endpoint         │
│ ├─ Device pairing and sessions              │
│ ├─ Controller lease service                 │
│ ├─ Terminal lifecycle service               │
│ ├─ Replay and reconnect service             │
│ ├─ Workspace policy                         │
│ ├─ Structured Pi RPC bridge                 │
│ ├─ Limits and backpressure                  │
│ └─ Redacted audit events                    │
└───────────────┬───────────────────┬─────────┘
                │                   │
        ┌───────▼────────┐  ┌──────▼──────────┐
        │ Real PTY       │  │ Structured RPC  │
        │ node-pty       │  │ Existing Pi     │
        └───────┬────────┘  └─────────────────┘
                │
        bash / zsh / tmux /
        Pi / OpenCode / vim /
        compatible terminal TUIs
```

---

## 5. Trust boundaries

### 5.1 Boundary A — Public network to tailnet

The application must not be publicly routable.

Required:

- Tailscale Serve
- tailnet-only access
- Funnel disabled
- no router port forwarding
- no public listener
- no public exposure of port `31415`

### 5.2 Boundary B — Tailscale Serve to gateway

The gateway binds only to:

```text
127.0.0.1
```

Tailscale membership is necessary but not sufficient for application authorization.

### 5.3 Boundary C — Browser to application session

The browser must hold an authenticated paired-device session.

Required:

- one-time short-lived pairing code
- secure HTTP-only cookie
- same-site policy
- strict origin validation
- idle expiry
- absolute expiry
- pairing and authentication rate limits

### 5.4 Boundary D — Application session to workspace

Every terminal and structured operation must target an authorized workspace.

Required:

- canonical workspace roots
- workspace allowlist
- server-side path validation
- no browser-supplied arbitrary working directory
- no path traversal outside allowed roots

### 5.5 Boundary E — Device session to terminal input

A valid paired-device session does not automatically grant writable terminal control.

Input and resize require an active controller lease.

---

## 6. Client architecture

Recommended client structure:

```text
apps/web/src/
├─ shell/
│  ├─ AppShell.ts
│  ├─ BottomNavigation.ts
│  └─ SheetHost.ts
├─ terminal/
│  ├─ TerminalView.ts
│  ├─ TerminalController.ts
│  ├─ TerminalHeader.ts
│  ├─ TerminalSurface.ts
│  ├─ TerminalShortcutBar.ts
│  └─ TerminalStatus.ts
├─ console/
│  ├─ StructuredConsoleView.ts
│  ├─ ConversationStream.ts
│  ├─ OperationsTimeline.ts
│  └─ PromptComposer.ts
├─ sessions/
├─ files/
├─ diagnostics/
├─ settings/
├─ recovery/
│  ├─ RecoveryScreen.ts
│  ├─ RecoverySummary.ts
│  ├─ RecoveryActions.ts
│  └─ DiagnosticDetails.ts
├─ transport/
│  ├─ ControlApi.ts
│  ├─ TerminalSocket.ts
│  └─ ReconnectPolicy.ts
├─ platform/ios/
│  ├─ viewport-controller.ts
│  ├─ keyboard-controller.ts
│  ├─ safe-area-controller.ts
│  ├─ orientation-controller.ts
│  ├─ lifecycle-controller.ts
│  └─ standalone-controller.ts
├─ design/
│  ├─ tokens.ts
│  ├─ typography.ts
│  ├─ motion.ts
│  └─ iconography.ts
└─ storage/
   ├─ preferences-store.ts
   └─ draft-store.ts
```

### 6.1 Client responsibilities

The client may:

- render the application shell
- manage navigation and sheets
- render xterm.js
- send validated terminal input
- request terminal resize
- preserve non-sensitive preferences
- preserve drafts
- display connection, lease, and lifecycle state
- request reconnect
- request explicit termination
- display redacted diagnostics

The client must not:

- choose arbitrary executable paths
- choose arbitrary host working directories
- hold provider keys
- hold pairing codes after pairing
- store JavaScript-readable session secrets
- simulate successful host execution while offline
- queue shell commands for silent execution after reconnect
- authorize its own workspace
- grant itself a controller lease

---

## 7. Gateway architecture

Recommended gateway structure:

```text
apps/gateway/src/
├─ server/
│  ├─ http-server.ts
│  └─ websocket-server.ts
├─ auth/
│  ├─ pairing-service.ts
│  ├─ device-session.ts
│  └─ tailscale-identity.ts
├─ terminal/
│  ├─ terminal-service.ts
│  ├─ terminal-session.ts
│  ├─ terminal-state-machine.ts
│  ├─ terminal-lease.ts
│  ├─ terminal-replay-buffer.ts
│  ├─ terminal-limits.ts
│  └─ pty-adapter.ts
├─ workspace/
│  ├─ workspace-policy.ts
│  └─ path-validator.ts
├─ protocol/
│  ├─ websocket-codec.ts
│  └─ message-validator.ts
├─ structured/
│  └─ pi-rpc-bridge.ts
├─ diagnostics/
│  └─ diagnostics-service.ts
└─ audit/
   └─ audit-service.ts
```

### 7.1 Gateway responsibilities

The gateway owns:

- network binding
- request authentication
- pairing
- device sessions
- terminal authorization
- terminal creation
- PTY process ownership
- lease enforcement
- terminal lifecycle state
- bounded replay
- reconnect deadlines
- workspace validation
- resource limits
- graceful and forced cleanup
- structured Pi RPC routing
- redacted audit events
- diagnostics

The gateway is authoritative for all terminal state.

---

## 8. Control plane and data plane

### 8.1 HTTPS control plane

Use HTTPS for:

- pairing
- authentication state
- device-session state
- workspace listing
- terminal listing
- terminal creation
- controller-lease acquisition
- controller-lease transfer
- termination
- diagnostics
- provider/model status
- structured configuration operations

### 8.2 Authenticated WebSocket data plane

Use WSS for:

- PTY input
- PTY output
- resize
- heartbeat
- replay acknowledgement
- controller-lease events
- lifecycle events
- reconnect synchronization

### 8.3 Separation rule

Terminal creation, lease transfer, and termination must not be represented as unstructured PTY input.

They are explicit control-plane operations.

---

## 9. Protocol envelope

All WebSocket messages use a versioned envelope:

```ts
interface ProtocolEnvelope<T> {
  version: 1;
  type: string;
  sessionId?: string;
  requestId?: string;
  sequence?: number;
  payload: T;
}
```

Reject:

- unknown protocol versions
- unknown message types
- invalid schema
- oversized messages
- unauthorized session IDs
- stale lease generations
- impossible lifecycle transitions
- replay acknowledgement beyond authoritative output

Protocol details belong in `docs/PROTOCOL.md`.

---

## 10. Terminal lifecycle model

Canonical states:

```text
CREATING
   │
   ▼
RUNNING ────────────────► TERMINATING ─► TERMINATED
   │
   ├─ WebSocket lost
   ▼
DETACHED
   │
   ├─ reconnect within deadline
   ▼
RECONNECTING ───────────► RUNNING
   │
   └─ deadline exceeded
      ▼
     EXPIRED ───────────► TERMINATED

Any active state may transition to FAILED
```

Every transition must define:

- authorized initiator
- required lease
- PTY process behavior
- replay behavior
- audit event
- client-visible status
- cleanup deadline
- recovery policy

Detailed transition rules belong in `docs/PTY-LIFECYCLE.md`.

---

## 11. Controller lease model

```ts
interface ControllerLease {
  leaseId: string;
  sessionId: string;
  deviceId: string;
  generation: number;
  issuedAt: string;
  expiresAt: string;
}
```

Rules:

- one writable controller by default
- input requires active lease
- resize requires active lease
- stale generations are rejected
- reconnect does not silently steal ownership
- lease transfer is explicit
- previous controller receives revocation
- concurrent writable controllers are prohibited in v0.2
- read-only viewers are deferred

The gateway increments lease generation on ownership change.

---

## 12. Reconnect and persistence

Reconnect is divided into separate levels.

### Level 1 — Transport recovery

- temporary WebSocket loss
- PTY remains alive
- initial reconnect window: 60 seconds
- bounded replay
- reconnect resumes only after authentication and authorization

### Level 2 — Detached session

- browser closes or remains disconnected
- gateway may keep session alive according to policy
- session is visibly detached
- no implicit lease transfer

### Level 3 — tmux persistence

- user explicitly creates or attaches to tmux
- shell continuity may outlive the browser
- gateway still enforces device and session authorization

### Level 4 — Gateway restart restoration

Deferred until Levels 1–3 are validated.

The browser must never claim that gateway restart restoration exists before it is implemented and tested.

---

## 13. Replay and backpressure

Server-side replay is authoritative.

```text
PTY output
   │
   ├─► Active WebSocket
   │
   └─► Bounded replay ring buffer
             ├─ sequence numbers
             ├─ byte ceiling
             ├─ replay cursor
             └─ session-lifetime retention
```

Initial provisional limits:

| Resource | Initial policy |
|---|---:|
| Replay buffer | 2 MiB per terminal |
| Active terminals per device | 3 |
| Global active terminals | 10 |
| Reconnect deadline | 60 seconds |
| Maximum decoded terminal input data | 48 KiB |
| Maximum resize rate | 10 events/second |
| Pairing attempts | 5 per 10 minutes |
| Graceful termination window | 5 seconds |
| Absolute session duration | 12 hours |
| Idle session timeout | 60 minutes |

These are provisional and require physical and load validation.

### 13.1 Backpressure rules

- output buffering is bounded
- slow clients cannot create unbounded memory growth
- replay gaps are explicit
- dropped output is reported
- the client cannot dictate authoritative sequence state
- resize requests are rate-limited
- input messages are size-limited
- terminal output must not enter browser persistence by default

---

## 14. PTY launch policy

Phase 1 accepts no arbitrary executable path from the browser.

Approved Phase 1 launcher:

```text
configured default shell
```

Later explicitly configured launchers may include:

- Pi
- OpenCode
- tmux create
- tmux attach
- other administrator-configured commands

Gateway requirements:

- canonical workspace root
- workspace allowlist
- sanitized environment
- no browser-supplied arbitrary working directory
- terminal-count limits
- spawn timeout
- output limits
- idle expiry
- absolute expiry
- graceful termination
- forced process-tree cleanup
- redacted diagnostics

---

## 15. Workspace architecture

A workspace is a server-authorized root with a stable identifier.

Suggested type:

```ts
interface WorkspaceDescriptor {
  id: string;
  displayName: string;
  canonicalRoot: string;
  enabled: boolean;
  allowedLaunchers: string[];
}
```

Rules:

- browser receives workspace identifiers, not authority
- server resolves identifier to canonical root
- paths are normalized and validated server-side
- symbolic-link behavior must be defined
- file operations remain inside authorized roots
- terminal working directory must be derived from authorized policy
- diagnostics expose workspace-relative paths by default

---

## 16. Structured Pi RPC preservation

The existing structured controller remains operational.

v0.2 integration must preserve:

- existing structured prompts
- agent controls
- provider and model status
- approvals
- workspace handling
- files
- diagnostics
- session controls
- regression tests

The terminal and structured RPC services share:

- authentication
- device session
- workspace policy
- diagnostics policy
- audit policy

They do not share:

- unstructured terminal input
- terminal lease state
- PTY replay
- PTY lifecycle

---

## 17. Offline architecture

The PWA may launch offline. Host commands may not execute offline.

### Offline-capable client shell

- cached application shell
- non-sensitive preferences
- themes
- draft preservation
- cached help
- connection diagnostics
- cached non-sensitive workspace labels where permitted

### Connected host mode

- terminal input and output
- PTY lifecycle
- Pi and OpenCode execution
- repository access
- tmux
- structured RPC

Offline rules:

- pause terminal input
- do not simulate successful output
- do not silently queue commands
- preserve drafts
- state whether the process may still be active
- show safest recovery action

---

## 18. Storage architecture

Allowed in browser storage:

- theme
- interface font size
- terminal font size
- keyboard layout
- shortcut profiles
- draft input
- last selected workspace identifier
- non-sensitive preferences
- cached help
- optional non-sensitive display cache

Prohibited in browser storage:

- provider API keys
- pairing codes
- JavaScript-readable session secrets
- host environment variables
- SSH keys
- shell credentials
- unbounded terminal history
- sensitive terminal output by default

Session authentication should use secure HTTP-only cookies.

---

## 19. Audit and diagnostics architecture

Audit events should include:

- pairing success and failure
- authentication expiry
- terminal creation
- PTY spawn
- controller lease issue
- controller lease transfer
- controller lease revocation
- detach
- reconnect
- replay gap
- graceful termination
- forced termination
- process failure
- authorization rejection
- workspace rejection
- resource-limit rejection

Audit records must not include:

- provider keys
- pairing codes
- cookies
- raw environment variables
- shell credentials
- SSH keys
- unredacted terminal output
- arbitrary command content by default

Diagnostics must explain:

1. what failed
2. current impact
3. whether anything executed
4. safest next action

---

## 20. Process cleanup architecture

Nonpersistent PTYs must not outlive gateway policy.

Required cleanup paths:

- user-requested graceful termination
- user-requested forced termination
- idle expiry
- absolute expiry
- reconnect deadline expiry when policy requires cleanup
- gateway shutdown
- gateway crash recovery where detectable
- spawn failure
- unrecoverable PTY failure

Termination sequence:

1. transition to `TERMINATING`
2. stop accepting input
3. send graceful signal
4. wait up to configured graceful window
5. terminate process tree if still active
6. close PTY resources
7. clear lease
8. close replay resources
9. emit redacted audit event
10. transition to `TERMINATED` or `FAILED`

Exact signal and process-tree behavior is platform-specific and belongs in the PTY lifecycle specification.

---

## 21. iPhone runtime architecture

Dedicated iOS platform controllers handle:

- Dynamic Island spacing
- home indicator spacing
- `visualViewport`
- keyboard-open resizing
- rotation
- standalone PWA mode
- background and foreground transitions
- external keyboard handling
- terminal fit debounce
- scroll locking
- selection
- paste

The terminal must resize only after viewport stabilization.

The client must not assume:

- background WebSockets remain active
- viewport dimensions update atomically
- keyboard transitions emit a single event
- full-screen state should persist across unrelated sessions

---

## 22. Tablet and desktop architecture

The iPhone workflow remains authoritative.

### Tablet

- optional two-column layouts
- persistent Files or Sessions details
- wider terminal viewport
- touch-first controls
- no hover-only actions

### Desktop

Terminal-First Desktop Mode may provide:

- dominant terminal workspace
- docked Console, Sessions, Files, and Diagnostics
- resizable panels
- collapsible panels
- keyboard shortcuts
- pointer interactions
- return to balanced layout

Cross-device rules:

- no automatic writable lease transfer
- session identity remains stable
- layout preferences are non-sensitive
- desktop-only controls cannot become required for security or recovery

---

## 23. Suggested package boundaries

```text
packages/
├─ protocol/
│  ├─ envelopes
│  ├─ message schemas
│  └─ protocol errors
├─ shared-types/
│  ├─ session types
│  ├─ workspace types
│  └─ diagnostics types
├─ terminal-profile/
│  ├─ shortcut profiles
│  ├─ terminal display profiles
│  └─ density profiles
└─ security-policy/
   ├─ session policy
   ├─ workspace policy types
   └─ redaction policy
```

Rules:

- protocol schemas are shared but gateway validation remains authoritative
- browser-side type checks do not replace server validation
- security policy types must not expose secrets
- shared packages must not create circular runtime dependencies

---

## 24. Failure domains

### 24.1 Client failure

Examples:

- PWA crash
- tab closed
- browser backgrounding
- local storage unavailable
- renderer failure

Expected behavior:

- PTY may remain alive according to server policy
- session becomes detached
- reconnect remains explicit
- drafts are preserved where possible
- no server authority is lost

### 24.2 Network failure

Examples:

- tailnet interruption
- Tailscale Serve unavailable
- WebSocket loss
- device switching networks

Expected behavior:

- terminal input pauses
- PTY remains alive during reconnect window
- output accumulates only within replay bounds
- reconnect state is visible
- expiry is deterministic

### 24.3 Gateway failure

Examples:

- uncaught exception
- process shutdown
- resource exhaustion
- port bind failure

Expected behavior:

- nonpersistent PTYs are cleaned up where possible
- startup validation detects orphan risk
- restoration is not claimed in Phase 1
- diagnostics remain redacted

### 24.4 PTY failure

Examples:

- spawn failure
- child exit
- process-tree cleanup failure
- renderer-independent output issue

Expected behavior:

- state transitions to `FAILED` or `TERMINATED`
- client receives explicit lifecycle event
- whether anything executed is stated
- recovery action is provided

---

## 25. Phase 1 architecture scope

Phase 1 includes:

- xterm.js viewport
- restricted `node-pty` launcher
- versioned WebSocket protocol
- terminal input and output
- terminal resize
- single-controller lease
- bounded replay
- 60-second reconnect
- explicit terminate
- explicit force-kill
- authorization tests
- lifecycle tests
- structured-controller regression tests

Phase 1 excludes:

- arbitrary browser-supplied executables
- arbitrary browser-supplied working directories
- read-only multi-viewer mode
- concurrent writable controllers
- gateway restart restoration
- public access
- Tailscale Funnel
- provider-key storage in the PWA

---

## 26. Architecture acceptance gates

Do not claim the Phase 1 architecture complete unless all pass:

1. Gateway listens only on `127.0.0.1`.
2. Tailscale Serve remains tailnet-only.
3. Funnel is disabled.
4. Unpaired clients cannot create PTYs.
5. A paired device cannot access another device’s terminal without authorization.
6. Only the lease holder can send input or resize.
7. Stale lease generations are rejected.
8. Invalid, unknown, and oversized messages are rejected.
9. Output cannot cause unbounded memory growth.
10. Disconnect does not immediately kill the PTY.
11. Reconnect replays output without duplication.
12. Replay gaps are explicit.
13. Reconnect expiry follows policy.
14. `Ctrl+C`, `Ctrl+D`, UTF-8, ANSI, alternate screen, and resize work.
15. Closing a nonpersistent session cleans up the process tree.
16. Gateway shutdown cleans up nonpersistent PTYs.
17. Existing structured Pi functions still pass.
18. No credentials, pairing codes, cookies, or terminal secrets enter logs or browser persistence.
19. Offline state never implies command execution.
20. Emergency termination remains reachable.
21. Physical iPhone 16 Pro behavior passes the acceptance matrix.
22. Reduce Motion and required accessibility behavior are honored.

---

## 27. Architectural decisions

### ADR-001 — Preserve the structured controller

**Decision:** Keep the existing structured Pi controller as a first-class surface.

**Reason:** It provides semantic operations, approvals, status, and recovery that should not be replaced by raw terminal interaction.

### ADR-002 — Add a real PTY

**Decision:** Use a restricted real PTY through `node-pty`.

**Reason:** Pi, OpenCode, tmux, vim, and terminal TUIs require genuine terminal semantics.

### ADR-003 — Tailnet-only gateway

**Decision:** Bind the gateway to loopback and expose it only through Tailscale Serve.

**Reason:** Terminal access is equivalent to shell access to the host account.

### ADR-004 — Separate control and data planes

**Decision:** Use HTTPS for control operations and WSS for terminal streams.

**Reason:** Lifecycle, pairing, lease transfer, and termination require explicit structured operations.

### ADR-005 — Single writable controller

**Decision:** Permit one writable controller per terminal in v0.2.

**Reason:** It prevents conflicting input and ambiguous resize ownership.

### ADR-006 — Server-authoritative bounded replay

**Decision:** Maintain a bounded server replay ring with sequence numbers.

**Reason:** Reconnect must recover output without unbounded memory use or client-authoritative state.

### ADR-007 — No arbitrary browser launcher

**Decision:** Browser clients select only server-configured launchers and workspaces.

**Reason:** Arbitrary executable and path selection would expand the remote-code-execution surface.

### ADR-008 — No silent offline command queue

**Decision:** Preserve drafts but never automatically execute queued shell commands after reconnect.

**Reason:** The user must know whether and when a command executes.

### ADR-009 — Defer gateway restart restoration

**Decision:** Do not promise gateway restart restoration in early phases.

**Reason:** It requires durable identity, process recovery, replay, and authorization semantics beyond Phase 1.

---

## 28. Unresolved architecture items

These items require later specification or validation:

- exact HTTPS API routes — provisionally defined by `docs/PROTOCOL.md`; subject to implementation validation
- exact WebSocket message catalog — provisionally defined by `docs/PROTOCOL.md`; subject to implementation validation
- exact error-code taxonomy — provisionally defined by `docs/PROTOCOL.md`; subject to implementation validation
- pairing code format and expiry
- cookie duration and renewal policy
- controller lease duration and heartbeat policy
- replay eviction behavior
- replay-gap response structure — provisionally defined by `docs/PROTOCOL.md`; subject to implementation validation
- symbolic-link workspace policy
- exact environment allowlist and denylist
- exact process-tree termination behavior by operating system
- gateway crash orphan detection
- exact resource-limit values after load testing
- xterm.js renderer fallback policy
- desktop breakpoint values
- gateway restart restoration design

These are not implementation authorizations.

---

## 29. Next document dependencies

This architecture document must be reviewed together with:

```text
docs/THREAT-MODEL.md
docs/PROTOCOL.md
docs/PTY-LIFECYCLE.md
docs/VISUAL-SYSTEM.md
docs/IPHONE-ACCEPTANCE.md
```

Recommended next artifact:

```text
docs/THREAT-MODEL.md
```

Do not begin full terminal implementation until all six Phase 0 planning documents are reviewed.

---

## Phase 0 consistency reconciliation — authoritative contract

**Reconciled:** 2026-07-24
**Scope:** C-01 through C-10
**Precedence:** This section supersedes any conflicting earlier wording in this document.

1. **Transport and input limits (C-01).** The maximum complete WebSocket UTF-8 JSON text frame is **64 KiB**. The maximum decoded `terminal.input.data` content is **48 KiB**. The lower input limit reserves bounded space for the envelope and JSON escaping.
2. **Single attachment (C-02, C-05).** Phase 1 permits one authorized attached browser client per terminal. The application WebSocket transport is global and distinct from per-terminal attachment. An open transport does not itself make a terminal attached or `RUNNING`. Multi-viewer/read-only observation is deferred.
3. **Failure publication (C-03).** On an unrecoverable error, input is atomically disabled and the lease revoked. Best-effort cleanup runs in an internal, non-public cleanup substate. Public `FAILED` is published only after that cleanup attempt completes, with `cleanupResult` and `processMayStillBeActive`. `FAILED` is terminal in the public state machine.
4. **Protocol definition status (C-04).** HTTPS routes, the WebSocket message catalog, error taxonomy, and replay-gap structure are **provisionally defined by `docs/PROTOCOL.md`**, subject to implementation validation. They are not wholly unresolved.
5. **Authentication and leases (C-06).** Device-session expiry immediately invalidates any lease owned by that session and invalidates or advances its generation. Reauthentication never restores the prior writable lease; explicit reacquisition is required.
6. **Idle activity (C-07).** Idle expiry resets only on accepted user input or an explicit authorized keep-alive/session action. PTY output, transport heartbeat, replay delivery, and resize alone do not reset idle expiry. Absolute expiry is never extended by activity.
7. **Pre-authentication privacy (C-08).** Pairing status exposes only a generic private-connection result, a user-safe host display label, and pairing availability. It is rate-limited and exposes no canonical hostname, account name, paths, detailed version, or diagnostics.
8. **PTY text encoding (C-09).** PTY bytes use a streaming UTF-8 decoder. Split code points are buffered across reads; malformed sequences emit U+FFFD; JSON escaping occurs after decoding; sequence numbers apply to emitted protocol chunks, not raw OS reads. Binary/raw framing remains deferred.
9. **Owned process identity (C-10).** Cleanup targets an internal terminal-bound identity containing PID, optional process-group ID, process start time, and an optional platform handle. The platform handle is never client-visible. Session binding and creation-time validation are required before forced cleanup.

The genuinely unresolved architecture items remain pairing-code format/expiry, cookie duration/renewal, lease duration/heartbeat cadence, symlink policy, environment policy, platform-specific process-tree termination details, orphan detection, post-validation resource limits, renderer fallback, desktop breakpoints, and gateway-restart restoration.
