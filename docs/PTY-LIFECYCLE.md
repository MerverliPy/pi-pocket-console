# Pi Pocket Console v0.2 PTY Lifecycle Specification

**Status:** Phase 0 planning baseline
**Product:** Pi Pocket Console v0.2
**Protocol version:** `1`
**Implementation branch:** `agent/v0.2-hybrid-terminal-pwa`
**Published baseline:** `0.1.0` at commit `e083ad04885620478009b7967d25744e134999c1`

---

## 1. Purpose

This document defines the authoritative PTY lifecycle for Pi Pocket Console v0.2.

It specifies:

- terminal states
- state invariants
- authorized transitions
- controller-lease requirements
- process behavior
- replay behavior
- reconnect behavior
- cleanup deadlines
- graceful termination
- forced termination
- expiry
- failures
- gateway shutdown
- audit events
- client-visible status
- idempotency
- race handling
- acceptance tests

The gateway is authoritative for lifecycle state. Clients may display state but may not invent, infer, or override it.

---

## 2. Lifecycle goals

The lifecycle must:

1. Prevent ambiguous terminal state.
2. Prevent input after termination begins.
3. Prevent stale clients from controlling a PTY.
4. Survive temporary transport loss without immediate PTY death.
5. Bound reconnect duration.
6. Bound replay memory.
7. Make replay gaps explicit.
8. Clean up nonpersistent process trees.
9. Distinguish detached from terminated.
10. Distinguish expired from failed.
11. Preserve explicit tmux persistence semantics.
12. Avoid claiming gateway restart restoration in Phase 1.
13. Produce deterministic audit events.
14. Support idempotent termination.
15. Never silently queue input for later execution.

---

## 3. State model

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

Canonical state graph:

```text
CREATING
   │
   ├─ spawn succeeds
   ▼
RUNNING ────────────────► TERMINATING ─────────► TERMINATED
   │                          │
   │                          └─ cleanup failure ─► FAILED
   │
   ├─ transport loss
   ▼
DETACHED
   │
   ├─ authorized reconnect begins
   ▼
RECONNECTING ───────────► RUNNING
   │
   ├─ reconnect deadline exceeded
   ▼
EXPIRED ────────────────► TERMINATING ─────────► TERMINATED

Any active state may transition to FAILED when an unrecoverable error occurs.
```

---

## 4. State invariants

## 4.1 `CREATING`

A terminal in `CREATING`:

- has passed authentication and authorization
- has an allocated terminal session identifier
- does not yet accept terminal input
- does not yet accept resize
- may have a pending PTY spawn
- has no active replay output before PTY output begins
- may be terminated by an authorized request
- must reach `RUNNING`, `TERMINATING`, or `FAILED`

It must not remain indefinitely in `CREATING`.

---

## 4.2 `RUNNING`

A terminal in `RUNNING`:

- has a live PTY process
- may produce output
- may accept input only from the active lease holder
- may accept resize only from the active lease holder
- maintains bounded replay
- may have zero or one active WebSocket attachment
- may transition to `DETACHED` on transport loss
- may transition to `TERMINATING` on authorized termination
- may transition to `FAILED` on unrecoverable PTY failure

---

## 4.3 `DETACHED`

A terminal in `DETACHED`:

- has no active controlling WebSocket attachment
- may still have a live PTY process
- may continue producing output
- retains only bounded replay
- does not accept browser input
- does not automatically transfer lease
- has a reconnect deadline
- may reconnect to `RECONNECTING`
- may expire to `EXPIRED`
- may be terminated by an authorized control-plane request
- may fail to `FAILED`

Detached does not mean terminated.

---

## 4.4 `RECONNECTING`

A terminal in `RECONNECTING`:

- has an authenticated and authorized reconnecting client
- is synchronizing authoritative state
- may replay buffered output
- does not accept input until replay synchronization and lease validation complete
- may return to `RUNNING`
- may return to `DETACHED` if transport fails again
- may transition to `EXPIRED` if the deadline passes
- may transition to `FAILED` on unrecoverable error

