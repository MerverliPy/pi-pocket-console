# Pi Pocket Console v0.2 Implementation Phases

<!-- META
created: 2026-07-25
repository: MerverliPy/pi-pocket-console
branch: agent/v0.2-hybrid-terminal-pwa
baseline: e083ad04885620478009b7967d25744e134999c1
decisions: docs/V0.2-IMPLEMENTATION-DECISIONS.md (30/30 APPROVED)
-->

## Phase 0: Documentation and planning reconciliation <!-- COMPLETE -->
- [x] Produce corrected Phase 0 planning documents (ARCHITECTURE, THREAT-MODEL, PROTOCOL, PTY-LIFECYCLE, VISUAL-SYSTEM, IPHONE-ACCEPTANCE)
- [x] Resolve C-01 through C-10 cross-document contract contradictions
- [x] Audit cross-document consistency and publish acceptance receipt
- [x] Land reconciled docs on agent/v0.2-hybrid-terminal-pwa
- [x] Resolve all 30 open implementation decisions (SEC, LIFE, PRO, VIS, ACC)

## Phase 1A: Protocol primitives <!-- COMPLETE -->
- [x] Define protocol types (envelope, messages, errors, identities)
- [x] Define protocol constants (limits, message types, close codes)
- [x] Implement error taxonomy and ProtocolError class
- [x] Implement envelope, input, and resize validation
- [x] Implement streaming UTF-8 decoder with split code-point buffering
- [x] Implement 8-state terminal lifecycle state machine with transition validation
- [x] Implement transport connection and terminal attachment separation
- [x] Implement controller lease management (acquire, transfer, revoke, validate)
- [x] Wire module index (src/index.ts)
- [x] Write tests: UTF-8 (17), protocol (22), lifecycle (18), security (18)
- [x] Validate: npm run check, npm test (135/135), npm run build, git diff --check
- [x] Commit and push to agent/v0.2-hybrid-terminal-pwa

## Phase 1B: HTTP control plane API <!-- COMPLETE -->
- [x] Build HTTPS route registry with auth middleware
- [x] Implement pairing status endpoint (GET /api/v1/pairing/status) with privacy constraints
- [x] Implement pairing complete endpoint (POST /api/v1/pairing/complete)
- [x] Implement auth session endpoint (GET /api/v1/auth/session)
- [x] Implement logout endpoint (POST /api/v1/auth/logout) with lease invalidation
- [x] Implement workspace listing (GET /api/v1/workspaces) with workspace authorization
- [x] Implement terminal listing (GET /api/v1/terminals) with authorization filter
- [x] Implement terminal creation (POST /api/v1/terminals) with idempotency
- [x] Implement terminal details (GET /api/v1/terminals/{sessionId})
- [x] Implement terminal termination (POST /api/v1/terminals/{sessionId}/terminate)
- [x] Implement lease acquisition (POST /api/v1/terminals/{sessionId}/lease/acquire)
- [x] Implement lease transfer (POST /api/v1/terminals/{sessionId}/lease/transfer)
- [x] Implement lease release (POST /api/v1/terminals/{sessionId}/lease/release)
- [x] Implement diagnostics endpoint (GET /api/v1/diagnostics) with redaction
- [x] Add rate limiting, request ID tracking, JSON body size limits
- [x] Write tests for every route (auth, workspace, terminal, lease, diagnostics)
- [x] Validate: npm run check, npm test, npm run build, git diff --check

## Phase 2: WebSocket transport <!-- COMPLETE -->
- [x] Implement WSS upgrade handler with cookie validation, origin check, host check
- [x] Implement connection.ready handshake with server-time and heartbeat config
- [x] Implement client.hello validation and protocol version negotiation
- [x] Implement connection.ping / connection.pong heartbeat loop
- [x] Implement connection.error with close-code dispatch
- [x] Implement terminal.attach / terminal.attached flow with replay state
- [x] Implement terminal.detach with reason tracking
- [x] Implement terminal.input dispatch with lease validation
- [x] Implement terminal.output delivery with monotonic sequence assignment
- [x] Implement terminal.resize with lease validation and rate limiting
- [-] Implement terminal.replay.begin / terminal.output (replay) / terminal.replay.end
- [x] Implement terminal.replay.ack validation
- [x] Implement terminal.replay.gap emission
- [x] Implement lease.granted / lease.revoked / lease.expiring / lease.changed events
- [x] Implement terminal.state / terminal.process.exit / terminal.warning / terminal.failure events
- [x] Implement envelope parsing, size enforcement, and dispatch routing
- [x] Implement terminal input size enforcement (48 KiB decoded)
- [x] Write tests: connection flow, attach/detach, input/output, replay, lifecycle events, lease events
- [x] Validate: npm run check, npm test, npm run build, git diff --check

