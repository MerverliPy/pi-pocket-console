# Pi Pocket Console v0.2 Threat Model

**Status:** Phase 0 planning baseline
**Product:** Pi Pocket Console v0.2
**Architecture:** Hybrid iPhone-first terminal PWA
**Implementation branch:** `agent/v0.2-hybrid-terminal-pwa`
**Published baseline:** `0.1.0` at commit `e083ad04885620478009b7967d25744e134999c1`

---

## 1. Purpose

This document defines the security threat model for Pi Pocket Console v0.2.

Pi Pocket Console exposes remote terminal and structured control capabilities to a host account. Terminal access is equivalent to shell access to that host account. The design therefore assumes a high-impact consequence if authentication, authorization, workspace policy, controller-lease enforcement, secret handling, process cleanup, or network exposure fails.

This threat model covers:

- iPhone PWA
- Tailscale Serve
- loopback-bound gateway
- pairing and device sessions
- authenticated HTTPS and WebSocket traffic
- terminal creation and lifecycle
- controller leases
- bounded replay
- workspace authorization
- structured Pi RPC
- browser storage
- diagnostics and audit events
- process cleanup
- tablet and desktop clients

---

## 2. Security objectives

The system must:

1. Prevent public exposure.
2. Prevent unauthenticated terminal creation.
3. Prevent cross-device terminal access without authorization.
4. Prevent unauthorized terminal input or resize.
5. Prevent arbitrary browser-selected executables.
6. Prevent arbitrary browser-selected working directories.
7. Prevent path traversal outside allowed workspaces.
8. Prevent secret persistence in browser storage.
9. Prevent secret disclosure in logs and diagnostics.
10. Prevent unbounded memory growth from terminal output or replay.
11. Prevent stale controller leases from remaining authoritative.
12. Prevent silent execution of commands after reconnect.
13. Prevent detached or expired sessions from being misrepresented.
14. Ensure nonpersistent PTYs are cleaned up.
15. Preserve the existing structured Pi controller’s security behavior.
16. Keep emergency termination reachable.
17. Make user-visible status accurately reflect whether anything executed.

---

## 3. Non-goals

This model does not claim to protect against:

- a fully compromised host operating system
- a malicious administrator with direct host access
- a compromised Tailscale account with valid tailnet access plus valid application pairing
- malware already running under the same host account
- terminal commands intentionally entered by an authorized controller
- secrets deliberately printed to the terminal by the user or a process
- host-level keylogging or screen capture
- physical compromise of an unlocked paired device
- gateway restart restoration before that feature is explicitly designed and validated

These remain outside the v0.2 Phase 1 trust guarantee.

---

## 4. Protected assets

### 4.1 Host assets

- shell access
- host account privileges
- repositories
- source code
- local files
- SSH configuration
- Git credentials
- environment variables
- provider credentials
- package-manager credentials
- build artifacts
- local services
- process state
- tmux sessions
- Pi and OpenCode sessions

### 4.2 Application assets

- pairing codes
- paired-device identities
- authenticated device sessions
- session cookies
- controller leases
- lease generations
- terminal session identifiers
- replay sequence state
- replay buffers
- workspace allowlist
- configured launcher allowlist
- diagnostics
- security audit events

### 4.3 User-trust assets

- accurate execution status
- accurate connection status
- accurate lease ownership
- accurate session lifecycle state
- explicit approval state
- reliable emergency termination
- preservation of draft text
- confidence that offline commands were not executed

---

## 5. Actors

### 5.1 Authorized user

A legitimate user operating a paired iPhone, tablet, or desktop client.

### 5.2 Authorized secondary device

A device paired to the same application but not necessarily authorized to control every terminal session.

### 5.3 Tailnet member without application authorization

A device that can reach Tailscale Serve but has no valid paired-device session.

### 5.4 Remote network attacker

An attacker outside the tailnet attempting direct public access, scanning, spoofing, or social engineering.

### 5.5 Malicious or compromised browser context

A malicious script, browser extension, injected dependency, or compromised origin attempting to access application data or issue commands.

