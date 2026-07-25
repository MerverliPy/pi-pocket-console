# Pi Pocket Console v0.2 iPhone Acceptance Matrix

**Status:** Phase 0 planning baseline
**Product:** Pi Pocket Console v0.2
**Primary device:** iPhone 16 Pro
**Primary surface:** Standalone PWA
**Implementation branch:** `agent/v0.2-hybrid-terminal-pwa`
**Published baseline:** `0.1.0` at commit `e083ad04885620478009b7967d25744e134999c1`

---

## 1. Purpose

This document defines the physical-device acceptance requirements for Pi Pocket Console v0.2 on iPhone 16 Pro.

It covers:

- portrait
- landscape
- software keyboard
- external keyboard
- Dynamic Island
- home indicator
- safe areas
- terminal fit and resize
- terminal shortcut controls
- full-screen mode
- pairing
- authentication
- controller leases
- reconnect
- replay
- recovery states
- copy, paste, and selection
- VoiceOver
- Reduce Motion
- increased contrast
- large text
- background and foreground behavior
- PWA install, launch, and update
- performance and stability
- release evidence

The iPhone layout is authoritative. Tablet and desktop may expand the workspace but may not weaken or replace iPhone task completion, recovery, security, or accessibility behavior.

---

## 2. Acceptance philosophy

A requirement passes only when it is:

1. tested on physical iPhone 16 Pro hardware
2. tested in standalone PWA mode where applicable
3. tested with the production-intent build
4. observed without browser developer emulation as the only evidence
5. recorded with exact device, OS, app commit, build, and result
6. repeatable
7. free of hidden fallback assumptions

Simulator and responsive-browser testing may support development but do not replace physical-device acceptance.

---

## 3. Test environment record

Every acceptance run must record:

```text
Device:
Model:
iOS version:
ChatGPT/PWA browser context:
PWA installed: yes/no
Build commit:
Build tree:
Gateway commit:
Gateway platform:
Tailscale version:
Network type:
Software keyboard:
External keyboard:
Display settings:
Text size:
Reduce Motion:
Increase Contrast:
VoiceOver:
Timestamp:
Tester:
```

---

## 4. Required device configurations

At minimum, validate the following configurations.

### 4.1 Baseline configuration

- iPhone 16 Pro
- current supported iOS release
- standalone PWA
- default display scaling
- default text size
- software keyboard enabled
- Reduce Motion off
- Increase Contrast off
- VoiceOver off
- portrait and landscape
- Wi-Fi on tailnet

### 4.2 Accessibility configuration

- large text or browser text scaling
- Reduce Motion on
- Increase Contrast on
- VoiceOver on
- haptics off
- portrait
- software keyboard
- external keyboard where available

### 4.3 Network recovery configuration

- temporary Wi-Fi loss
- Wi-Fi to cellular transition where tailnet remains available
- Tailscale unavailable
- gateway unavailable
- authentication expiry
- WebSocket interruption
- reconnect deadline expiry

---

## 5. Global release gates

The iPhone acceptance suite fails if any of these occur:

1. Critical controls appear under the Dynamic Island.
2. Critical controls appear under the home indicator.
3. Software keyboard obscures terminal input, composer, reconnect, approval, or emergency termination.
4. Terminal resize loops or visibly oscillates.
5. Rotation resets or terminates an active terminal.
6. Full-screen mode hides connection, lease, authentication, approval, or termination state.
7. Offline UI implies a command executed when it did not.
8. Reconnect silently transfers controller ownership.
9. Terminal input is silently queued and later executed.
10. Pairing codes, credentials, cookies, or terminal secrets appear in browser storage.
11. VoiceOver cannot reach core recovery or termination controls.
12. Reduce Motion is ignored.
13. Color is the only indicator of a critical state.
14. Long file names, branch names, or session IDs make primary controls unreachable.
15. App backgrounding causes silent session loss without accurate recovery state.
16. PWA update causes unannounced destructive reload.
17. Emergency termination is unreachable in any supported navigation mode.
18. Structured Console becomes inaccessible while terminal is active.

---

## 6. Acceptance result values

Use only:

```text
PASS
FAIL
BLOCKED
NOT TESTED
NOT APPLICABLE
```

A `BLOCKED` result must state the exact blocker.

A `FAIL` result must include:

- observed behavior
- expected behavior
- reproduction steps
- severity
- artifact reference
- next action

---

## 7. Visual baseline

Locked visual direction:

- Hybrid Precision + Native iOS
- Precision Cyan
- Balanced Precision typography
- Precision Compact spacing and radii
- System-Matched Technical Line icons
- Terminal Aperture icon
- Guided Security Steps
- Dense Native Rows
- Operational Rows
- Adaptive Block cursor
- Graphite ANSI
- Functional Micro-Illustrations
- Progressive Terminal-First Expansion

The test must verify implementation fidelity without treating static mockups as proof of runtime behavior.

---

# Part I — PWA installation and launch

## 8. Install acceptance

### IPH-PWA-001 — Add to Home Screen

**Setup:** Open the application through the intended Tailscale Serve HTTPS origin.

**Steps:**

1. Open Share.
2. Select Add to Home Screen.
3. Confirm app name and icon.
4. Launch from Home Screen.

**Expected:**

- App installs successfully.
- Terminal Aperture icon appears correctly.
- App name is legible and not truncated unexpectedly.
- Launch opens standalone PWA presentation.
- No public fallback URL is suggested.

---

### IPH-PWA-002 — App icon rendering

Validate:

- Home Screen
- App Library or search surface where applicable
- Settings or storage listing where applicable
- mask/crop behavior
- dark background edge
- secure-status dot visibility
- no unreadable fine detail

**Expected:** Icon remains identifiable at all rendered sizes.

---

### IPH-PWA-003 — Splash screen

**Expected:**

- `#0B0F12` background
- centered Terminal Aperture icon
- small Pi Pocket Console label
- safe-area-aware placement
- no fake progress
- no decorative loading animation
- transition does not flash a bright white frame

---

### IPH-PWA-004 — Cold launch

**Expected:**

- Application shell loads.
- Authentication state is accurate.
- Offline or unavailable state is explicit.
- No terminal execution is simulated.
- PWA update state, if present, is explicit.

---

### IPH-PWA-005 — Warm launch

**Expected:**

- Non-sensitive preferences restore.
- Drafts restore.
- Sensitive terminal output does not restore from browser persistence by default.
- Active session state is fetched from gateway.
- Lease state is not assumed from stale client memory.

---

## 9. PWA update acceptance

### IPH-PWA-010 — Update available

**Expected:**

- App indicates update or reload requirement.
- User is told whether active terminal processes may continue.
- Drafts are preserved.
- Reload is not forced during critical input or approval.
- No command is reissued automatically after reload.

### IPH-PWA-011 — Service worker activation

**Expected:**

- New assets load coherently.
- Mixed-version client state is avoided.
- Protocol incompatibility produces explicit recovery guidance.
- No downgrade is silently applied.

---

# Part II — Portrait acceptance

## 10. Portrait baseline

### IPH-POR-001 — Six-destination navigation

Validate all destinations:

1. Console
2. Terminal
3. Sessions
4. Files
5. Diagnostics
6. Settings

**Expected:**

- All six remain reachable.
- Labels and icons are legible.
- Active destination is not indicated by color alone.
- Navigation does not overlap home indicator.
- Auto-Minimizing behavior remains predictable.
- Large text adaptation does not remove destinations.

---

### IPH-POR-002 — Balanced Precision layout

**Expected:**

- `16px` screen gutter where safe-area permits
- compact but readable status and controls
- approximately `44 × 44 CSS px` primary touch targets
- no clipped labels
- terminal, composer, or row content does not overlap navigation

---

### IPH-POR-003 — Terminal header

Validate default information priority:

1. security/connection
2. host
3. workspace
4. branch or session
5. lease ownership

**Expected:**

- Critical state remains visible.
- Long values truncate safely.
- Tap opens session details.
- No security identity is derived from terminal title output.

---

### IPH-POR-004 — Recessed terminal surface

**Expected:**

- near-black terminal surface
- crisp boundary
- restrained focus edge
- no blur behind terminal cells
- no glow
- no simulated hardware bezel
- ANSI colors remain legible
- terminal does not render beneath shortcut controls

---

## 11. Portrait with software keyboard closed

### IPH-POR-010 — Terminal idle

**Expected:**

- terminal uses available height efficiently
- bottom navigation remains reachable
- shortcut row remains reachable
- status remains visible
- scroll position remains stable

### IPH-POR-011 — Structured Console idle

**Expected:**

- conversation is readable
- operational cards remain compact
- prompt composer remains reachable
- routine success may collapse
- approvals and failures remain expanded

---