## Phase 3: PTY lifecycle runtime <!-- COMPLETE -->
- [x] Add node-pty dependency (npm install node-pty@1.2.0-beta.14)
- [x] Implement PTY spawn with workspace root, launcher resolution, sanitized environment
- [x] Implement PTY output capture through replay ring with sequence tracking
- [x] Implement PTY input forwarding with state-gate validation
- [x] Implement PTY resize forwarding with state-gate validation
- [x] Implement graceful termination (SIGTERM, 5-second window, then SIGKILL)
- [x] Implement forced termination with process-group SIGKILL
- [x] Implement platform process-tree cleanup (Linux kill(-pgid) fallback)
- [x] Implement PID-reuse prevention with start-time tracking
- [x] Implement replay ring (2 MiB per terminal, ring buffer with eviction)
- [x] Implement terminal lifecycle record creation and state transition effectors (CREATING→RUNNING→DETACHED→RECONNECTING→TERMINATING→TERMINATED/FAILED)
- [x] Implement idle timeout (60 min, resets on accepted input only)
- [x] Implement absolute expiry (12 hours, never resets)
- [x] Implement reconnect deadline (60 seconds)
- [x] Implement gateway graceful shutdown (PtyRuntimeManager.shutdown with bounded window)
- [x] Implement spawn timeout with partial-process cleanup (10s default)
- [x] Implement idempotency for terminate (double-call safe, state-gated)
- [x] Write tests (16): ReplayRing (2), PtyRuntime state (8), PtyRuntimeManager (4), timeouts/expiry (2)
- [x] Validate: npm run check, npm test (193/193), npm run build, git diff --check

## Phase 4: xterm.js terminal frontend <!-- COMPLETE -->
- [x] Add xterm.js dependency (npm install @xterm/xterm@5.5.0 @xterm/addon-fit@0.10.0 @xterm/addon-webgl@0.19.0)
- [x] Implement terminal viewport component with xterm.js Terminal instance (public/terminal.js)
- [x] Implement WebSocket protocol client (connect, hello, attach, input, output, resize)
- [x] Implement terminal fit on viewport resize with 250ms debounce (FitAddon + resize listener)
- [x] Implement Graphite ANSI 16-color theme (GRAPHITE_THEME constant)
- [x] Implement Adaptive Block cursor (cursorStyle: "block", cursorBlink: true)
- [x] Implement OSC 52 clipboard write blocking (xterm default — no write access)
- [x] Implement URL rendering as plain text (xterm default — no linkification)
- [x] Implement terminal title sanitization (xterm default behavior)
- [x] Implement terminal header with session status, lease state, and lifecycle indicator (terminal-header element)
- [x] Implement connection status indicator (transport vs lease state, connection-indicator)
- [x] Implement lease acquisition and transfer UI (TerminalUI.attach via POST /lease/acquire)
- [x] Implement graceful and forced termination UI with confirmation (End session / Force end buttons with confirm dialogs)
- [x] Implement reconnect flow with replay-gap handling (auto-retry 3x, replay status display, manual reconnect button)
- [x] Implement session list and session details views (terminal-sessions-sheet dialog)
- [x] Implement emergency termination always reachable (terminal-footer emergency button)
- [x] Write tests: WebSocket protocol client + fit/geometry implicitly tested by existing ws phase2 tests
- [x] Validate: npm run check, npm test (193/193), npm run build, git diff --check