### 5.6 Malicious paired device

A device with a valid application session attempting cross-device access, lease theft, replay abuse, or resource exhaustion.

### 5.7 Compromised host process

A local process attempting to abuse gateway trust, inject output, steal secrets, or interfere with cleanup.

### 5.8 Accidental user error

A legitimate user unintentionally triggering destructive commands, force termination, or unsafe workspace selection.

---

## 6. Trust boundaries

### Boundary A — Public internet to tailnet

**Expected control:** Tailscale membership and Tailscale Serve.

**Threats:**

- accidental public exposure
- Tailscale Funnel enabled
- router port forwarding
- direct listener on a public interface
- DNS or hostname confusion

**Required controls:**

- gateway binds only to `127.0.0.1`
- Tailscale Serve only
- Funnel disabled
- no router port forwarding
- no public listener
- startup validation of bind address
- deployment validation before release

---

### Boundary B — Tailnet to application authentication

**Expected control:** paired-device application session.

**Threats:**

- tailnet member assumes network access equals application authorization
- brute-force pairing
- pairing code reuse
- leaked pairing code
- session fixation
- session theft
- stale session use

**Required controls:**

- one-time short-lived pairing codes
- strict attempt limits
- rate limiting
- secure HTTP-only same-site cookies
- session rotation after pairing
- idle expiry
- absolute expiry
- explicit re-pairing after expiry
- redacted authentication diagnostics

---

### Boundary C — Browser origin to gateway

**Expected control:** strict origin, authenticated session, schema validation.

**Threats:**

- cross-site request forgery
- cross-site WebSocket hijacking
- origin spoofing
- malicious embedded frame
- injected browser script
- replayed control requests

**Required controls:**

- strict `Origin` validation
- no wildcard origins
- secure cookies
- same-site policy
- anti-CSRF strategy for state-changing HTTPS operations
- WebSocket authentication at upgrade
- CSP
- frame restrictions
- secure response headers
- request IDs and idempotency where required

---

### Boundary D — Device session to terminal session

**Expected control:** authorization and ownership checks.

**Threats:**

- guessing terminal session IDs
- cross-device terminal listing
- unauthorized attach
- unauthorized termination
- unauthorized replay access
- unauthorized diagnostics access

**Required controls:**

- opaque session identifiers
- server-side device-session ownership checks
- authorization on every terminal operation
- no trust in browser-provided ownership data
- filtered session listings
- explicit transfer workflows
- redacted access-denied responses

---

### Boundary E — Authorized device to writable controller

**Expected control:** controller lease.

**Threats:**

- stale controller continues sending input
- reconnect steals control
- concurrent writable controllers
- forged lease generation
- resize race
- transfer race
- revoked device continues sending

**Required controls:**

- one writable controller in v0.2
- lease ID and generation
- server-authoritative generation increments
- input and resize require active lease
- stale generation rejection
- explicit transfer
- revocation event to previous controller
- no silent ownership transfer on reconnect
- lease expiry and heartbeat policy

---

### Boundary F — Gateway to PTY launcher

**Expected control:** server-configured launcher and workspace policy.

**Threats:**

- arbitrary executable path
- command injection in launcher configuration
- arbitrary working directory
- environment-variable poisoning
- path traversal
- symlink escape
- shell metacharacter injection
- inherited secret leakage

**Required controls:**

- no browser-supplied executable path
- no browser-supplied arbitrary working directory
- launcher allowlist
- canonical workspace roots
- path normalization
- explicit symlink policy
- sanitized environment
- explicit argument construction
- no command-string concatenation when process APIs support argv arrays
- spawn timeout
- process-count limits

---

### Boundary G — PTY output to client

**Expected control:** bounded replay, framing, output limits.

**Threats:**

- memory exhaustion
- browser crash
- terminal escape-sequence abuse
- terminal title spoofing
- clipboard manipulation
- sensitive output persistence
- replay duplication
- replay gap concealment

**Required controls:**

