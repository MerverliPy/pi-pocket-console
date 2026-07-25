# Pi Pocket Console v0.2 Cross-Document Consistency Audit

**Status:** Phase 0 planning review
**Audit date:** 2026-07-24
**Scope:** Six required Phase 0 planning documents plus the prior visual-system audit
**Result:** **PASS WITH REQUIRED CONTRACT CORRECTIONS**
**Implementation authorization:** **NOT GRANTED**
**Repository-write authorization:** **NOT GRANTED**

---

## 1. Executive determination

The Phase 0 document set is substantially aligned on the product architecture, security boundary, terminal lifecycle, controller-lease model, bounded replay, offline behavior, structured-controller preservation, and iPhone-first visual direction.

No contradiction was found that invalidates the overall v0.2 architecture.

However, implementation should not begin until the contract corrections in this audit are resolved. Three findings affect protocol or lifecycle correctness directly:

1. The maximum WebSocket message and maximum terminal input payload are both `64 KiB`, leaving no room for the JSON envelope.
2. Phase 1 simultaneously defers read-only viewers while defining messages for authorized non-controller clients.
3. `FAILED` cleanup behavior and transitions are not fully canonical across the state graph, invariants, and open decisions.

Several architecture “unresolved” items are also stale because `PROTOCOL.md` now defines them.

---

## 2. Audited artifact identities

| Artifact | SHA-256 |
|---|---|
| `docs/ARCHITECTURE.md` | `ba74805309d7c3b68d9188495c9e1999690a8787fa58823a8bc5e3f646053f13` |
| `docs/THREAT-MODEL.md` | `106f432a3209995b51520324f8ec06bba27bcf1c4eca664bbcde36053be43b6b` |
| `docs/PROTOCOL.md` | `7280c509a716dc13a31e07fbbcf5a70d77b549c6d1338f8a5a77b038e16099eb` |
| `docs/PTY-LIFECYCLE.md` | `388df1420514db8a5d34c625ad9366052b389e75dbb2043a105f357ba0b7fd54` |
| `docs/VISUAL-SYSTEM.md` | `e8b7c8e0c54cafafd491aa787946005dad968eafeada7a11188f660a09da5741` |
| `docs/IPHONE-ACCEPTANCE.md` | `6fed175c51872cbb89111d000e957b4a9c7c61615548f10259184309a33bb833` |
| `docs/VISUAL-SYSTEM-AUDIT.md` | `d8c38efe0b4b88c1ad1170cd433d183700d078e6e1d91b3ab68992746a19dc1f` |

These hashes identify the exact uploaded files reviewed by this audit.

---

## 3. Cross-document alignment matrix

| Contract area | Architecture | Threat model | Protocol | PTY lifecycle | Visual system | iPhone acceptance | Result |
|---|---|---|---|---|---|---|---|
| Immutable `0.1.0` baseline | yes | yes | yes | yes | branch only | yes | aligned |
| v0.2 branch | yes | yes | yes | yes | yes | yes | aligned |
| Structured Console preserved | yes | yes | yes | indirect | yes | yes | aligned |
| Tailscale Serve only | yes | yes | yes | indirect | presentation | tests | aligned |
| Gateway loopback bind | yes | yes | yes | indirect | n/a | diagnostics/tests | aligned |
| One writable controller | yes | yes | yes | yes | yes | yes | aligned |
| Explicit lease transfer | yes | yes | yes | yes | yes | yes | aligned |
| Bounded replay | yes | yes | yes | yes | yes | yes | aligned |
| Replay gaps explicit | yes | yes | yes | yes | yes | yes | aligned |
| No silent input retry | yes | yes | yes | yes | yes | yes | aligned |
| 60-second reconnect | provisional | security policy | provisional | provisional | recovery UI | tests | aligned |
| Process-tree cleanup | yes | yes | protocol outcome | detailed | emergency UI | tests | aligned |
| Gateway restart restoration deferred | yes | yes | open future | yes | n/a | no false claim | aligned |
| Browser secret-storage prohibition | yes | yes | yes | audit only | yes | storage audit | aligned |
| iPhone authoritative | yes | covered | platform enum | physical flow | yes | yes | aligned |
| Emergency termination reachable | yes | yes | acceptance gate | lifecycle action | yes | yes | aligned |

---

## 4. Required contract corrections