## 12. Portrait with software keyboard open

### IPH-KBD-001 — Keyboard appearance

**Expected:**

- composer or terminal input remains visible
- viewport does not jump repeatedly
- terminal fit occurs after viewport stabilization
- no infinite resize loop
- home indicator and keyboard do not cover controls
- input focus remains correct

---

### IPH-KBD-002 — Primary terminal shortcut row

Required row:

```text
Ctrl   Esc   Tab   ↑   ↓   More
```

**Expected:**

- each control has usable touch target
- row remains visible above keyboard
- modifier state is visible
- screen-reader labels are correct
- no destructive action appears in the row
- row does not consume unreasonable terminal height

---

### IPH-KBD-003 — Secondary terminal controls

Required controls include:

```text
Alt   ←   →   PgUp   PgDn   Home   End
Ctrl+C   Ctrl+D   Ctrl+Z   Paste   Search
```

**Expected:**

- opened through explicit More action
- does not permanently consume portrait terminal height
- closing returns focus predictably
- exact terminal sequences are emitted
- destructive actions remain separate

---

### IPH-KBD-004 — Sticky modifier

**Expected:**

- one press enables sticky state
- state is visually distinct
- VoiceOver announces state
- haptic occurs only if enabled
- state clears according to defined behavior
- state does not silently carry to another session

---

### IPH-KBD-005 — Locked modifier

**Expected:**

- lock requires deliberate action
- lock state remains persistently visible
- stronger haptic only if enabled
- escape path is obvious
- session change clears or explicitly reconfirms state

---

### IPH-KBD-006 — Composer expansion

**Expected:**

- composer expands vertically without hiding send/stop
- switching modes preserves separate drafts
- keyboard dismissal preserves text
- offline state disables execution but preserves draft
- VoiceOver focus order remains logical

---

## 13. Portrait terminal interaction

### IPH-TERM-001 — Basic input

Test:

- ASCII
- UTF-8
- emoji where supported
- multiline paste
- backspace
- enter
- tab
- escape
- arrow keys

**Expected:** Exact intended terminal sequences and characters.

---

### IPH-TERM-002 — Control sequences

Test:

- `Ctrl+C`
- `Ctrl+D`
- `Ctrl+Z`

**Expected:**

- exact control sequence
- no duplicate send
- no automatic retry after disconnect uncertainty
- UI reports unknown execution status if acknowledgement is lost

---

### IPH-TERM-003 — Alternate screen

Test with:

- `vim`
- `nvim`
- `less`
- `top` or equivalent
- tmux where enabled

**Expected:**

- alternate-screen entry and exit work
- terminal size remains correct
- shortcut controls remain usable
- app navigation does not corrupt terminal state

---

### IPH-TERM-004 — Adaptive Block cursor

**Expected:**

- solid block while focused
- hollow block while unfocused
- high-contrast fallback
- user can disable blink
- cursor remains visible in Graphite ANSI theme
- cursor behavior does not break TUIs

---

### IPH-TERM-005 — Selection

**Expected:**

- text selection works without triggering unintended terminal input
- handles remain usable
- navigation remains recoverable
- selected sensitive text is not persisted by app
- terminal continues accurately after selection ends

---

### IPH-TERM-006 — Copy

**Expected:**

- copy requires user action
- copied text matches selection
- app does not auto-copy secrets
- copy confirmation is restrained

---

### IPH-TERM-007 — Paste

**Expected:**

- explicit paste action
- multiline content is previewed or handled safely according to policy
- very large paste is rejected or confirmed
- paste is not silently repeated after network loss
- clipboard content is not stored by app

---

### IPH-TERM-008 — Search

**Expected:**

- search does not alter PTY input
- search UI remains above keyboard
- closing search restores terminal focus
- large scrollback search remains bounded

---

### IPH-TERM-009 — Long scrollback

**Expected:**

- memory remains bounded
- scrolling remains responsive
- new output behavior is predictable
- jump-to-bottom control is reachable
- replay and local scrollback are not misrepresented as complete transcript retention

---

# Part III — Landscape acceptance

## 14. Landscape baseline

### IPH-LAN-001 — Rotation into landscape

**Expected:**

- active PTY remains alive
- terminal does not reset
- resize occurs once stabilized
- no repeated oscillation
- current scroll position is preserved where practical
- keyboard and safe-area state recalculate

---

### IPH-LAN-002 — Maximum Workspace

**Expected:**

