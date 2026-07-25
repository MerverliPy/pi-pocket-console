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

## Phase 1B: HTTP control plane API <!-- IN_PROGRESS -->
- [ ] Build HTTPS route registry with auth middleware
- [ ] Implement pairing status endpoint (GET /api/v1/pairing/status) with privacy constraints
- [ ] Implement pairing complete endpoint (POST /api/v1/pairing/complete)
- [ ] Implement auth session endpoint (GET /api/v1/auth/session)
- [ ] Implement logout endpoint (POST /api/v1/auth/logout) with lease invalidation
- [ ] Implement workspace listing (GET /api/v1/workspaces) with workspace authorization
- [ ] Implement terminal listing (GET /api/v1/terminals) with authorization filter
- [ ] Implement terminal creation (POST /api/v1/terminals) with idempotency
- [ ] Implement terminal details (GET /api/v1/terminals/{sessionId})
- [ ] Implement terminal termination (POST /api/v1/terminals/{sessionId}/terminate)
- [ ] Implement lease acquisition (POST /api/v1/terminals/{sessionId}/lease/acquire)
- [ ] Implement lease transfer (POST /api/v1/terminals/{sessionId}/lease/transfer)
- [ ] Implement lease release (POST /api/v1/terminals/{sessionId}/lease/release)
- [ ] Implement diagnostics endpoint (GET /api/v1/diagnostics) with redaction
- [ ] Add rate limiting, request ID tracking, JSON body size limits
- [ ] Write tests for every route (auth, workspace, terminal, lease, diagnostics)
- [ ] Validate: npm run check, npm test, npm run build, git diff --check

## Phase 2: WebSocket transport
- [ ] Implement WSS upgrade handler with cookie validation, origin check, host check
- [ ] Implement connection.ready handshake with server-time and heartbeat config
- [ ] Implement client.hello validation and protocol version negotiation
- [ ] Implement connection.ping / connection.pong heartbeat loop
- [ ] Implement connection.error with close-code dispatch
- [ ] Implement terminal.attach / terminal.attached flow with replay state
- [ ] Implement terminal.detach with reason tracking
- [ ] Implement terminal.input dispatch with lease validation
- [ ] Implement terminal.output delivery with monotonic sequence assignment
- [ ] Implement terminal.resize with lease validation and rate limiting
- [ ] Implement terminal.replay.begin / terminal.output (replay) / terminal.replay.end
- [ ] Implement terminal.replay.ack validation
- [ ] Implement terminal.replay.gap emission
- [ ] Implement lease.granted / lease.revoked / lease.expiring / lease.changed events
- [ ] Implement terminal.state / terminal.process.exit / terminal.warning / terminal.failure events
- [ ] Implement envelope parsing, size enforcement, and dispatch routing
- [ ] Implement terminal input size enforcement (48 KiB decoded)
- [ ] Write tests: connection flow, attach/detach, input/output, replay, lifecycle events, lease events
- [ ] Validate: npm run check, npm test, npm run build, git diff --check

## Phase 3: PTY lifecycle runtime
- [ ] Add node-pty dependency (npm install node-pty @types/node-pty)
- [ ] Implement PTY spawn with workspace root, launcher resolution, sanitized environment
- [ ] Implement PTY output capture through streaming UTF-8 decoder
- [ ] Implement PTY input forwarding with lease validation gate
- [ ] Implement PTY resize forwarding with lease validation gate and rate limiting
- [ ] Implement graceful termination (SIGTERM, 5-second window, then SIGKILL)
- [ ] Implement forced termination with owned-process-identity validation
- [ ] Implement platform process-tree cleanup (Linux kill(-pgid), macOS, Windows)
- [ ] Implement PID-reuse prevention with start-time and platform-handle validation
- [ ] Implement replay ring (2 MiB per terminal, circular buffer)
- [ ] Implement terminal lifecycle record creation and state transition effectors
- [ ] Implement idle timeout (60 min, resets on accepted input only)
- [ ] Implement absolute expiry (12 hours, never resets)
- [ ] Implement reconnect deadline (60 seconds)
- [ ] Implement gateway graceful shutdown (stop accept, terminate PTYs, bounded window)
- [ ] Implement spawn timeout with partial-process cleanup
- [ ] Implement idempotency for terminal creation and termination
- [ ] Write tests: spawn lifecycle, input/output, resize, termination, expiry, replay, cleanup, idempotency, gateway shutdown
- [ ] Validate: npm run check, npm test, npm run build, git diff --check

## Phase 4: xterm.js terminal frontend
- [ ] Add xterm.js dependency (npm install @xterm/xterm @xterm/addon-fit @xterm/addon-webgl)
- [ ] Implement terminal viewport component with xterm.js Terminal instance
- [ ] Implement WebSocket protocol client (connect, hello, attach, input, output, resize)
- [ ] Implement terminal fit on viewport resize with 250ms debounce
- [ ] Implement Graphite ANSI 16-color theme
- [ ] Implement Adaptive Block cursor
- [ ] Implement OSC 52 clipboard write blocking
- [ ] Implement URL rendering as plain text (no auto-linkification)
- [ ] Implement terminal title sanitization (printable chars only)
- [ ] Implement terminal header with session status, lease state, and lifecycle indicator
- [ ] Implement connection status indicator (transport vs attachment vs control)
- [ ] Implement lease acquisition and transfer UI
- [ ] Implement graceful and forced termination UI with confirmation
- [ ] Implement reconnect flow with replay-gap handling
- [ ] Implement session list and session details views
- [ ] Implement emergency termination always reachable
- [ ] Write tests: fit/geometry, color rendering, cursor, escape sequences, clipboard, WebSocket client
- [ ] Validate: npm run check, npm test, npm run build, git diff --check

## Phase 5: End-to-end integration and hardening
- [ ] Wire HTTP control plane, WebSocket transport, PTY lifecycle, and frontend together
- [ ] Implement gateway startup with bind-to-loopback enforcement
- [ ] Implement CSRF double-submit cookie validation on WebSocket upgrade and POST routes
- [ ] Implement workspace symlink resolution and canonical-path enforcement
- [ ] Implement environment allowlist forwarding to PTY processes
- [ ] Implement pairing-code generation and expiry (6-digit, 10-min, stdout only)
- [ ] Implement session cookie with 12-hour absolute lifetime and server-side invalidation
- [ ] Implement authentication-expiry lease invalidation
- [ ] Implement orphan PTY detection at gateway startup
- [ ] Implement audit event capture (in-memory and JSON-lines file at ~/.pi-pocket-console/audit/)
- [ ] Implement diagnostics redaction (no secrets, pairing codes, cookies, raw output)
- [ ] Implement Tailscale Serve validation and Funnel-disabled enforcement
- [ ] Implement strict CSP, host/origin validation, and X-Frame-Options
- [ ] Run the existing structured Pi RPC regression suite and verify no breakage
- [ ] Write end-to-end tests: creation-to-termination, detach-reconnect, lease-transfer, force-termination, expiry
- [ ] Validate: npm run check, npm test, npm run build, git diff --check

## Phase 6: Physical device validation
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