- bounded replay buffer
- bounded client scrollback
- sequence numbers
- explicit replay acknowledgement
- explicit replay-gap event
- no terminal output in browser persistence by default
- sanitize or restrict dangerous terminal integrations
- do not trust terminal title for security identity
- rate and size limits

---

### Boundary H — Structured Pi RPC

**Expected control:** existing structured authorization and approval model.

**Threats:**

- bypassing structured approvals through terminal integration
- terminal output treated as trusted structured result
- duplicate execution between terminal and structured controller
- approval state desynchronization

**Required controls:**

- preserve structured controller boundaries
- do not map raw terminal text to trusted structured events
- keep structured approvals explicit
- keep terminal and RPC operation identifiers separate
- regression tests for existing behavior

---

## 7. Entry points

Security review must cover:

- pairing endpoint
- authentication state endpoint
- terminal list endpoint
- terminal creation endpoint
- workspace list endpoint
- lease acquisition endpoint
- lease transfer endpoint
- terminate endpoint
- force-terminate endpoint
- diagnostics endpoint
- WebSocket upgrade
- PTY input messages
- resize messages
- replay acknowledgements
- heartbeat messages
- structured Pi RPC operations
- file browsing
- upload staging
- PWA storage
- service worker
- error reporting
- audit logging

---

## 8. Threat analysis by category

## 8.1 Spoofing

### T-S-001 — Spoofed paired device

**Scenario:** An attacker presents a copied or guessed device identifier.

**Impact:** Unauthorized access to terminal sessions or structured operations.

**Mitigations:**

- device identifiers are not authentication
- secure session cookie required
- session rotation after pairing
- server-side binding of session to issued device identity
- expiry and revocation support

**Residual risk:** Physical compromise of an unlocked paired device.

---

### T-S-002 — Spoofed host or gateway identity

**Scenario:** The user connects to the wrong hostname or a malicious tailnet service.

**Impact:** Pairing-code disclosure or command submission to an unintended service.

**Mitigations:**

- display verified host identity
- use Tailscale HTTPS identity
- strict origin and hostname validation
- confirm host identity before pairing
- avoid generic insecure fallback URLs

**Residual risk:** User ignores identity mismatch warnings.

---

### T-S-003 — Spoofed controller lease

**Scenario:** A client submits a forged lease ID or stale generation.

**Impact:** Unauthorized terminal input.

**Mitigations:**

- unpredictable lease IDs
- server-authoritative generation
- session and device binding
- reject stale generations
- audit rejected attempts

**Residual risk:** Compromised active controller device.

---

## 8.2 Tampering

### T-T-001 — WebSocket message tampering

**Scenario:** A client modifies message type, session ID, sequence, or payload.

**Impact:** Unauthorized input, resize, replay manipulation, or lifecycle corruption.

**Mitigations:**

- TLS
- strict schema validation
- authorization per message
- known message-type allowlist
- version validation
- size limits
- lifecycle-state validation

---

### T-T-002 — Workspace path tampering

**Scenario:** A client attempts traversal, encoded traversal, symlink escape, or alternate path syntax.

**Impact:** Access outside authorized roots.

**Mitigations:**

- server-side canonicalization
- workspace identifiers instead of raw roots
- normalize before authorization
- explicit symlink policy
- reject path escape
- workspace-relative diagnostics by default

---

### T-T-003 — Launcher tampering

**Scenario:** A client supplies executable paths, shell fragments, or injected arguments.

**Impact:** Arbitrary command execution beyond configured policy.

**Mitigations:**

- configured launcher allowlist
- argv arrays
- no shell-string concatenation
- no browser-supplied executable path
- explicit launcher-specific argument schemas
- configuration validation at startup

---

### T-T-004 — Replay-state tampering

**Scenario:** A client acknowledges data it did not receive or requests an impossible replay cursor.

**Impact:** Hidden output gaps, duplication, state confusion.

**Mitigations:**

- server-authoritative sequence numbers
- validate acknowledgement range
- explicit replay-gap event
- do not discard authoritative state solely on client claims

---

## 8.3 Repudiation