---

## 4.5 `TERMINATING`

A terminal in `TERMINATING`:

- does not accept new terminal input
- does not accept resize
- has begun graceful or forced cleanup
- revokes or invalidates writable lease
- may still emit final output or lifecycle events
- must reach `TERMINATED` or `FAILED`
- must not return to `RUNNING`

---

## 4.6 `TERMINATED`

A terminal in `TERMINATED`:

- has no live nonpersistent PTY process
- has no writable lease
- accepts no input
- accepts no resize
- is not reconnectable
- may retain only bounded metadata according to retention policy
- may expose final exit status if available and safe
- must not transition to another active state

---

## 4.7 `EXPIRED`

A terminal in `EXPIRED`:

- exceeded reconnect, idle, or absolute policy
- accepts no input
- accepts no resize
- is not reconnectable
- proceeds to cleanup
- must transition to `TERMINATING`, `TERMINATED`, or `FAILED`
- must not return to `RUNNING`

`EXPIRED` is a policy outcome, not an implementation crash.

---

## 4.8 `FAILED`

A terminal in `FAILED`:

- encountered an unrecoverable lifecycle, PTY, cleanup, or gateway error
- accepts no input
- accepts no resize
- has no valid writable lease
- may still require best-effort cleanup
- must state whether the PTY may still be active
- must state whether anything executed
- must provide the safest next action
- must not return to `RUNNING` in Phase 1

---

## 5. Lifecycle record

Suggested authoritative record:

```ts
interface TerminalLifecycleRecord {
  sessionId: string;
  state: TerminalState;
  previousState?: TerminalState;
  workspaceId: string;
  launcherId: string;
  createdAt: string;
  stateChangedAt: string;
  lastActivityAt: string;
  reconnectDeadline?: string;
  idleExpiresAt?: string;
  absoluteExpiresAt?: string;
  terminationMode?: "graceful" | "force";
  terminalPid?: number;
  processGroupId?: number;
  leaseGeneration: number;
  lastOutputSequence: number;
  failureCode?: string;
}
```

Sensitive process information must not be exposed directly to clients unless approved by diagnostics policy.

---

## 6. Transition authorization

### 6.1 Authorized initiators

Possible initiators:

- authenticated user control-plane request
- active lease holder
- gateway policy timer
- PTY process event
- transport event
- gateway shutdown
- administrative revocation
- internal failure handler

### 6.2 Authorization rules

- terminal creation requires authenticated device session and workspace authorization
- input and resize require current lease
- graceful termination requires terminal authorization
- forced termination requires terminal authorization and explicit confirmation
- reconnect requires authenticated device session and terminal authorization
- lease transfer requires current authorization and matching generation
- policy expiry requires no client authorization
- gateway shutdown cleanup requires no client authorization

---

## 7. Transition table

| From | Event | To | Lease required | Process behavior | Replay behavior |
|---|---|---|---|---|---|
| none | authorized create | `CREATING` | no | allocate and spawn | initialize |
| `CREATING` | spawn success | `RUNNING` | no | PTY active | begin capture |
| `CREATING` | terminate request | `TERMINATING` | no | cancel or kill spawn | finalize |
| `CREATING` | spawn failure | `FAILED` | no | cleanup partial process | finalize |
| `RUNNING` | transport loss | `DETACHED` | no | keep alive | continue bounded capture |
| `RUNNING` | terminate request | `TERMINATING` | no | graceful or force | continue final capture |
| `RUNNING` | PTY exit | `TERMINATING` | no | cleanup handles | finalize |
| `RUNNING` | unrecoverable PTY error | `FAILED` | no | best-effort cleanup | preserve bounded evidence |
| `DETACHED` | reconnect begins | `RECONNECTING` | no | keep alive | prepare replay |
| `DETACHED` | reconnect deadline exceeded | `EXPIRED` | no | schedule cleanup | finalize/gap as applicable |
| `DETACHED` | terminate request | `TERMINATING` | no | graceful or force | finalize |
| `RECONNECTING` | replay synchronized | `RUNNING` | valid lease before input | keep alive | resume live stream |
| `RECONNECTING` | transport loss | `DETACHED` | no | keep alive | continue bounded capture |
| `RECONNECTING` | deadline exceeded | `EXPIRED` | no | schedule cleanup | finalize |
| `EXPIRED` | cleanup begins | `TERMINATING` | no | graceful then force | final only |
| `TERMINATING` | cleanup complete | `TERMINATED` | no | no process remains | close |
| `TERMINATING` | cleanup failure | `FAILED` | no | process may remain | close with warning |