## C-01 — WebSocket frame and input payload limit collision

**Severity:** High
**Status:** Resolved in the 2026-07-24 reconciliation pass

`PROTOCOL.md` sets:

- maximum WebSocket message: `64 KiB`
- maximum terminal input payload: `64 KiB`

A JSON `terminal.input` message also contains the protocol envelope, session ID, request ID, lease ID, generation, property names, quoting, and escaping. A `64 KiB` data payload therefore cannot fit inside a `64 KiB` complete message.

### Required correction

Choose and state one canonical interpretation:

**Recommended:**

```text
Maximum WebSocket text frame: 64 KiB
Maximum decoded terminal input data: 48 KiB
```

This leaves bounded space for envelope overhead and JSON escaping.

Alternative: define the `64 KiB` input limit as the complete encoded message limit, not the `data` field. Do not leave both values equal without scope definitions.

### Documents to update

- `docs/PROTOCOL.md`
- `docs/ARCHITECTURE.md`
- `docs/PTY-LIFECYCLE.md`
- `docs/THREAT-MODEL.md` where test assumptions rely on the limit

---

## C-02 — Deferred read-only viewers versus non-controller client events

**Severity:** High
**Status:** Resolved in the 2026-07-24 reconciliation pass

The architecture says read-only viewers are deferred and the lifecycle describes zero or one active WebSocket attachment. `PROTOCOL.md` nevertheless defines:

```text
lease.changed
```

for “authorized non-controller clients.”

This implies supported simultaneous non-controller attachments or observers.

### Required correction

For Phase 1, choose one:

**Recommended:**

- Remove `lease.changed` delivery to non-controller clients from the Phase 1 message catalog.
- Permit one attached browser client per terminal.
- Keep multi-viewer observation and its event model explicitly deferred.

Alternative: formally authorize multiple attached read-only clients in Phase 1 and update architecture, lifecycle, threat model, resource limits, privacy rules, and tests. This materially expands scope and is not recommended.

### Documents to update

- `docs/PROTOCOL.md`
- `docs/ARCHITECTURE.md`
- `docs/PTY-LIFECYCLE.md`
- `docs/THREAT-MODEL.md`

---

## C-03 — Canonical `FAILED` cleanup path

**Severity:** High
**Status:** Resolved in the 2026-07-24 reconciliation pass

The lifecycle says:

- any active state may transition to `FAILED`
- `FAILED` may still require best-effort cleanup
- `FAILED` must not return to `RUNNING`
- an open decision asks whether `FAILED` may transition to `TERMINATING` internally

This leaves two possible implementations:

1. cleanup completes before entering `FAILED`
2. `FAILED` is entered first, followed by a cleanup transition

The state graph does not define the second route.

### Required correction

**Recommended canonical rule:**

- On unrecoverable error, atomically disable input and revoke lease.
- Perform best-effort cleanup through an internal cleanup substate not exposed as a public lifecycle state.
- Publish final `FAILED` only after cleanup attempt completes.
- Include `processMayStillBeActive` and `cleanupResult` in the failure record.
- `FAILED` remains terminal in the public state machine.

This keeps the eight-state public contract stable.

### Documents to update

- `docs/PTY-LIFECYCLE.md`
- `docs/PROTOCOL.md`
- `docs/ARCHITECTURE.md`
- `docs/THREAT-MODEL.md`

---

## C-04 — Stale unresolved items in architecture

**Severity:** Medium
**Status:** Resolved in the 2026-07-24 reconciliation pass

`ARCHITECTURE.md` still lists these as unresolved even though `PROTOCOL.md` defines them:

- exact HTTPS API routes
- exact WebSocket message catalog
- exact error-code taxonomy
- replay-gap response structure

### Required correction

Replace those items with:

```text
Defined provisionally by docs/PROTOCOL.md; subject to cross-document review and implementation validation.
```

Do not keep them classified as wholly unresolved.

The following architecture items remain genuinely unresolved:

- pairing code format and expiry
- cookie duration and renewal
- lease duration and heartbeat
- symlink policy
- environment allowlist and denylist
- platform process-tree termination
- gateway crash orphan detection
- post-validation resource limits
- renderer fallback
- desktop breakpoints
- gateway restart restoration

---

## C-05 — Attach, detach, and lifecycle semantics need a sharper boundary