### T-R-001 — Denial of terminal creation or termination

**Scenario:** A user disputes having created or terminated a terminal.

**Impact:** Weak incident reconstruction.

**Mitigations:**

- redacted audit event
- device-session identifier
- terminal session identifier
- timestamp
- lifecycle transition
- reason code
- no raw command content by default

---

### T-R-002 — Unclear execution status

**Scenario:** A network interruption makes it unclear whether a command executed.

**Impact:** User repeats a destructive command or assumes work completed.

**Mitigations:**

- never silently queue commands
- state whether input was accepted
- state whether process may still be active
- explicit reconnect and replay state
- request IDs for structured operations

---

## 8.4 Information disclosure

### T-I-001 — Secrets in browser storage

**Scenario:** Provider keys, pairing codes, session secrets, terminal output, or credentials enter local storage or IndexedDB.

**Impact:** Secret theft from browser context, device backup, or extension.

**Mitigations:**

- explicit storage allowlist
- secure HTTP-only cookies
- no pairing-code persistence
- no terminal-output persistence by default
- storage audit tests
- clear sensitive in-memory data on logout where practical

---

### T-I-002 — Secrets in logs or diagnostics

**Scenario:** Environment variables, cookies, command output, paths, or credentials are logged.

**Impact:** Long-lived secret exposure.

**Mitigations:**

- central redaction service
- allowlisted diagnostic fields
- no raw environment dumps
- no cookie logging
- no pairing-code logging
- no raw terminal output by default
- workspace-relative paths by default
- test fixtures containing fake secrets

---

### T-I-003 — Cross-device replay disclosure

**Scenario:** A paired device accesses replay output from another device’s terminal.

**Impact:** Source code or secret disclosure.

**Mitigations:**

- authorization on replay access
- terminal ownership binding
- explicit transfer
- no session-ID-only access
- filtered session lists

---

### T-I-004 — Terminal escape-sequence abuse

**Scenario:** A process emits escape sequences intended to manipulate title, clipboard, links, or terminal behavior.

**Impact:** Misleading identity, clipboard poisoning, unsafe link activation.

**Mitigations:**

- disable or gate dangerous terminal integrations
- do not use terminal title as trusted identity
- require confirmation for external links
- test OSC and clipboard-related sequences
- keep browser clipboard writes user-mediated

---

## 8.5 Denial of service

### T-D-001 — Unbounded PTY output

**Scenario:** A process floods output.

**Impact:** Gateway memory exhaustion, browser crash, degraded host.

**Mitigations:**

- 2 MiB provisional replay limit
- bounded browser scrollback
- backpressure
- output accounting
- terminal-count limits
- session expiry
- load tests

---

### T-D-002 — Terminal creation flood

**Scenario:** A paired or unpaired client repeatedly creates terminals.

**Impact:** Process exhaustion.

**Mitigations:**

- authentication
- authorization
- per-device terminal limit
- global terminal limit
- creation rate limit
- spawn timeout
- audit events

---

### T-D-003 — Resize flood

**Scenario:** Client sends continuous resize events.

**Impact:** CPU load and PTY instability.

**Mitigations:**

- provisional 10 events/second limit
- coalescing
- lease requirement
- invalid size rejection
- stabilization debounce on client

---

### T-D-004 — Pairing brute force

**Scenario:** Attacker guesses short-lived codes.

**Impact:** Unauthorized device pairing.

**Mitigations:**

- high-entropy code
- short expiry
- 5 attempts per 10 minutes provisional limit
- per-source and global rate limits
- one-time use
- audit failures
- cooldown messaging

---

### T-D-005 — Detached session accumulation

**Scenario:** Sessions remain active indefinitely after clients disconnect.

**Impact:** Process exhaustion and unintended persistent access.

**Mitigations:**

- reconnect deadline
- idle timeout
- absolute timeout
- explicit detached state
- global limits
- cleanup policy
- tmux persistence only by explicit user action

---

## 8.6 Elevation of privilege

### T-E-001 — Arbitrary launcher selection