---

## 8. Terminal creation lifecycle

### 8.1 Preconditions

Before entering `CREATING`, the gateway must verify:

- authenticated device session
- valid origin and host
- authorized workspace
- allowed launcher
- valid initial terminal dimensions
- per-device terminal limit
- global terminal limit
- resource availability
- valid idempotency key
- sanitized environment policy
- canonical working directory

### 8.2 Creation sequence

1. Allocate opaque terminal session ID.
2. Create lifecycle record in `CREATING`.
3. Initialize replay ring.
4. Initialize lease generation.
5. Resolve configured launcher.
6. Resolve canonical workspace root.
7. Build sanitized environment.
8. Spawn PTY.
9. Attach output handlers.
10. Attach exit and error handlers.
11. Record process identity.
12. Transition to `RUNNING`.
13. Emit `terminal.state`.
14. Return success to control plane.

### 8.3 Spawn timeout

The spawn operation must have a bounded timeout.

If timeout occurs:

- stop or kill partial process
- transition to `FAILED` or `TERMINATING`
- state `executed = "unknown"` if process creation may have begun
- emit redacted audit event
- do not claim no execution unless proven

### 8.4 Creation idempotency

Repeated create requests with the same authenticated device, operation, and request ID must return the original result within the idempotency window.

A reused request ID with different parameters must be rejected.

---

## 9. Running lifecycle

### 9.1 Input acceptance

Input is accepted only when:

1. state is `RUNNING`
2. transport is authenticated
3. terminal is attached
4. replay synchronization is complete
5. active lease belongs to current device
6. lease ID matches
7. lease generation matches
8. message size is valid
9. rate policy permits input

If any condition fails, input is rejected.

### 9.2 Resize acceptance

Resize is accepted only when:

- state is `RUNNING`
- active lease is valid
- dimensions are valid
- rate limit permits
- viewport stabilization has completed client-side

### 9.3 Activity tracking

Update `lastActivityAt` on approved activity such as:

- accepted input
- PTY output
- valid resize
- authorized reconnect
- explicit session interaction

Heartbeat alone should not necessarily reset idle expiry unless policy explicitly says so.

---

## 10. Detach lifecycle

### 10.1 Detach causes

- WebSocket loss
- browser backgrounding
- tab closure
- navigation away from terminal
- device network change
- explicit client detach

### 10.2 Detach sequence

1. Stop accepting input from lost transport.
2. Mark attachment absent.
3. Preserve or invalidate lease according to lease policy.
4. Set reconnect deadline.
5. Transition to `DETACHED`.
6. Continue bounded output capture.
7. Emit lifecycle event.
8. Emit audit event.

### 10.3 Lease behavior during detach

Phase 1 rule:

- detach does not transfer lease
- reconnect does not steal lease
- stale transport cannot continue input
- lease may remain associated with the same device until expiry or policy release
- other devices require explicit transfer or acquisition under policy

Exact lease timeout remains unresolved.

---

## 11. Reconnect lifecycle

### 11.1 Preconditions

Reconnect requires:

- authenticated device session
- terminal authorization
- state `DETACHED` or `RECONNECTING`
- reconnect deadline not exceeded
- valid protocol version
- valid last received sequence if supplied

### 11.2 Reconnect sequence