- terminal gains usable vertical and horizontal area
- header minimizes appropriately
- critical status remains visible
- shortcut profile adapts
- navigation mode follows configured behavior
- touch targets remain usable

---

### IPH-LAN-003 — Landscape safe areas

**Expected:**

- no critical controls under sensor housing or rounded corners
- edge-to-edge terminal respects required safe affordances
- full-screen restore remains reachable
- status does not clip at either side

---

## 15. Landscape software keyboard

### IPH-LAN-KBD-001 — Keyboard-open fit

**Expected:**

- terminal remains usable
- primary shortcut controls remain reachable
- no critical overlap
- viewport fit stabilizes
- header compression does not remove security or lease status

### IPH-LAN-KBD-002 — Secondary controls

**Expected:** Secondary shortcuts appear without making terminal unusably small.

---

## 16. Landscape navigation

### IPH-LAN-NAV-001 — Auto-Minimizing mode

**Expected:**

- navigation minimizes according to defined trigger
- restore affordance remains discoverable
- minimizing never hides critical state
- state does not unexpectedly persist into unrelated session

### IPH-LAN-NAV-002 — Full-Screen mode

**Expected:**

- explicit entry
- visible exit/restore control
- emergency termination reachable
- authentication, lease, connection, and approval state remain available
- mode exits safely after session termination

---

# Part IV — External keyboard acceptance

## 17. External keyboard setup

Test at least one supported external keyboard.

Record:

```text
Keyboard model:
Connection type:
Layout:
iOS hardware keyboard settings:
```

---

### IPH-EXT-001 — Hardware key input

Test:

- Escape
- Tab
- arrows
- Home
- End
- Page Up
- Page Down
- Control combinations
- Option/Alt combinations

**Expected:** Correct terminal sequences with no duplicate shortcut-bar injection.

---

### IPH-EXT-002 — Shortcut bar adaptation

**Expected:**

- profile changes to Maximum Workspace where configured
- redundant shortcut controls may minimize
- critical controls remain reachable
- user can restore software controls
- no session reset

---

### IPH-EXT-003 — Keyboard disconnect

**Expected:**

- software controls recover
- focus remains predictable
- terminal does not resize repeatedly
- modifier state does not remain silently locked

---

### IPH-EXT-004 — Focus traversal

**Expected:**

- visible focus ring
- logical order through navigation, header, terminal controls, composer, and sheets
- no keyboard trap
- terminal content remains distinguishable from app controls

---

# Part V — Safe-area and viewport acceptance

## 18. Dynamic Island

### IPH-SAFE-001 — Portrait Dynamic Island clearance

**Expected:** No header, status, pairing, approval, or termination control is obscured.

### IPH-SAFE-002 — Landscape sensor-area clearance

**Expected:** Controls and text remain outside unsafe regions.

---

## 19. Home indicator

### IPH-SAFE-010 — Bottom navigation clearance

**Expected:** Bottom navigation remains tappable and visually separated.

### IPH-SAFE-011 — Full-screen terminal clearance

**Expected:** Terminal may extend edge-to-edge, but restore and emergency controls remain above safe inset.

---

## 20. `visualViewport`

### IPH-VIEW-001 — Keyboard event burst

**Expected:**

- viewport-controller coalesces transitional events
- one stable terminal fit is applied
- no loop between fit and viewport change
- no visible repeated canvas snap

### IPH-VIEW-002 — Address-bar or browser chrome changes

Where applicable outside standalone mode:

**Expected:** Layout remains usable, but standalone PWA remains authoritative.

### IPH-VIEW-003 — Orientation change

**Expected:** Resize applies only after orientation and viewport settle.

---

# Part VI — Pairing and authentication acceptance

## 21. Guided Security Steps

### IPH-PAIR-001 — Private connection check

**Expected:**

- Tailscale state shown
- host identity shown
- gateway availability shown
- failure gives direct recovery path
- no suggestion to enable Funnel or public forwarding

---

### IPH-PAIR-002 — Pairing-code entry

**Expected:**

- large segmented input
- paste support
- expiration countdown
- attempt-limit feedback
- code not persisted
- code not visible after successful submission
- countdown does not spam VoiceOver

---

### IPH-PAIR-003 — Invalid code

**Expected:**

- rejected
- no device session created
- exact impact stated
- safest next action shown
- remaining-attempt information does not help brute force beyond policy

---

### IPH-PAIR-004 — Expired code

**Expected:**