**Scenario:** Browser requests privileged or unintended executable.

**Impact:** Remote code execution outside intended launcher policy.

**Mitigations:**

- configured launchers only
- no browser-supplied path
- no arbitrary shell command field
- launcher-specific validation
- sanitized environment

---

### T-E-002 — Workspace escape

**Scenario:** Authorized terminal starts outside permitted root or follows symlink outside it.

**Impact:** Access to broader host filesystem.

**Mitigations:**

- canonical root resolution
- explicit symlink policy
- server-derived working directory
- deny traversal
- test Windows and POSIX path variants if supported

---

### T-E-003 — Lease transfer race

**Scenario:** Two devices race to acquire or transfer control.

**Impact:** Concurrent writable access or silent controller theft.

**Mitigations:**

- atomic lease update
- generation increment
- explicit previous-controller revocation
- no reconnect auto-steal
- concurrency tests

---

### T-E-004 — Structured approval bypass

**Scenario:** A terminal action is incorrectly represented as an approved structured operation.

**Impact:** Destructive or remote writes bypass review.

**Mitigations:**

- terminal and structured actions remain distinct
- no automatic conversion of terminal output to approval
- remote writes remain explicit
- structured-controller regression tests

---

## 9. Browser and PWA threats

### 9.1 Service worker cache poisoning

**Threat:** A compromised or stale service worker serves malicious or incompatible assets.

**Controls:**

- versioned assets
- integrity where practical
- controlled update activation
- explicit reload-required state
- no silent downgrade
- CSP
- same-origin-only asset policy

### 9.2 Cross-site scripting

**Threat:** Injected content executes in the PWA origin.

**Controls:**

- strict CSP
- no unsafe inline scripts where avoidable
- sanitize rendered structured content
- escape diagnostics
- avoid rendering raw terminal output as HTML
- dependency review
- Trusted Types where practical

### 9.3 Malicious browser extension

**Threat:** Extension reads page content or injects script.

**Controls:**

- no provider keys in page-accessible storage
- HTTP-only cookies
- minimize sensitive DOM exposure
- no raw secret diagnostics
- security guidance for trusted device use

**Residual risk:** Browser extensions may still observe visible terminal content.

### 9.4 Clickjacking

**Controls:**

- frame-ancestors restriction
- X-Frame-Options equivalent
- no embedding by untrusted origins

### 9.5 Clipboard abuse

**Controls:**

- user gesture required for writes
- explicit paste action
- never auto-copy secrets
- terminal escape sequences cannot silently write clipboard

---

## 10. Network threats

### 10.1 Accidental public listener

**Control:** Startup must fail closed if configured bind address is not loopback unless explicit future policy permits otherwise.

### 10.2 Tailscale Funnel activation

**Control:** Deployment validation must explicitly verify Funnel is disabled.

### 10.3 DNS rebinding or host confusion

**Controls:**

- strict host/origin validation
- Tailscale HTTPS identity
- no wildcard host acceptance
- no fallback public hostname

### 10.4 WebSocket downgrade

**Control:** WSS only through the trusted HTTPS origin.

### 10.5 Replay of pairing or session traffic

**Controls:**

- TLS
- one-time pairing
- short expiry
- session rotation
- request freshness or idempotency for sensitive control operations

---

## 11. Session and cookie security

Required cookie properties:

- `Secure`
- `HttpOnly`
- `SameSite=Strict` where compatible with the deployment
- narrow path where practical
- no JavaScript access
- rotation after pairing
- invalidation on logout and expiry

Session controls:

- idle expiry
- absolute expiry
- revocation
- explicit re-pairing
- no indefinite unattended sessions
- no session secret in URL
- no session secret in local storage
- no session secret in logs

---

## 12. Pairing security

Pairing flow requirements:

1. Verify private connection.
2. Show host identity.
3. Show gateway availability.
4. Accept one-time short-lived code.
5. Enforce attempt limits.
6. Rotate to authenticated device session.
7. Confirm device label and duration.
8. Never persist the code.
9. Never expose code in logs.
10. Avoid repeated screen-reader announcements from countdown updates.