1. Establish authenticated WebSocket.
2. Receive `client.hello`.
3. Receive `terminal.attach`.
4. Validate authorization.
5. Transition to `RECONNECTING`.
6. Send authoritative lifecycle state.
7. Send replay availability.
8. Replay buffered output or report gap.
9. Send current lease summary.
10. Wait for replay acknowledgement.
11. Transition to `RUNNING`.
12. Enable input only if lease is valid.

### 11.3 Reconnect interruption

If transport fails during replay:

- transition back to `DETACHED`
- continue bounded replay capture
- do not reset reconnect deadline unless policy explicitly allows it
- do not duplicate lease ownership

### 11.4 Reconnect expiry

If deadline passes before synchronization completes:

- transition to `EXPIRED`
- reject further attach attempts
- start cleanup
- state that reconnect is no longer available

---

## 12. Replay lifecycle behavior

### 12.1 Replay ring

The gateway maintains a bounded replay ring per terminal.

Initial provisional size:

```text
2 MiB per terminal
```

### 12.2 Sequence behavior

- output sequence is monotonic per terminal
- replay uses original sequence values
- duplicates are safe to ignore
- gaps are explicit
- client acknowledgement cannot exceed server sequence

### 12.3 Replay gap

When requested output has been evicted:

- emit `terminal.replay.gap`
- state earliest and latest available sequence
- state `lostOutput = true`
- do not imply complete recovery
- continue from earliest available output if policy allows

### 12.4 Replay completion

Input remains disabled until:

- replay end received
- acknowledgement validated
- state synchronized
- lease validated

---

## 13. Graceful termination

### 13.1 Initiators

Graceful termination may be initiated by:

- authorized user
- PTY exit
- idle expiry
- absolute expiry
- reconnect expiry
- gateway shutdown
- policy enforcement

### 13.2 Sequence

1. Atomically transition to `TERMINATING`.
2. Reject new input.
3. Reject resize.
4. Revoke active writable lease.
5. Emit `terminal.state`.
6. Send graceful signal or close request appropriate to platform and launcher.
7. Wait up to graceful window.
8. Continue bounded final output capture.
9. If process exits, clean process tree and resources.
10. Close replay resources.
11. Emit final lifecycle and audit events.
12. Transition to `TERMINATED`.

Initial graceful window:

```text
5 seconds
```

### 13.3 PTY exit before termination request

If the PTY exits naturally:

- record exit event
- transition to `TERMINATING`
- perform handle and child cleanup
- transition to `TERMINATED`

Do not remain in `RUNNING` after PTY exit.

---

## 14. Forced termination

### 14.1 Preconditions

- authenticated terminal authorization
- explicit user confirmation
- terminal not already fully terminated

### 14.2 Sequence

1. Transition to `TERMINATING` if not already there.
2. Reject input and resize.
3. Revoke lease.
4. terminate the PTY process tree using platform-specific method.
5. verify best-effort cleanup.
6. close PTY handles.
7. close replay resources.
8. emit audit event.
9. transition to `TERMINATED` or `FAILED`.

### 14.3 Idempotency

Repeated force requests for the same terminal:

- return current terminal state
- do not target unrelated or reused process identifiers
- remain safe after cleanup completion

---

## 15. Expiry lifecycle

### 15.1 Expiry types

- reconnect expiry
- idle expiry
- absolute session expiry
- lease expiry

### 15.2 Idle expiry

Initial provisional policy:

```text
60 minutes
```

Idle expiry must define which activities reset the timer.

### 15.3 Absolute expiry

Initial provisional policy:

```text
12 hours
```

Absolute expiry is not extended by heartbeat or activity.

### 15.4 Reconnect expiry

Initial provisional policy:

```text
60 seconds
```

### 15.5 Expiry sequence

1. transition to `EXPIRED`
2. reject input and resize
3. revoke lease
4. emit expiry reason
5. transition to `TERMINATING`
6. perform cleanup
7. transition to `TERMINATED` or `FAILED`

---

## 16. Failure lifecycle

### 16.1 Failure sources

- PTY spawn failure
- PTY I/O failure
- process cleanup failure
- invalid lifecycle transition
- replay corruption
- unrecoverable resource exhaustion
- gateway internal error
- process identity mismatch
- launcher policy failure after allocation