- rejected
- code cannot be reused
- request-new-code path shown
- no stale code remains in browser storage

---

### IPH-PAIR-005 — Device confirmation

**Expected:**

- device label shown
- session duration shown
- security summary shown
- explicit pair action
- user-facing label not represented as authoritative device identity

---

## 22. Authentication lifecycle

### IPH-AUTH-001 — Authenticated launch

**Expected:** Accurate session expiry and device identity display.

### IPH-AUTH-002 — Idle expiry

**Expected:**

- user warned where policy allows
- input disabled after expiry
- active process state described accurately
- reauthentication required
- no silent lease restoration

### IPH-AUTH-003 — Absolute expiry

**Expected:** Session expires even with activity according to policy.

### IPH-AUTH-004 — Logout

**Expected:**

- cookie invalidated
- WebSocket closes
- sensitive in-memory state removed where practical
- unrelated server PTY behavior follows policy and is stated accurately

---

# Part VII — Controller lease acceptance

## 23. Lease visibility

### IPH-LEASE-001 — Lease owned

**Expected:** Input enabled and ownership status visible.

### IPH-LEASE-002 — Lease owned by another device

**Expected:**

- input disabled
- state not color-only
- transfer or request-control action explicit
- no silent takeover

### IPH-LEASE-003 — Lease revoked

**Expected:**

- input immediately disabled
- modifier state cleared
- revocation announced
- stale input rejected
- safe next action shown

---

## 24. Lease transfer

### IPH-LEASE-010 — Explicit transfer

**Expected:**

- transfer requires deliberate action
- previous controller receives revocation
- generation changes
- no period allows both devices to write
- terminal remains alive

### IPH-LEASE-011 — Reconnect without transfer

**Expected:** Reconnecting client does not silently become writable controller.

---

# Part VIII — Network, reconnect, and replay acceptance

## 25. Temporary transport loss

### IPH-NET-001 — Short WebSocket interruption

**Expected:**

- terminal input pauses
- PTY may remain active
- reconnect state shown
- no silent input queue
- reconnect begins within policy

---

### IPH-NET-002 — Wi-Fi interruption

**Expected:**

- current impact explained
- process-may-still-run text shown
- reconnect action visible
- cached notes and drafts remain available
- no fake output

---

### IPH-NET-003 — App background during active PTY

**Expected:**

- foreground recovery checks authoritative state
- no assumption that socket survived
- replay or gap behavior is explicit
- lease state revalidated

---

## 26. Replay

### IPH-REPLAY-001 — Complete replay

**Expected:**

- output restored in order
- no duplication
- input disabled until synchronization complete
- latest state accurate

### IPH-REPLAY-002 — Replay duplicate delivery

**Expected:** Duplicate sequence ignored without duplicate terminal text.

### IPH-REPLAY-003 — Replay gap

**Expected:**

- output loss explicitly stated
- transcript not presented as complete
- earliest available output shown according to policy
- safe next action shown

---

## 27. Reconnect expiry

### IPH-REC-001 — Deadline exceeded

**Expected:**

- session becomes expired
- reconnect action removed or disabled
- input remains disabled
- cleanup state shown
- start-new-session action offered
- no claim that prior process is active after confirmed cleanup

---

# Part IX — Session lifecycle acceptance

## 28. Creation

### IPH-LIFE-001 — Terminal creating

**Expected:**

- state visible
- input disabled
- cancellation available where supported
- no success shown before PTY exists

### IPH-LIFE-002 — Spawn failure

**Expected:**

- what failed
- current impact
- whether anything executed
- whether process may still be active
- safest next action

---

## 29. Running and detached

### IPH-LIFE-010 — Running

**Expected:** Input state matches lease and connection.

### IPH-LIFE-011 — Detached

**Expected:**

- clearly distinct from terminated
- process may still be active
- reconnect deadline shown
- input disabled

---

## 30. Termination

### IPH-LIFE-020 — Graceful terminate

**Expected:**

- explicit confirmation where appropriate
- input disables immediately
- progress accurately shown
- final cleanup result not overstated

### IPH-LIFE-021 — Force terminate

**Expected:**

- separate destructive confirmation
- reachable in all modes
- stronger haptic only if enabled
- no accidental activation from shortcut row
- cleanup failure is explicit

### IPH-LIFE-022 — Terminate in full-screen

**Expected:** Emergency termination remains reachable.

### IPH-LIFE-023 — Natural process exit