**Severity:** Medium
**Status:** Resolved in the 2026-07-24 reconciliation pass

`terminal.detach` can represent navigation, backgrounding, manual detach, or shutdown. The lifecycle defines `DETACHED` as having no active controlling WebSocket attachment. A global application WebSocket may remain connected while a user navigates away from the Terminal destination.

### Required correction

Define two distinct concepts:

```text
Transport connection: application WebSocket connected/disconnected
Terminal attachment: client subscribed/unsubscribed to one terminal
```

Recommended Phase 1 behavior:

- `terminal.detach` removes that terminal attachment.
- Terminal lifecycle becomes `DETACHED` only when no authorized controlling attachment remains.
- A global WebSocket remaining open does not keep the terminal in `RUNNING` by itself.
- Navigating away may detach or retain attachment according to explicit client policy; it must not be inferred from route change alone.

Update the lifecycle record to track attachment identity separately from transport identity.

---

## C-06 — Lease expiry and authentication expiry interaction

**Severity:** Medium
**Status:** Resolved in the 2026-07-24 reconciliation pass

The documents agree that authentication expiry disables input and that reconnect does not silently restore a lease. They do not fully define whether a lease is immediately revoked when the owning device session expires.

### Required correction

**Recommended rule:**

- Device-session expiry immediately makes the lease unusable.
- Gateway increments or invalidates the lease generation.
- The PTY may remain alive according to terminal policy.
- Reauthentication does not restore the prior writable lease automatically.
- Explicit reacquisition or transfer is required.

Add this to the lease, lifecycle, protocol, security, and iPhone acceptance contracts.

---

## C-07 — Idle activity definition

**Severity:** Medium
**Status:** Resolved in the 2026-07-24 reconciliation pass

`PTY-LIFECYCLE.md` lists accepted input, output, resize, reconnect, and explicit interaction as possible activity, while stating that heartbeat should not necessarily reset idle expiry.

Counting PTY output as user activity can keep a noisy unattended process alive indefinitely until absolute expiry.

### Required correction

**Recommended rule:**

Terminal idle expiry resets only on:

- accepted user input
- authorized explicit keep-alive/session action
- optional administrator-approved interaction

It does not reset on:

- PTY output alone
- transport heartbeat
- replay delivery
- resize alone

Absolute expiry remains unaffected by all activity.

---

## C-08 — Pairing-status endpoint privacy

**Severity:** Medium
**Status:** Resolved in the 2026-07-24 reconciliation pass

`GET /api/v1/pairing/status` returns host identity and gateway availability before pairing. That is useful for onboarding, but the amount of pre-authentication information is not bounded.

### Required correction

Define a minimal pre-auth response:

- generic verified private-connection status
- user-safe host display label
- pairing availability
- no canonical hostname, paths, version detail, account name, or diagnostic internals

Rate-limit the endpoint and prevent it from becoming an unauthenticated diagnostics surface.

---

## C-09 — JSON terminal output and control-character handling

**Severity:** Medium
**Status:** Resolved in the 2026-07-24 reconciliation pass

Phase 1 uses JSON text frames for arbitrary PTY output. Control characters and invalid byte sequences need deterministic encoding.

### Required correction

Define:

- PTY bytes are decoded using a streaming UTF-8 decoder.
- Invalid sequences use a documented replacement/error policy.
- JSON escaping is applied after decoding.
- Split multibyte code points are buffered across PTY reads.
- Output sequencing applies to emitted protocol chunks, not raw OS read calls.
- Raw bytes or binary framing remain deferred.

Add tests for split UTF-8, NUL, escape, high-volume output, and malformed byte sequences.

---

## C-10 — Process identity fields in lifecycle records

**Severity:** Medium
**Status:** Resolved in the 2026-07-24 reconciliation pass

The suggested lifecycle record includes PID and process-group ID. The same document correctly says not to rely only on a reusable numeric PID.

### Required correction

Make process identity an internal structured handle:

```ts
interface OwnedProcessIdentity {
  pid: number;
  processGroupId?: number;
  startedAt: string;
  platformHandle?: string;
}
```

Never expose `platformHandle` to the client. Require session binding and creation-time validation before forced cleanup.

---

## 5. Consistent provisional limits

The following limits are consistent across the planning set:

| Resource | Provisional value | Result |
|---|---:|---|
| Replay buffer | `2 MiB per terminal` | aligned |
| Active terminals per device | `3` | aligned |
| Global active terminals | `10` | aligned |
| Reconnect deadline | `60 seconds` | aligned |
| Resize rate | `10 events/second` | aligned |
| Pairing attempts | `5 per 10 minutes` | aligned |
| Graceful termination | `5 seconds` | aligned |
| Absolute session duration | `12 hours` | aligned |
| Idle timeout | `60 minutes` | aligned |
| Maximum message/input | `64 KiB` | scope conflict; correct under C-01 |

All remain provisional and require implementation, load, and physical-device validation.

---

## 6. Visual and iPhone consistency

The visual and iPhone documents align on:

- iPhone 16 Pro authority
- six destinations
- Precision Cyan
- Balanced Precision
- Precision Compact
- Terminal Aperture
- Guided Security Steps
- Dense Native Rows
- Operational Rows
- Adaptive Block cursor
- Graphite ANSI
- functional micro-illustrations
- progressive terminal-first desktop expansion
- approximately `44 × 44 CSS px` primary touch targets
- no color-only critical state
- no hidden emergency termination
- no silent offline execution
- physical-device acceptance requirement

The previous visual audit remains valid: physical viewport, VoiceOver/xterm.js, contrast, terminal cell geometry, six-item navigation density, and keyboard-space pressure remain validation blockers rather than written contradictions.

---

## 7. Open-decision consolidation

The repeated open decisions should be consolidated into one future decision register with stable IDs.

Recommended categories:

### Security

- `SEC-001` Pairing code format, entropy, and expiry
- `SEC-002` Cookie lifetime and renewal
- `SEC-003` CSRF mechanism
- `SEC-004` Symlink policy
- `SEC-005` Environment allowlist/denylist
- `SEC-006` Audit retention and storage
- `SEC-007` Escape-sequence and external-link policy

### Lease and lifecycle

- `LIFE-001` Lease duration and heartbeat
- `LIFE-002` Lease behavior during short detach
- `LIFE-003` Idle activity definition
- `LIFE-004` Shutdown timeout
- `LIFE-005` Platform process-tree termination
- `LIFE-006` Orphan detection
- `LIFE-007` tmux attach/create lifecycle
- `LIFE-008` Metadata and replay retention

### Protocol

- `PRO-001` Idempotency retention window
- `PRO-002` Terminal dimensions
- `PRO-003` JSON versus future binary output
- `PRO-004` Close-code finalization
- `PRO-005` Gateway restart restoration

### Visual and device validation

- `VIS-001` Exact Graphite ANSI palette
- `VIS-002` Contrast matrix
- `VIS-003` Terminal cell geometry
- `VIS-004` Viewport stabilization algorithm
- `VIS-005` Responsive breakpoints
- `VIS-006` Haptic support and fallback
- `VIS-007` Supported iOS range
- `VIS-008` Performance and memory budgets

---

## 8. Corrective sequence

Before repository write or implementation:

1. Resolve C-01 through C-10 in a single reconciliation pass.
2. Update all affected documents together.
3. Add a central open-decision register.
4. Re-run exact-string and semantic consistency checks.
5. Produce a Phase 0 acceptance summary with:
   - no unresolved contract contradiction
   - all remaining unknowns explicitly deferred
   - source-file hashes
6. Verify repository identity, authenticated GitHub owner, `main` baseline commit, tree, and target branch.
7. Only then prepare a planning-only commit for explicit approval.
8. Do not add xterm.js or `node-pty` in the planning-only commit.

---

## 9. Final result

**Cross-document result:** PASS WITH REQUIRED CONTRACT CORRECTIONS

**Critical architecture invalidation:** None.

**Implementation blockers:** C-01, C-02, and C-03.

**Planning cleanup required:** C-04 through C-10.

**Remote repository writes performed:** No.

**Implementation performed:** No.

**Recommended next artifact:** A reconciled Phase 0 document package plus a `PHASE-0-CONSISTENCY-ACCEPTANCE.md` receipt.

---

## 11. Reconciliation disposition — 2026-07-24

C-01 through C-10 are resolved in the corrected planning set. The authoritative rules are repeated in scoped reconciliation sections in each affected document. No cross-document contract contradiction remains in the reviewed Phase 0 scope. Implementation dependencies and remote repository writes remain unauthorized.