### 16.2 Failure sequence

1. stop accepting input
2. revoke lease
3. capture redacted failure code
4. attempt best-effort cleanup
5. determine whether process may still be active
6. transition to `FAILED`
7. emit lifecycle and audit events
8. present safest next action

### 16.3 Required failure messaging

Every failure must state:

- what failed
- current impact
- whether anything executed
- whether process may still be active
- safest next action

---

## 17. Gateway shutdown lifecycle

### 17.1 Graceful shutdown

On graceful gateway shutdown:

1. stop accepting new terminal creation
2. stop accepting new WebSocket connections
3. transition active nonpersistent sessions to `TERMINATING`
4. reject new input
5. revoke leases
6. gracefully terminate PTYs
7. wait bounded shutdown window
8. force remaining process trees
9. flush redacted audit events
10. close network listeners
11. exit

### 17.2 Abrupt shutdown

Phase 1 does not guarantee restoration after abrupt gateway failure.

At next startup:

- do not claim prior sessions were restored
- detect known orphan risk where practical
- report uncertainty honestly
- do not expose stale sessions as active
- do not accept old leases

### 17.3 Persistent tmux exception

A user-created tmux session may outlive the gateway by design.

The gateway still must:

- clean up its PTY attachment
- invalidate application lease
- avoid claiming the tmux session is attached
- require explicit reattach later

---

## 18. tmux persistence semantics

tmux persistence is Level 3 and explicit.

Rules:

- tmux persistence is user-selected
- the gateway does not silently convert shells to tmux
- browser disconnect does not imply tmux persistence
- application session and controller lease remain gateway-controlled
- tmux process lifetime may exceed terminal attachment lifetime
- reattach requires authorization
- gateway restart restoration of application state remains deferred

---

## 19. Process-tree ownership

The gateway must track enough process identity to avoid terminating the wrong process.

Required:

- PTY handle
- root process identity
- process group or job identity where supported
- creation-time or equivalent anti-reuse evidence where practical
- session binding
- cleanup status

Do not rely only on a reusable numeric PID.

Exact platform-specific implementation remains unresolved.

---

## 20. Race-condition handling

## 20.1 Terminate versus input

If termination begins before input acceptance:

- input rejected
- `executed = "no"`

If input acceptance occurred but acknowledgement is lost:

- client sees `executed = "unknown"`
- client must not auto-retry

---

## 20.2 Terminate versus reconnect

If termination begins during reconnect:

- termination wins
- replay may end early
- client receives authoritative `TERMINATING` state
- input remains disabled

---

## 20.3 Lease transfer versus input

Gateway serializes by authoritative lease generation.

- input with old generation rejected
- input with new generation accepted only after transfer commit
- no interval permits both generations

---

## 20.4 Natural PTY exit versus termination request

Both converge on `TERMINATING`.

Cleanup must be idempotent.

---

## 20.5 Reconnect deadline versus attach

Gateway uses an authoritative timestamp.

- attach accepted only if authorization and deadline checks pass atomically
- no client clock decides validity

---

## 20.6 Cleanup versus repeated force request

Repeated requests return current state.

Cleanup operation targets the original session-owned process identity.

---

## 21. Idempotency

Idempotent lifecycle operations:

- terminal creation
- graceful termination
- forced termination
- lease acquire
- lease transfer
- lease release

Not idempotently retried:

- terminal input
- resize where exact duplicate semantics are not important
- replay acknowledgements beyond validation

Lifecycle transition handlers must tolerate duplicate internal events such as:

- repeated process-exit notification
- repeated socket-close notification
- repeated timer firing
- repeated terminate request

---

## 22. Audit events

Required event types:

```text
terminal.create.requested
terminal.create.authorized
terminal.spawn.started
terminal.spawn.succeeded
terminal.spawn.failed
terminal.state.changed
terminal.detached
terminal.reconnect.started
terminal.reconnect.succeeded
terminal.reconnect.expired
terminal.replay.gap
terminal.lease.granted
terminal.lease.transferred
terminal.lease.revoked
terminal.termination.requested
terminal.termination.graceful.started
terminal.termination.force.started
terminal.process.exited
terminal.cleanup.succeeded
terminal.cleanup.failed
terminal.expired
terminal.failed
gateway.shutdown.started
gateway.shutdown.completed
```

Audit fields may include:

- event ID
- timestamp
- session ID
- device ID
- workspace ID
- launcher ID
- previous state
- next state
- lease generation
- reason code
- byte counts
- cleanup result

Audit fields must exclude:

- raw terminal input
- raw terminal output
- pairing codes
- cookies
- provider keys
- SSH keys
- raw environment variables
- secrets

---

## 23. Client-visible state mapping

| Gateway state | Client title | Input | Primary action |
|---|---|---|---|
| `CREATING` | Starting terminal | disabled | Cancel |
| `RUNNING` | Connected | lease-dependent | Use terminal |
| `DETACHED` | Connection lost | disabled | Reconnect |
| `RECONNECTING` | Reconnecting | disabled | Wait or cancel |
| `TERMINATING` | Ending session | disabled | View details |
| `TERMINATED` | Session ended | disabled | Start new session |
| `EXPIRED` | Session expired | disabled | Start new session |
| `FAILED` | Terminal failed | disabled | Review details |

Client copy must not overstate process status.

---

## 24. Recovery semantics

### 24.1 Temporary network loss

- PTY may still be active
- input paused
- reconnect available until deadline
- bounded replay continues

### 24.2 Replay gap

- state that some output was lost
- do not present transcript as complete
- allow continued session use only if still authorized and running

### 24.3 Cleanup failure

- state process may still be active
- expose safest host-side recovery action
- do not claim termination complete

### 24.4 Authentication expiry

- input disabled
- terminal state remains server-authoritative
- reauthentication required
- no silent lease restoration

---

## 25. Resource limits

Initial provisional limits:

| Resource | Policy |
|---|---:|
| Replay buffer | `2 MiB per terminal` |
| Active terminals per device | `3` |
| Global active terminals | `10` |
| Reconnect deadline | `60 seconds` |
| Maximum input message | `64 KiB` |
| Resize rate | `10 events/second` |
| Graceful termination window | `5 seconds` |
| Absolute session duration | `12 hours` |
| Idle session timeout | `60 minutes` |

Limits must be enforced server-side.

---

## 26. Lifecycle test matrix

### Creation

- authorized creation succeeds
- unauthorized creation rejected
- invalid workspace rejected
- invalid launcher rejected
- spawn timeout
- partial spawn cleanup
- duplicate create request

### Running

- input with active lease
- input without lease
- stale lease input
- resize with active lease
- invalid resize
- output sequencing
- activity timer updates

### Detach

- WebSocket loss
- browser background
- explicit detach
- lease not silently transferred
- replay remains bounded
- detached status visible

### Reconnect

- successful reconnect
- replay without gap
- replay with gap
- reconnect interruption
- reconnect deadline exceeded
- authentication expiry during reconnect
- stale lease after reconnect

### Termination

- graceful termination
- forced termination
- repeated termination
- terminate during create
- terminate during reconnect
- natural PTY exit
- child process cleanup
- cleanup failure

### Expiry

- idle expiry
- absolute expiry
- reconnect expiry
- lease expiry
- no return to running after expiry

### Gateway shutdown

- graceful shutdown with active PTY
- forced cleanup after timeout
- tmux exception
- stale lease invalidated
- no false restoration claim

---

## 27. Lifecycle acceptance gates

Do not claim PTY lifecycle complete unless:

1. Every state invariant is enforced.
2. Invalid transitions are rejected.
3. `CREATING` cannot remain indefinitely.
4. Input is accepted only in `RUNNING`.
5. Resize is accepted only in `RUNNING`.
6. Input requires current lease.
7. Resize requires current lease.
8. Stale lease generations are rejected.
9. Transport loss transitions to `DETACHED`.
10. Disconnect does not immediately kill the PTY.
11. Reconnect transitions through `RECONNECTING`.
12. Replay completes before input resumes.
13. Replay gaps are explicit.
14. Reconnect expiry transitions to `EXPIRED`.
15. Expired sessions cannot reconnect.
16. Termination atomically disables input.
17. Graceful termination waits only a bounded period.
18. Forced termination targets the correct process tree.
19. Cleanup is idempotent.
20. Natural PTY exit converges on terminal cleanup.
21. Gateway shutdown cleans nonpersistent PTYs.
22. tmux persistence remains explicit.
23. Gateway restart restoration is not falsely claimed.
24. Failure state reports whether process may still be active.
25. Audit events contain no secrets.
26. Client-visible state matches gateway state.
27. Offline clients do not queue input.
28. Physical iPhone reconnect and termination flows pass.

---

## 28. Open lifecycle decisions

The following require explicit later review:

- exact lease duration
- lease heartbeat policy
- whether lease survives short detach
- exact detach-to-expiry timer behavior
- exact process-tree termination implementation
- exact platform signal sequence
- exact shutdown timeout
- exact orphan detection strategy
- exact tmux attach/create lifecycle
- exact replay retention after termination
- exact terminal metadata retention
- whether read-only viewers alter detach semantics in a later version

These must not be silently resolved during implementation.

---

## 29. Recommended next artifact

The next Phase 0 artifact should be:

```text
docs/IPHONE-ACCEPTANCE.md
```

It should define:

- iPhone 16 Pro portrait acceptance
- iPhone 16 Pro landscape acceptance
- software keyboard behavior
- external keyboard behavior
- safe areas
- Dynamic Island and home indicator
- terminal fit and resize
- shortcut bar
- full-screen mode
- pairing
- reconnect
- recovery states
- VoiceOver
- Reduce Motion
- increased contrast
- copy, paste, selection, and long scrollback

Do not begin full terminal implementation until architecture, threat model, protocol, PTY lifecycle, visual system, and iPhone acceptance documents are reviewed together.

---

## Phase 0 consistency reconciliation — authoritative lifecycle rules

**Reconciled:** 2026-07-24
**Precedence:** This section resolves C-01, C-02, C-03, C-05, C-06, C-07, C-09, and C-10 and supersedes conflicting earlier wording.

- The application WebSocket transport and terminal attachment are separate records. Phase 1 allows zero or one authorized attachment per terminal; an open global transport does not count as an attachment.
- `terminal.detach` removes the per-terminal attachment. The terminal becomes `DETACHED` only when no authorized controlling attachment remains. Navigation alone is not inferred as detach; client policy must send or retain attachment explicitly.
- Complete text frames are capped at **64 KiB**; decoded terminal input is capped at **48 KiB**.
- Device-session expiry immediately invalidates the owning lease/generation. Reauthentication requires explicit lease reacquisition.
- Idle timeout resets only on accepted user input or an explicit authorized keep-alive/session action. Output, heartbeat, replay, and resize alone do not reset it. Absolute expiry never resets.
- Unrecoverable failure first disables input and revokes the lease, then runs cleanup in an internal non-public cleanup substate. Only after the attempt completes is public `FAILED` emitted with `cleanupResult` and `processMayStillBeActive`. `FAILED` is terminal; it does not transition to `TERMINATING`.
- PTY output uses stateful streaming UTF-8 decoding. Split code points are buffered, malformed sequences emit U+FFFD, JSON escaping follows decoding, and sequence values identify emitted chunks.
- Process ownership is represented internally by PID, optional process-group ID, start time, optional platform handle, and terminal-session binding. The platform handle is not exposed. Numeric PID alone is insufficient for cleanup.

Accordingly, “exact idle activity definition” and “whether `FAILED` may transition to `TERMINATING` internally” are resolved and no longer open lifecycle decisions. Multi-viewer detach behavior remains deferred because multi-viewer support is outside Phase 1.