**Expected:** UI transitions to ended state without presenting a reconnect option.

---

# Part X — Files and Sessions acceptance

## 31. Files — Dense Native Rows

### IPH-FILE-001 — Long file names

**Expected:**

- safe truncation
- tap-to-expand
- primary actions remain reachable
- file type remains distinguishable

### IPH-FILE-002 — Path display

**Expected:** Workspace-relative path by default.

### IPH-FILE-003 — Upload staging

**Expected:**

- staged state visible
- explicit authorization before transfer
- completion only after host confirmation
- failure recoverable in place

### IPH-FILE-004 — Selection mode

**Expected:** Appears only when invoked and exits clearly.

---

## 32. Sessions — Operational Rows

### IPH-SESSION-001 — State differentiation

Test:

- running
- detached
- reconnecting
- terminating
- terminated
- expired
- failed

**Expected:** Every state has explicit text and icon treatment.

### IPH-SESSION-002 — Metadata hierarchy

Priority:

1. state
2. host/workspace
3. process or branch
4. lease
5. last activity

**Expected:** Lower-priority metadata moves to details sheet when space is limited.

### IPH-SESSION-003 — Swipe alternatives

**Expected:** Every swipe action has visible overflow or details-sheet alternative.

### IPH-SESSION-004 — Destructive actions

**Expected:** Require confirmation and remain separate from primary row action.

---

# Part XI — Recovery-state acceptance

## 33. Required recovery states

Each must use the reusable structure:

```text
Plain-language title
Current impact
One primary recovery action
Secondary safe actions
Compact host/session context
Expandable technical diagnostics
```

Required states:

- Offline
- Host unavailable
- Gateway unavailable
- Authentication expired
- Controller lease lost
- Provider missing
- PTY creation failure
- PTY process failure
- Reconnect deadline expired
- Workspace unauthorized
- Session terminated
- Browser storage unavailable
- PWA update/reload required

---

### IPH-RECOV-001 — Offline

**Expected:**

```text
Host unavailable

Terminal input is paused.
The active process may still be running on CALVINPC.

[Reconnect]

Review connection details
Open cached workspace notes
```

No success simulation.

---

### IPH-RECOV-002 — Gateway unavailable

**Expected:** Distinguish gateway failure from general internet failure.

### IPH-RECOV-003 — Authentication expired

**Expected:** Re-pair or authenticate path; no hidden retry.

### IPH-RECOV-004 — Lease lost

**Expected:** Input disabled; request or transfer action visible.

### IPH-RECOV-005 — PTY failure

**Expected:** State whether process may still exist.

### IPH-RECOV-006 — Browser storage unavailable

**Expected:**

- drafts may not persist
- sensitive execution remains disabled only if required by policy
- user told current impact
- no secret fallback storage introduced

---

# Part XII — Accessibility acceptance

## 34. VoiceOver

### IPH-A11Y-001 — Navigation order

**Expected:** Six destinations read in logical order with selected state.

### IPH-A11Y-002 — Custom technical icons

**Expected:** Accurate labels for lease, detached, reconnect, PTY lifecycle, tailnet boundary, and replay.

### IPH-A11Y-003 — Terminal controls

**Expected:**

- controls distinguishable from terminal content
- shortcut modifier state announced
- terminal status announced without excessive interruption
- emergency termination reachable

### IPH-A11Y-004 — Modal focus

**Expected:**

- focus enters sheet
- remains contained
- returns to trigger on close
- required approval sheets cannot be bypassed accidentally

### IPH-A11Y-005 — Pairing countdown

**Expected:** Threshold-based announcements, not continuous spam.

### IPH-A11Y-006 — Lifecycle changes

**Expected:** Important changes announced; routine output does not overwhelm.

---

## 35. Large text and scaling

### IPH-A11Y-010 — Large text

**Expected:**

- core controls remain reachable
- navigation adapts safely
- labels wrap or truncate intentionally
- Comfort First activates where configured
- terminal type size remains independently controlled

### IPH-A11Y-011 — Browser zoom

**Expected:** No horizontal lockout of critical controls.

### IPH-A11Y-012 — Long identifiers

**Expected:** Safe truncation plus expand/copy.

---

## 36. Increase Contrast

### IPH-A11Y-020 — Semantic contrast

**Expected:**

- boundaries strengthen
- text remains readable
- color semantics remain consistent
- no uncontrolled neon saturation
- offline and disabled states remain distinguishable

---

## 37. Reduce Motion