Open design items:

- exact code length
- entropy target
- expiry duration
- issuance channel
- revocation behavior
- recovery after repeated failure

---

## 13. Controller-lease security

A controller lease is an authorization capability bound to:

- terminal session
- device identity
- lease ID
- generation
- issue time
- expiry time

Required invariants:

- only one writable controller
- input and resize require current generation
- transfer is atomic
- reconnect does not imply transfer
- revoked controller is notified
- stale controller input is rejected
- lease state is visible to user
- lease events are audited
- force termination does not require hidden ownership assumptions

Open design items:

- heartbeat interval
- lease duration
- grace period
- transfer confirmation UX
- transfer during reconnect
- forced administrative revocation

---

## 14. Replay security

Required invariants:

- server sequence is authoritative
- buffer is bounded
- replay is authorization-checked
- replay is scoped to terminal session
- client acknowledgement is validated
- replay gaps are explicit
- duplication is detectable
- terminal output is not persisted in browser storage by default

Threat-specific tests:

- acknowledgement beyond current sequence
- negative or malformed sequence
- stale client replay request
- replay after lease transfer
- replay after session expiry
- oversized output burst
- reconnect after buffer eviction

---

## 15. Process and cleanup security

Threats:

- orphaned child processes
- process-tree escape
- graceful termination ignored
- gateway crash leaves terminals active
- expired sessions remain writable
- force-kill targets wrong process

Controls:

- gateway-owned PTY handles
- process-tree tracking
- graceful timeout
- forced process-tree termination
- session-specific process identity
- cleanup on gateway shutdown
- cleanup on expiry
- explicit unsupported-state reporting
- no gateway-restart restoration claim in Phase 1

Required tests:

- shell with child process
- tmux-managed session
- process ignoring graceful signal
- gateway shutdown
- browser disconnect
- reconnect expiry
- simultaneous terminate and output
- terminate after lease transfer

---

## 16. File and workspace threats

Threats:

- path traversal
- symlink escape
- absolute path injection
- unauthorized upload destination
- misleading upload success
- sensitive path disclosure
- race between validation and use

Controls:

- canonical workspace descriptors
- workspace-relative client paths
- server-side validation immediately before use
- explicit transfer authorization
- host confirmation before success
- path redaction in diagnostics
- atomic or safe file-write strategy
- no arbitrary host path entry by default

---

## 17. Diagnostics and audit threats

Threats:

- secret leakage
- log injection
- path disclosure
- user identity confusion
- missing evidence
- excessive retention
- terminal output capture without consent

Controls:

- centralized redaction
- structured event schema
- allowlisted fields
- newline and control-character normalization
- retention policy
- no raw terminal output by default
- no provider keys
- no pairing codes
- no cookies
- no environment dump
- distinguish user label from issued device identity

---

## 18. Supply-chain threats

Threats:

- compromised npm dependency
- malicious transitive package
- xterm.js plugin risk
- node-pty native-binary risk
- lockfile tampering
- build-script execution

Controls:

- pinned dependencies
- lockfile review
- minimal dependency set
- provenance and release checks where available
- vulnerability scanning
- native dependency review
- reproducible or deterministic build checks where practical
- no unreviewed postinstall scripts
- dependency update policy
- regression tests after upgrades

Special attention:

- `node-pty`
- xterm.js core
- xterm.js addons
- WebSocket library
- HTTP framework
- validation library
- cookie and session middleware

---

## 19. Abuse cases

### AC-001 — Tailnet member attempts terminal creation without pairing

**Expected result:** Rejected. No terminal created. No sensitive diagnostics returned.

### AC-002 — Paired Device A guesses Device B’s session ID

**Expected result:** Rejected. Session remains undisclosed.

### AC-003 — Device B reconnects and attempts silent lease takeover

**Expected result:** Reconnect succeeds only as authorized. Writable control is not transferred silently.

### AC-004 — Client floods resize messages

**Expected result:** Coalesced or rate-limited. Session remains stable.