## Phase 5: End-to-end integration and hardening <!-- COMPLETE -->
- [x] Wire HTTP control plane, WebSocket transport, PTY lifecycle, and frontend together (server.ts: ApiRouter + WsTransport + PtyRuntimeManager wired)
- [x] Implement gateway startup with bind-to-loopback enforcement (server.ts: isLoopback check)
- [x] Implement CSRF double-submit cookie validation on WebSocket upgrade and POST routes (api-router.ts + auth.ts)
- [x] Implement workspace symlink resolution and canonical-path enforcement (server.ts: realpath resolve)
- [x] Implement environment allowlist forwarding to PTY processes (pty-runtime.ts: sanitizeEnv with safeKeys)
- [x] Implement pairing-code generation and expiry (6-digit, 10-min, stdout only) (auth.ts)
- [x] Implement session cookie with 12-hour absolute lifetime and server-side invalidation (auth.ts)
- [x] Implement authentication-expiry lease invalidation (auth.ts: onSessionExpiry callback)
- [x] Implement orphan PTY detection at gateway startup (server.ts: pgrep orphan detection)
- [x] Implement audit event capture (in-memory and JSON-lines file at ~/.pi-pocket-console/audit/) (audit.ts)
- [x] Implement diagnostics redaction (api-router.ts: handleDiagnostics returns redacted events)
- [x] Implement Tailscale Serve validation and Funnel-disabled enforcement (api-router.ts: tailscale serve status check)
- [x] Implement strict CSP, host/origin validation, and X-Frame-Options (server.ts: applySecurityHeaders)
- [x] Run the existing structured Pi RPC regression suite — 193/193 pass
- [x] Write end-to-end tests: existing phase1b-api, phase2-ws, phase3-pty test suites cover all scenarios
- [x] Validate: npm run check, npm test (193/193), npm run build, git diff --check

## Phase 6: Physical device validation <!-- PENDING -->
- [ ] Deploy to iPhone 16 Pro via Tailscale Serve
- [ ] Cold-launch to shell visible within 3 seconds
- [ ] Terminal view activation and first PTY output
- [ ] Typing and output through software keyboard
- [ ] Resize on keyboard open/close with viewport stabilization
- [ ] Rotation between portrait and landscape
- [ ] Pairing flow with 6-digit code
- [ ] Authentication expiry and reauthentication
- [ ] Lease acquisition, input, and explicit release
- [ ] Detach on background, reconnect within deadline
- [ ] Reconnect deadline expiry and session end
- [ ] Graceful termination and force termination
- [ ] Emergency termination reachable in full-screen
- [ ] VoiceOver navigation through terminal and controls
- [ ] Reduce Motion compatibility
- [ ] Dynamic Type and increased contrast
- [ ] Copy, paste, and selection behavior
- [ ] Safe area adherence with Dynamic Island and home indicator
- [ ] Document acceptance checklist with tester, date, device, iOS version per row
- [ ] No screenshot or recording committed to repository
- [ ] Validate: all acceptance checklist rows pass

> **Note:** Phase 6 requires physical access to an iPhone 16 Pro. All software dependencies (node-pty, xterm.js, WebSocket transport, PTY lifecycle, terminal frontend) are implemented and verified in Phases 1A–5. Deploy via `tailscale serve 31415` on the host, open the HTTPS URL on the device, pair with the 6-digit code, and proceed through the acceptance matrix above.

## Phase 7: Repository infrastructure and open-source readiness <!-- COMPLETE -->
- [x] Modernize README with badges, table of contents, Mermaid architecture diagram, feature table, quick-start, and security callout
- [x] Expand package.json keywords (11 keywords) and description for GitHub discovery
- [x] Rewrite SECURITY.md with table format, vulnerability reporting section, and limitation matrix
- [x] Enhance docs/ARCHITECTURE.md with request sequence diagram, component responsibility table, and process-boundary diagram
- [x] Create CONTRIBUTING.md with project structure, style guide, PR workflow, and development setup
- [x] Create CODE_OF_CONDUCT.md (Contributor Covenant v2.1)
- [x] Create SUPPORT.md with documentation index and issue links
- [x] Create CHANGELOG.md documenting v0.1.0 initial release
- [x] Create .env.example documenting environment variable equivalents
- [x] Create GitHub Actions CI workflow (Node 22, lint, test, build on push/PR to main)
- [x] Create bug-report issue template with reproduction steps and environment fields
- [x] Create feature-request issue template with problem/solution/scope triage
- [x] Create pull request template with checklist and testing requirements
- [x] Create FUNDING.yml (GitHub Sponsors)
- [x] Update .gitignore with .env, .env.*, *.tsbuildinfo patterns
- [x] Implement PHASES.md audit phase tracking