### IPH-A11Y-030 — System Reduce Motion

**Expected:**

- sheet springs reduced or removed
- navigation transitions shortened or removed
- no terminal-cell movement
- no continuous activity animation
- preference takes effect without reload where supported

---

## 38. Haptics

### IPH-A11Y-040 — Haptics disabled

**Expected:** All states remain understandable.

### IPH-A11Y-041 — Rate limiting

**Expected:** Reconnect and warning states do not produce repeated surprise haptics.

---

# Part XIII — Color and terminal-theme acceptance

## 39. Precision Cyan contrast

Measure approved combinations for:

- primary text on app background
- secondary text on app background
- secondary text on elevated surface
- cyan focus on terminal and app surfaces
- success, warning, error, and offline text or icons
- disabled controls
- placeholders
- selected navigation state

Record exact contrast ratios.

---

## 40. Graphite ANSI

### IPH-COLOR-001 — ANSI 16-color

Test all standard and bright colors.

### IPH-COLOR-002 — 256-color

Test representative palette.

### IPH-COLOR-003 — Truecolor

Test gradients and syntax themes without requiring animated gradients in UI.

### IPH-COLOR-004 — Git diff

Expected:

- additions
- deletions
- metadata
- selection
- cursor
- background

remain distinguishable.

### IPH-COLOR-005 — vim/nvim and tmux

Expected: Status lines, selections, modes, and cursor remain readable.

---

# Part XIV — Performance and stability acceptance

## 41. Startup performance

Record:

- cold launch to shell visible
- authenticated state resolution
- terminal view activation
- first PTY output

Exact numeric budget remains unresolved until baseline measurement.

---

## 42. Terminal rendering

### IPH-PERF-001 — Sustained output

**Expected:**

- no browser crash
- bounded memory
- acceptable input responsiveness
- no unbounded replay growth

### IPH-PERF-002 — Rapid resize

**Expected:** Coalesced, stable, no resize loop.

### IPH-PERF-003 — Long session

Test up to provisional policy limits where practical.

**Expected:** No progressive UI degradation.

---

## 43. Background and foreground

### IPH-PERF-010 — Short background

**Expected:** Accurate reconnect or continued state.

### IPH-PERF-011 — Long background

**Expected:** Auth, lease, replay, and expiry revalidated.

### IPH-PERF-012 — Memory pressure

**Expected:** Recovery state is accurate; drafts preserved where possible.

---

# Part XV — Security presentation acceptance

## 44. No public exposure guidance

Search all user-facing flows.

**Expected:** No instruction enables:

- Tailscale Funnel
- router port forwarding
- public listener
- public port `31415`

---

## 45. Secret persistence audit

Inspect:

- localStorage
- sessionStorage
- IndexedDB
- Cache Storage
- service worker caches
- logs
- crash reports
- URL
- history state

Must not contain:

- provider keys
- pairing codes
- cookies
- JavaScript-readable session secrets
- SSH keys
- shell credentials
- raw environment variables
- sensitive terminal output by default

---

## 46. Execution-truth audit

For every failure and network transition, verify the UI accurately states:

- what failed
- current impact
- whether anything executed
- safest next action

---

# Part XVI — Acceptance evidence package

## 47. Required artifacts

Each release-candidate acceptance package should contain:

```text
iphone-acceptance/
├─ environment.txt
├─ build-identity.txt
├─ test-matrix.csv
├─ failures/
├─ screenshots/
├─ screen-recordings/
├─ accessibility/
├─ contrast/
├─ network-recovery/
├─ terminal/
├─ pairing/
├─ storage-audit/
└─ final-summary.md
```

Do not include secrets or raw sensitive terminal output.

---

## 48. Screenshot rules

Screenshots may show:

- synthetic test repositories
- fake credentials only
- redacted host paths
- test sessions
- safe diagnostic output

Screenshots must not show:

- real provider keys
- cookies
- pairing codes
- SSH private keys
- sensitive repositories without authorization
- unredacted personal data

---

## 49. Final summary format

```text
Product:
Version:
Commit:
Device:
iOS:
Gateway:
Date:

Total cases:
PASS:
FAIL:
BLOCKED:
NOT TESTED:

Critical blockers:
High-severity failures:
Accessibility result:
Security-presentation result:
Terminal result:
Reconnect result:
Storage audit result:

Release recommendation:
```

---

# Part XVII — Phase 1 iPhone acceptance gates