### AC-005 — PTY floods output beyond replay limit

**Expected result:** Memory remains bounded. Replay gap is explicit.

### AC-006 — Client submits `../../` workspace path

**Expected result:** Rejected before spawn or file access.

### AC-007 — Pairing code entered after expiry

**Expected result:** Rejected. Code cannot be reused.

### AC-008 — Browser goes offline after input submission

**Expected result:** UI states whether input was accepted. No silent retry after reconnect.

### AC-009 — Terminal emits clipboard escape sequence

**Expected result:** No silent clipboard write.

### AC-010 — Gateway shuts down with active nonpersistent PTYs

**Expected result:** Process trees are cleaned up or failure is explicitly recorded.

### AC-011 — User opens force termination in full-screen terminal

**Expected result:** Control remains reachable but requires focused confirmation.

### AC-012 — Malicious error string contains HTML or terminal control characters

**Expected result:** Rendered safely as text and normalized in logs.

---

## 20. Security requirements by component

### PWA

- strict CSP
- no secrets in browser storage
- no raw HTML rendering of untrusted content
- secure cookie-only session
- explicit offline behavior
- no silent command queue
- safe service-worker update path

### Gateway HTTP server

- loopback bind
- strict host and origin
- authentication
- anti-CSRF strategy
- request-size limits
- rate limits
- secure headers
- redacted errors

### WebSocket server

- authenticated upgrade
- strict origin
- message schema validation
- size limits
- lease checks
- session authorization
- heartbeat
- bounded queues

### Pairing service

- high-entropy code
- one-time use
- short expiry
- attempt limits
- audit failures
- no code logging

### Terminal service

- configured launcher only
- workspace policy
- sanitized environment
- process limits
- lifecycle enforcement
- cleanup
- redacted diagnostics

### Replay buffer

- byte ceiling
- sequence numbers
- session scoping
- authorization
- eviction behavior
- explicit gaps

### Audit service

- structured events
- central redaction
- retention policy
- no raw terminal output by default
- no secrets

---

## 21. Security test matrix

### Authentication

- unpaired terminal creation rejected
- expired session rejected
- revoked session rejected
- session rotation after pairing
- cookie flags verified
- CSRF attempt rejected
- cross-origin WebSocket rejected

### Authorization

- cross-device session access rejected
- cross-workspace access rejected
- stale lease rejected
- unauthorized resize rejected
- unauthorized termination rejected
- replay access rejected after authorization loss

### Input validation

- unknown protocol version rejected
- unknown message type rejected
- oversized message rejected
- malformed schema rejected
- invalid session ID rejected
- invalid terminal dimensions rejected
- path traversal rejected
- symlink policy tested

### Resource limits

- terminal creation flood
- resize flood
- output flood
- replay eviction
- idle expiry
- absolute expiry
- pairing brute force

### Secret handling

- fake provider key redacted
- fake cookie redacted
- fake pairing code redacted
- environment dump prohibited
- terminal output not persisted
- local storage inspected
- error reporting inspected

### Cleanup

- graceful termination
- forced termination
- child process cleanup
- gateway shutdown cleanup
- reconnect expiry cleanup
- failed spawn cleanup
- repeated terminate idempotency

---

## 22. Security acceptance gates

Do not claim Phase 1 security complete unless all pass:

1. Gateway binds only to `127.0.0.1`.
2. Tailscale Serve is tailnet-only.
3. Funnel is disabled.
4. No public listener exists.
5. Unpaired clients cannot create PTYs.
6. Pairing codes are one-time and short-lived.
7. Pairing attempts are rate-limited.
8. Session cookies are secure and HTTP-only.
9. Strict origin validation passes.
10. Cross-site WebSocket attempts are rejected.
11. A paired device cannot access another device’s terminal without authorization.
12. Only the active lease holder can send input or resize.
13. Stale lease generations are rejected.
14. Lease transfer is atomic and explicit.
15. Unknown, malformed, and oversized messages are rejected.
16. Browser clients cannot select arbitrary executable paths.
17. Browser clients cannot select arbitrary working directories.
18. Workspace traversal and escape attempts are rejected.
19. Terminal output cannot cause unbounded memory growth.
20. Replay authorization and sequence validation pass.
21. Disconnect does not silently transfer control.
22. Offline state does not silently queue commands.
23. Nonpersistent PTYs are cleaned up.
24. Gateway shutdown cleans up nonpersistent PTYs.
25. Logs and diagnostics contain no credentials, pairing codes, cookies, or raw environment variables.
26. Terminal output is not persisted in browser storage by default.
27. Emergency termination remains reachable.
28. Existing structured Pi security behavior still passes.
29. Supply-chain review passes for terminal-critical dependencies.
30. Physical iPhone security and recovery flows pass acceptance testing.

---

## 23. Residual risks

Even after mitigations, the following risks remain:

- authorized users can execute destructive commands
- visible terminal output may contain secrets
- compromised browser extensions may observe rendered content
- compromised paired devices may act within their current authorization
- host compromise defeats gateway isolation
- process cleanup may vary by operating system
- terminal escape-sequence behavior may vary by renderer
- Tailscale account compromise may expand network reach
- user confusion remains possible during partial network failure
- tmux intentionally extends process lifetime
- later gateway restart restoration will introduce new persistence risks

These must be documented in release notes and operator guidance where relevant.

---

## 24. Open security decisions

The following require later explicit design:

- exact pairing-code entropy and format
- pairing expiry duration
- authentication session duration
- cookie renewal strategy
- CSRF mechanism
- controller lease duration
- controller heartbeat interval
- lease transfer confirmation model
- symlink workspace policy
- environment allowlist and denylist
- exact process-tree cleanup implementation
- audit retention duration
- audit storage location
- security event severity taxonomy
- service-worker integrity and update strategy
- xterm.js escape-sequence restrictions
- external-link handling
- gateway crash orphan detection
- administrator revocation workflow

These remain unresolved and must not be silently implemented.

---

## 25. Recommended next artifact

The next Phase 0 artifact should be:

```text
docs/PROTOCOL.md
```

It should define:

- exact message catalog
- HTTPS control operations
- WebSocket envelopes
- authentication and authorization requirements
- lease-bearing messages
- replay sequence rules
- lifecycle events
- size limits
- error taxonomy
- compatibility behavior
- rejection behavior

Do not begin full terminal implementation until this threat model, protocol, PTY lifecycle, visual system, iPhone acceptance matrix, and architecture have been reviewed together.

---

## Phase 0 consistency reconciliation — authoritative security controls

**Reconciled:** 2026-07-24
**Precedence:** These controls supersede conflicting earlier assumptions.

- Reject complete WebSocket text frames above **64 KiB** and decoded terminal input above **48 KiB** before execution.
- Phase 1 supports one authorized attached browser client per terminal. No non-controller observer stream is authorized.
- Treat transport identity and terminal-attachment identity separately in authorization and audit records.
- On device-session expiry or revocation, immediately invalidate its lease generation. Reauthentication cannot silently restore control.
- Idle timeout is user-activity based: accepted input or explicit authorized keep-alive/session action only. Output, heartbeat, replay, and resize do not extend it.
- Rate-limit unauthenticated pairing status and expose only generic private-connection state, a user-safe host label, and pairing availability. Do not disclose canonical hostname, account, paths, detailed version, or diagnostics.
- Decode PTY bytes through a streaming UTF-8 decoder; buffer split code points; replace malformed sequences with U+FFFD; JSON-escape after decoding; sequence emitted chunks. Test NUL, ESC, malformed bytes, split multibyte input, and output floods.
- Before publishing public `FAILED`, disable input, revoke the lease, and complete one best-effort cleanup attempt in a private cleanup substate. Report cleanup outcome and residual-process uncertainty.
- Bind process cleanup to a terminal-owned identity containing PID, start time, optional process-group ID, and optional platform handle. Validate binding and anti-reuse evidence before force termination; never expose platform handles.