## 50. Mandatory gates

Do not claim Phase 1 complete unless all pass:

1. PWA installs and launches correctly.
2. Terminal Aperture icon and splash render correctly.
3. iPhone 16 Pro portrait passes.
4. iPhone 16 Pro landscape passes.
5. Software keyboard does not obscure critical controls.
6. External keyboard behavior passes.
7. Dynamic Island and home indicator safe areas pass.
8. Terminal fit stabilizes after keyboard and rotation.
9. Six destinations remain reachable.
10. Balanced Precision remains readable.
11. Maximum Workspace remains operable.
12. Comfort First remains operable.
13. Full-screen mode preserves restoration and emergency termination.
14. Primary shortcut row works.
15. Sticky and locked modifiers are explicit.
16. `Ctrl+C`, `Ctrl+D`, `Ctrl+Z`, UTF-8, ANSI, alternate screen, and resize work.
17. Copy, paste, selection, search, and long scrollback pass.
18. Pairing flow passes.
19. Pairing codes are not persisted.
20. Authentication expiry behavior passes.
21. Controller lease ownership is explicit.
22. Reconnect does not silently transfer lease.
23. Temporary network loss recovery passes.
24. Replay without duplication passes.
25. Replay gap is explicit.
26. Reconnect expiry is deterministic.
27. Graceful and forced termination pass.
28. Gateway and PTY failures report execution truth.
29. Files Dense Native Rows pass.
30. Sessions Operational Rows pass.
31. All required recovery states pass.
32. VoiceOver reaches core flows.
33. Reduce Motion is honored.
34. Increase Contrast remains usable.
35. Large text and browser scaling do not block critical controls.
36. Precision Cyan contrast matrix passes.
37. Graphite ANSI passes representative applications.
38. Sustained output remains bounded and responsive.
39. Background and foreground recovery pass.
40. Browser storage contains no prohibited secrets.
41. No public-exposure guidance appears.
42. Existing Structured Console remains first-class.
43. Physical-device evidence package is complete.
44. No unresolved critical blocker remains.

---

## 51. Open acceptance decisions

The following require later explicit measurement or implementation detail:

- exact supported iOS version range
- exact terminal minimum and maximum dimensions
- exact viewport stabilization algorithm
- exact performance budgets
- exact memory budgets
- exact ANSI values
- exact contrast thresholds per component class
- exact browser zoom test levels
- exact large-text test levels
- exact supported external keyboards
- exact network transition scenarios
- exact screenshot and recording retention
- exact automated versus manual test split
- exact release sign-off roles

These must not be silently assumed.

---

## 52. Phase 0 document set completion

This document completes the required Phase 0 planning set:

```text
docs/ARCHITECTURE.md
docs/THREAT-MODEL.md
docs/PROTOCOL.md
docs/PTY-LIFECYCLE.md
docs/VISUAL-SYSTEM.md
docs/IPHONE-ACCEPTANCE.md
```

Before implementation:

1. Review all six documents together.
2. Reconcile contradictions.
3. Resolve or explicitly defer open decisions.
4. Verify the immutable `0.1.0` baseline.
5. Verify branch identity.
6. Create a planning-only commit only after explicit user authorization.
7. Do not add xterm.js or `node-pty` before planning review is accepted.

---

## Phase 0 consistency reconciliation — required iPhone acceptance additions

**Reconciled:** 2026-07-24

1. **Authentication expiry with active control:** input and resize become unavailable immediately; the previous lease is shown as invalid; after reauthentication the user must explicitly reacquire control.
2. **Idle semantics:** ongoing PTY output, heartbeat, replay, and resize alone must not hide or postpone idle expiry. Accepted user input or an explicit authorized keep-alive/session action may reset it.
3. **Attachment clarity:** connection status and terminal attachment status are displayed as separate concepts. Leaving the Terminal destination must follow explicit retain/detach policy and may not silently infer lifecycle state.
4. **Single-client Phase 1:** the UI must not imply read-only observers or simultaneous viewer attachments.
5. **Failure truthfulness:** `FAILED` appears only after the cleanup attempt completes and must show cleanup outcome plus whether the process may still be active.
6. **Input boundary:** paste/input above the 48 KiB decoded limit is blocked before execution with clear recovery guidance; the complete transport frame remains capped at 64 KiB.
7. **UTF-8 behavior:** split multibyte characters render correctly; malformed bytes render deterministically as replacement characters without corrupting sequence/replay state.
