# Pi Pocket Console v0.2 Visual System

**Status:** Planning baseline
**Product:** Pi Pocket Console v0.2
**Design direction:** Hybrid Precision + Native iOS
**Primary target:** iPhone 16 Pro PWA
**Secondary targets:** iPhone landscape, tablet, desktop
**Implementation branch:** `agent/v0.2-hybrid-terminal-pwa`

---

## 1. Purpose

This document defines the locked visual and interaction system for Pi Pocket Console v0.2.

It preserves the verified structured Pi controller while adding a first-class real PTY terminal. The interface must remain iPhone-first, security-aware, accessible, and operationally clear.

This document is authoritative for visual implementation unless the user explicitly reopens a decision.

---

## 2. Core design principles

1. **iPhone-first authority**
   The iPhone 16 Pro layout is the primary product surface and release acceptance target.

2. **Hybrid workspace model**
   The terminal and structured console are coordinated first-class surfaces.

3. **Operational clarity over decoration**
   Security, connection, controller-lease, approval, and recovery states must remain visible and understandable.

4. **Dense terminal, spacious structured controls**
   Terminal surfaces prioritize workspace efficiency. Structured controls prioritize readability and touch interaction.

5. **Native iOS behavior without imitation**
   Navigation, sheets, spacing, motion, focus, and touch behavior should feel consistent with iOS conventions without copying private Apple assets.

6. **Accessibility before density**
   Large text, Reduce Motion, increased contrast, VoiceOver, and touch-target requirements override workspace-density optimizations.

7. **No cyberpunk drift**
   No permanent glow, animated gradients, decorative scanlines, theatrical terminal effects, or ornamental hacker imagery.

---

## 3. Product information architecture

The application has six primary destinations:

1. Console
2. Terminal
3. Sessions
4. Files
5. Diagnostics
6. Settings

### 3.1 Console

- Structured Pi conversation
- Prompt composer
- Agent controls
- Provider and model status
- Tool events
- Approval events
- Operational cards

### 3.2 Terminal

- xterm.js viewport
- Session header
- Terminal shortcut bar
- Connection and controller-lease status
- Session actions
- Full-screen mode

### 3.3 Sessions

- Terminal sessions
- Pi agents
- Workspaces
- Running, detached, reconnecting, failed, expired, and terminated states
- Reconnect and termination controls

### 3.4 Files

- Workspace browsing
- Upload staging
- Recent files
- Explicitly authorized transfers

### 3.5 Diagnostics

- Gateway state
- Tailscale boundary
- Provider configuration
- Session events
- Redacted errors
- Recovery guidance

### 3.6 Settings

- Appearance
- Typography
- Density
- Terminal profiles
- Shortcut profiles
- Motion and haptics
- Storage policy
- Security and session controls

---

## 4. Locked color system — Precision Cyan

### 4.1 Core palette

| Token | Value | Usage |
|---|---:|---|
| `color.app.background` | `#0B0F12` | Main application background |
| `color.surface.elevated` | `#12181D` | Cards, sheets, elevated panels |
| `color.surface.secondary` | `#182127` | Secondary surfaces and grouped controls |
| `color.terminal.background` | `#070A0C` | Terminal canvas |
| `color.text.primary` | `#F2F7F9` | Primary text |
| `color.text.secondary` | `#9AA8AF` | Secondary text and metadata |
| `color.border.default` | `#29343A` | Borders and separators |
| `color.accent.primary` | `#38D9F2` | Primary cyan accent |
| `color.accent.active` | `#28A9FF` | Active and focus state |
| `color.status.success` | `#32D583` | Secure, verified, success |
| `color.status.warning` | `#F5B942` | Warning, reconnecting, approval |
| `color.status.error` | `#FF5C6C` | Destructive action and error |
| `color.status.offline` | `#75838A` | Offline and disconnected |

### 4.2 Color rules

- No permanent neon glow.
- No animated gradients.
- No color-only communication.
- Security colors remain semantic and fixed.
- ANSI terminal colors remain independent from interface colors.
- The UI cyan accent must not be confused with ANSI cyan.
- Use text, iconography, shape, and state labels with every important color signal.
- Validate all text and meaningful controls against WCAG contrast requirements.
- Under increased-contrast settings, strengthen boundaries and text contrast before increasing saturation.

---

## 5. Typography — Balanced Precision

### 5.1 Font families

**Interface stack**

```css
-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
"Helvetica Neue", Arial, sans-serif
```

**Monospace stack**

```css
ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Monaco,
Consolas, "Liberation Mono", monospace
```

Do not ship custom font files by default.

### 5.2 Locked type sizes

| Element | Size |
|---|---:|
| Navigation label | `11px` |
| Secondary label | `12px` |
| Body text | `15px` |
| Control text | `15px` |
| Sheet title | `20px` |
| Screen title | `24px` |
| Terminal default | `14px` |
| Terminal compact | `13px` |
| Terminal comfort | `16px` |
| Diagnostics and code | `13px` |

### 5.3 Typography rules

- Interface and terminal type sizes are controlled independently.
- Use system sans-serif for navigation, sheets, labels, status, settings, and explanations.
- Use monospace for terminal output, commands, paths, branch names, session IDs, timestamps, and diagnostics.
- Use tabular numerals for metrics and timestamps.
- Long identifiers truncate safely with tap-to-expand or copy.
- Dynamic Type and browser text scaling must not break core controls.
- Comfort First mode must increase readability without resetting terminal state.
- Avoid uppercase body copy.
- Minimum meaningful line-height target:
  - Interface body: `1.35`
  - Diagnostics: `1.35`
  - Terminal: validated per font and xterm cell geometry

---

## 6. Geometry — Precision Compact

### 6.1 Locked radii

| Element | Radius |
|---|---:|
| Terminal surface | `6px` |
| Cards | `10px` |
| Controls | `10px` |
| Bottom sheets | `18px` |
| Full-screen panels | `0–12px` |
| Pills and status chips | `999px` |

### 6.2 Locked spacing scale

| Token | Value |
|---|---:|
| Base unit | `4px` |
| Tight | `4px` |
| Control gap | `8px` |
| Card padding | `12px` |
| Section gap | `16px` |
| Screen gutter | `16px` |
| Large separation | `24px` |

### 6.3 Geometry rules

- Default touch targets should be approximately `44 × 44 CSS px`.
- Visual glyphs may be smaller than the interactive hit area.
- Terminal surfaces use tighter geometry than conversational controls.
- Do not reduce critical control hit areas in Maximum Workspace mode.
- Safe-area insets override fixed gutters.
- Keyboard-open layouts may compress spacing but must not overlap input, status, or emergency termination controls.

---

## 7. Iconography — System-Matched Technical Line

### 7.1 Construction

- Rounded `1.75px` strokes
- `20 × 20` and `24 × 24` optical grids
- Rounded joins
- Simple geometric silhouettes
- Maximum one accent detail
- Filled state reserved for active or critical conditions
- No decorative cyberpunk glyphs

### 7.2 Native-style icon group

Use native-style icons for:

- Primary navigation
- Search
- Attach
- Back
- Close
- More
- Send
- Stop
- Common actions

### 7.3 Custom technical icon group

Create custom icons for:

- Controller lease
- PTY lifecycle
- Detached terminal
- Reconnect window
- Agent instance
- Tailscale boundary
- Structured command mode
- Replay buffer

### 7.4 Accessibility

- Every unfamiliar icon requires a visible label or accessibility name.
- State must not be communicated by icon shape alone when ambiguity is likely.
- Technical icons must remain legible at `20px`.
- Avoid tiny interior details that disappear under increased text or display zoom.

---

## 8. App icon and splash — Terminal Aperture

### 8.1 App icon

- Graphite background
- Recessed terminal-window silhouette
- Cyan command-prompt mark
- Small secure-status dot
- No text
- No fine detail
- Recognizable at home-screen, Spotlight, notification, and Settings sizes

### 8.2 Splash screen

- Background: `#0B0F12`
- Centered Terminal Aperture icon
- Small `Pi Pocket Console` label
- Safe-area-aware placement
- Static presentation
- No decorative loading animation
- Show progress only when genuine startup work is occurring

### 8.3 Validation

Test icon legibility and cropping against all required PWA icon sizes, maskable-icon behavior, iOS home-screen presentation, and dark-mode launch transitions.

---

## 9. Density system

### 9.1 Profiles

- Balanced Precision — default
- Maximum Workspace
- Comfort First
- Custom

### 9.2 Automatic behavior

- Portrait with software keyboard: Balanced Precision
- Landscape with software keyboard: Maximum Workspace
- External keyboard: Maximum Workspace
- Large text or accessibility mode: Comfort First

### 9.3 Rules

- Users may lock a profile.
- Accessibility overrides automatic density behavior.
- Resize the terminal only after viewport stabilization.
- Preserve scroll position where practical.
- Density changes must never reset a terminal session.
- Density changes must not hide critical security, approval, connection, or termination state.

---

## 10. Navigation

### 10.1 Modes

- Persistent
- Auto-Minimizing — default
- Full-Screen

### 10.2 Full-screen requirements

- Enter through an explicit session action.
- Always expose a visible restore or exit affordance.
- Never hide critical connection, lease, authentication, approval, or emergency termination state.
- Do not silently carry full-screen mode into unrelated sessions.
- Preserve safe-area handling.
- Remain operable with VoiceOver and external keyboards.

---

## 11. Terminal header

### 11.1 Default presentation

```text
● CALVINPC   Generation-Ark   main   Secure
```

### 11.2 Priority order

1. Security and connection
2. Host
3. Workspace
4. Session or branch
5. Controller-lease ownership

### 11.3 Variants

- Balanced Precision: compact single-line context header
- Maximum Workspace: minimal host and status strip
- Comfort First: two-line context header
- Custom: user-selected fields within required-status constraints

Tapping the header opens the session details sheet.

---

## 12. Terminal surface

### 12.1 Default style

**Recessed Instrument Panel**

- Near-black surface
- Crisp one-pixel inset boundary
- Restrained cyan focus edge
- `6px` radius
- No glow
- No simulated hardware frame

### 12.2 Responsive behavior

- Balanced Precision: recessed panel
- Maximum Workspace: integrated edge-to-edge
- Full-Screen: edge-to-edge except required safe and status affordances

### 12.3 Rendering rules

- No blur or transparency behind terminal cells.
- Preserve ANSI contrast.
- Optional WebGL renderer with tested fallback.
- Use solid surfaces under reduced-transparency preferences.
- Prevent terminal canvas from extending beneath interactive controls.
- Validate alternate-screen applications, resize, selection, paste, and long scrollback.

---

## 13. Terminal cursor — Adaptive Block

- Solid block while focused
- Hollow block while unfocused
- Blink pauses during active output
- Blink may be disabled
- High-contrast fallback
- Cursor defaults to terminal foreground color
- UI cyan accent is not the default cursor color
- Cursor behavior must remain compatible with xterm.js and terminal applications

---

## 14. ANSI theme — Graphite ANSI

### 14.1 Direction

- Terminal background: `#070A0C`
- Neutral foreground with controlled brightness
- Restrained ANSI saturation
- Bright variants reserved for true bright colors
- UI cyan and ANSI cyan remain visibly distinct

### 14.2 Required validation

Test against:

- bash and zsh prompts
- Git status and diffs
- `tmux`
- `vim` and `nvim`
- warnings and errors
- ANSI 16-color output
- 256-color output
- truecolor output
- alternate screen
- selection contrast
- cursor contrast

Exact ANSI values remain an implementation token task and must pass contrast and semantic validation before release.

---

## 15. Terminal shortcut system

### 15.1 Primary row

```text
Ctrl   Esc   Tab   ↑   ↓   More
```

### 15.2 Secondary controls

```text
Alt   ←   →   PgUp   PgDn   Home   End
Ctrl+C   Ctrl+D   Ctrl+Z   Paste   Search
```

### 15.3 Rules

- Modifier states: off, sticky, locked
- Modifier state must be visible and announced accessibly
- Exact terminal sequences
- Separate portrait, landscape, and external-keyboard profiles
- Custom snippets require review
- Destructive actions remain outside the shortcut row
- Approximate `44 × 44 CSS px` touch targets
- Haptic feedback must be rate-limited and independently disableable
- Sticky or locked modifiers must not remain silently active across session changes

---

## 16. Structured console

### 16.1 Layout

**Hybrid Conversation + Operations**

- Spacious user and assistant conversation
- Compact operational cards for tools, approvals, files, agents, connection, and errors
- Routine success events collapsed
- Failures, approvals, reconnects, and security warnings expanded until handled
- Raw logs and paths expandable
- Terminal output not duplicated unless explicitly captured or summarized

### 16.2 Operational clarity

Every operation card should expose:

- Current state
- What occurred
- Whether host-side execution happened
- Required approval, if any
- Safest next action
- Expandable technical detail
- Timestamp when operationally relevant

---

## 17. Prompt composer

### 17.1 Default mode

**Expanding Native Composer**

### 17.2 Conversation mode

- Vertical expansion
- Send and stop
- Attach
- Commands control
- Agent and model context
- Draft preservation
- Offline state

### 17.3 Structured command mode

- Explicit activation
- Saved workflows
- Workspace targeting
- Parameter validation
- Preview before submission
- Approval-aware actions

### 17.4 Rules

- Separate drafts per mode.
- Switching modes never discards text.
- Remote writes and destructive actions require review.
- Offline mode preserves drafts but disables execution.
- The composer must remain reachable above the software keyboard.
- VoiceOver focus order must remain predictable during expansion.

---

## 18. Sheets, menus, and modals

### 18.1 Presentation mapping

| Task | Presentation |
|---|---|
| Quick selection | Compact bottom sheet |
| Session details | Medium or expanded bottom sheet |
| Shortcut editor | Full-screen workflow |
| Model/provider selection | Bottom sheet |
| Multi-step configuration | Full-screen workflow |
| Destructive action | Focused confirmation sheet |
| Small contextual action | Menu or popover |
| Terminal-critical state | Inline banner before sheet |

### 18.2 Rules

- Required approvals and destructive sheets cannot be casually dismissed.
- VoiceOver modal focus must be contained correctly.
- Focus returns to the initiating control.
- Long logs may expand to full screen.
- Do not stack multiple modal layers.
- Preserve visible critical session status while a sheet is open.

---

## 19. Status and error system

### 19.1 Layered status levels

- Routine success: brief toast or quiet inline confirmation
- Informational: compact inline status
- Persistent degradation: banner
- Approval required: operational card or sheet
- Critical failure: persistent banner and details sheet
- Terminal connection: always-visible compact indicator
- Raw diagnostics: expandable details

### 19.2 Required error content

Every error states:

1. What failed
2. Current impact
3. Whether anything executed
4. Safest next action

### 19.3 Rules

- Never imply successful host execution while disconnected.
- Never hide whether a process may still be active.
- Never expose secrets, provider keys, credentials, pairing codes, cookies, or raw environment variables.
- Error copy must be usable without opening raw diagnostics.
- Raw diagnostics remain collapsed by default.

---

## 20. Recovery and empty states

### 20.1 Required recovery states

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
- PWA update or reload required

### 20.2 Reusable recovery structure

```text
Plain-language title
Current impact
One primary recovery action
Secondary safe actions
Compact host/session context
Expandable technical diagnostics
```

### 20.3 Illustration policy — Functional Micro-Illustrations

- Small monochrome or two-tone line illustrations
- Limited to onboarding, genuine empty states, and noncritical recovery
- Uses the same technical icon language
- No mascots
- No decorative scenes
- No default animation
- Critical failures use structured diagnostics and status icons instead

### 20.4 Canonical offline example

```text
Host unavailable

Terminal input is paused.
The active process may still be running on CALVINPC.

[Reconnect]

Review connection details
Open cached workspace notes
```

---

## 21. Onboarding and pairing — Guided Security Steps

### 21.1 Step 1 — Confirm private connection

Display:

- Tailscale status
- Host identity
- Gateway availability
- Clear recovery path for each failed prerequisite

### 21.2 Step 2 — Enter pairing code

- Large segmented code input
- Paste support
- Visible expiration countdown
- Attempt-limit feedback
- No local persistence
- Do not expose the full code after submission

### 21.3 Step 3 — Confirm this device

- Device label
- Session duration
- Security summary
- Explicit pair action

### 21.4 Security presentation rules

- Do not suggest enabling Tailscale Funnel, router forwarding, or a public listener.
- Do not store pairing codes or raw secrets in browser storage.
- Do not imply tailnet membership alone is sufficient application authorization.
- Show authentication expiry and re-pairing requirements clearly.
- Avoid alarming language unless there is an actual security failure.

---

## 22. File browser — Dense Native Rows

### 22.1 Row content

- File or folder icon
- Name
- Compact path context
- Modified time
- Size where relevant
- Disclosure chevron only where navigation occurs
- Contextual action entry point

### 22.2 Rules

- Single-column default on iPhone
- Inline upload-staging rows
- Selection mode appears only when invoked
- Long names truncate safely with tap-to-expand
- Folders remain visually distinct without oversized cards
- Transfers require explicit authorization
- Do not imply upload completion before host confirmation
- Error rows remain recoverable in place

---

## 23. Sessions list — Operational Rows

### 23.1 Row content

- Session-type icon
- Host
- Workspace
- State label
- Branch or active process
- Last-activity timestamp
- Controller-lease ownership
- One primary contextual action
- Swipe or overflow controls for secondary actions

### 23.2 Expanded details

Use a medium bottom sheet for:

- Session ID
- Process
- Workspace
- Lease generation and owner
- Reconnect deadline
- Replay state
- Lifecycle history
- Terminate and force-terminate actions

### 23.3 Rules

- State labels must be explicit.
- Do not use color as the only state signal.
- Destructive actions require confirmation.
- Swipe actions must have non-swipe alternatives.
- Reconnecting and detached sessions remain distinguishable.
- Expired sessions must not appear recoverable when they are not.

---

## 24. Motion and haptics

### 24.1 Profiles

- Native Responsive — default
- Minimal
- Reduced Motion
- Custom

### 24.2 Default motion

- Restrained iOS-style sheet springs
- Short navigation transitions
- No terminal-cell movement
- Header and status fades or compact crossfades
- Direct full-screen transition
- No continuous activity animation

### 24.3 Haptics

- Light shortcut press
- Selection feedback for sticky modifier
- Stronger lock confirmation
- Success, warning, and error patterns
- Strong destructive confirmation after explicit action

### 24.4 Rules

- Honor operating-system Reduce Motion automatically.
- Respond to preference changes without reload where supported.
- Haptics are independently disableable.
- Rate-limit warning and reconnect haptics.
- No background surprise haptics.
- Do not rely on haptics as the sole feedback channel.

---

## 25. iPhone platform requirements

Implement dedicated platform modules for:

```text
apps/web/src/platform/ios/
├─ viewport-controller.ts
├─ keyboard-controller.ts
├─ safe-area-controller.ts
├─ orientation-controller.ts
├─ lifecycle-controller.ts
└─ standalone-controller.ts
```

Responsibilities include:

- Dynamic Island spacing
- Home indicator spacing
- `visualViewport`
- Keyboard-open resizing
- Rotation
- Standalone PWA mode
- Background and foreground transitions
- External keyboard handling
- Terminal fit debounce
- Scroll locking
- Selection and paste

### 25.1 Required behavior

- Never place critical controls beneath the Dynamic Island or home indicator.
- Recalculate terminal fit only after viewport stabilization.
- Avoid scroll-jump during keyboard appearance.
- Preserve draft text across backgrounding.
- Do not assume backgrounded WebSockets remain alive.
- Keep terminal status and reconnect behavior explicit after foregrounding.

---

## 26. Tablet and desktop — Progressive Terminal-First Expansion

### 26.1 Shared rule

The iPhone design remains authoritative. Larger screens add workspace capacity without changing required concepts, terminology, security behavior, or task completion paths.

### 26.2 Tablet

- Progressive two-column layouts
- Persistent Files or Sessions detail pane where useful
- Wider terminal viewport
- Optional side navigation at validated breakpoints
- Full touch support
- No hover-only actions

### 26.3 Desktop

Use Terminal-First Desktop Mode:

- Terminal is the dominant central workspace
- Console, Sessions, Files, and Diagnostics may dock beside it
- Panels are resizable and collapsible
- Keyboard shortcuts, hover states, and context menus are supported
- Structured Console remains first-class
- User can return to a balanced multi-surface layout
- Desktop layout state must not break the corresponding iPhone session

### 26.4 Cross-device consistency

- Preserve session identity and lifecycle state.
- Do not silently transfer the writable controller lease.
- Desktop layout preferences are non-sensitive.
- A desktop-only feature may not become required for mobile recovery or security control.

---

## 27. Accessibility requirements

### 27.1 Touch and motor access

- Target approximately `44 × 44 CSS px` for primary touch controls.
- Provide non-swipe alternatives.
- Keep destructive actions separated from routine controls.
- Avoid precision drag as the only way to resize or reorder.
- Ensure terminal emergency termination remains reachable.

### 27.2 VoiceOver

- Logical reading and focus order
- Accurate labels for custom technical icons
- State changes announced without excessive interruption
- Proper modal focus containment
- Focus restoration after dismissing sheets
- Accessible sticky and locked modifier state
- Terminal controls distinguishable from terminal content

### 27.3 Visual access

- WCAG-compliant text and control contrast
- Increased-contrast behavior
- No color-only status
- Large-text resilience
- Visible keyboard focus
- Solid terminal surfaces under reduced transparency
- High-contrast cursor fallback

### 27.4 Motion and sensory access

- Automatic Reduce Motion support
- No continuous decorative motion
- No flashing terminal decorations
- Haptics optional
- Status must remain understandable without haptics or animation

---

## 28. Design tokens

Recommended token namespaces:

```text
color.*
type.*
space.*
radius.*
border.*
shadow.*
motion.*
zIndex.*
safeArea.*
terminal.*
status.*
icon.*
density.*
```

Implementation should centralize tokens under:

```text
apps/web/src/design/
├─ tokens.ts
├─ typography.ts
├─ motion.ts
└─ iconography.ts
```

Rules:

- Avoid hard-coded values outside token definitions except validated terminal-rendering constants.
- Separate semantic tokens from raw palette tokens.
- Support increased contrast and Reduced Motion without duplicating component logic.
- Keep terminal ANSI tokens separate from application color tokens.

---

## 29. Required component mapping

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
├─ recovery/
│  ├─ RecoveryScreen.ts
│  ├─ RecoverySummary.ts
│  ├─ RecoveryActions.ts
│  └─ DiagnosticDetails.ts
├─ platform/ios/
│  ├─ viewport-controller.ts
│  ├─ keyboard-controller.ts
│  ├─ safe-area-controller.ts
│  ├─ orientation-controller.ts
│  ├─ lifecycle-controller.ts
│  └─ standalone-controller.ts
└─ design/
   ├─ tokens.ts
   ├─ typography.ts
   ├─ motion.ts
   └─ iconography.ts
```

---

## 30. Visual acceptance matrix

### 30.1 iPhone 16 Pro portrait

Validate:

- Six-destination navigation
- Software keyboard open and closed
- Balanced Precision
- Comfort First
- Full-screen terminal
- Safe areas
- Prompt composer
- Shortcut rows
- Pairing flow
- Recovery screens
- Long file and branch names
- Emergency termination

### 30.2 iPhone 16 Pro landscape

Validate:

- Maximum Workspace
- Keyboard-open terminal fit
- Shortcut profile
- Header minimization
- Full-screen restoration
- Session detail sheets
- No clipped safe-area controls

### 30.3 External keyboard

Validate:

- Hardware shortcuts
- Focus visibility
- Shortcut-bar adaptation
- Modifier state
- Escape and control sequences
- No hidden mobile-only recovery action

### 30.4 Tablet

Validate:

- Two-column transitions
- Touch operation
- Persistent detail panes
- Rotation
- Split-view widths
- No hover-only behavior

### 30.5 Desktop

Validate:

- Terminal-first layout
- Resizable panels
- Collapsible supporting surfaces
- Balanced-layout restoration
- Keyboard and pointer access
- No controller-lease theft across devices

---

## 31. Prohibited visual and interaction patterns

- Permanent neon glow
- Animated gradients
- Decorative scanlines
- Terminal cell animations
- Simulated hardware bezels
- Security state shown only by color
- Hidden emergency termination
- Dismissible required approvals
- Public-exposure suggestions
- Secret values in diagnostics
- Silent command queuing after reconnect
- Fake successful terminal output while offline
- Unbounded terminal scrollback
- Indefinite unattended session presentation
- Mobile workflows that require hover
- Swipe-only critical actions
- Desktop-only recovery paths
- Automatic writable controller transfer

---

## 32. Release gates for visual completion

Do not claim the visual system complete until:

1. Balanced Precision renders correctly on a physical iPhone 16 Pro.
2. Portrait and landscape safe areas pass.
3. Software-keyboard transitions do not obscure required controls.
4. Terminal fit remains stable after rotation and keyboard changes.
5. VoiceOver can navigate core flows.
6. Reduce Motion is honored.
7. Increased contrast remains usable.
8. Touch targets meet requirements.
9. Critical state is never color-only.
10. Full-screen terminal preserves emergency termination.
11. Offline and recovery screens do not imply command execution.
12. Pairing codes and secrets are not persisted.
13. Dense Files rows remain usable with long names.
14. Sessions rows distinguish running, detached, reconnecting, expired, and terminated states.
15. ANSI and cursor contrast pass representative terminal applications.
16. Desktop terminal-first mode does not weaken iPhone workflows.
17. The structured console remains first-class.
18. No visual choice reintroduces public-access or secret-storage risk.

---

## 33. Locked decision register

| # | Decision | Locked selection |
|---:|---|---|
| 1 | Color palette | Precision Cyan |
| 2 | Typography | Balanced Precision |
| 3 | Radius and spacing | Precision Compact |
| 4 | Technical icons | System-Matched Technical Line |
| 5 | App icon and splash | Terminal Aperture |
| 6 | Onboarding and pairing | Guided Security Steps |
| 7 | File browser | Dense Native Rows |
| 8 | Sessions list | Operational Rows |
| 9 | Terminal cursor | Adaptive Block |
| 10 | ANSI theme | Graphite ANSI |
| 11 | Empty-state illustrations | Functional Micro-Illustrations |
| 12 | Tablet and desktop | Progressive Terminal-First Expansion |

---

## 34. Implementation status

**Locked:** Core visual direction and all previously unresolved visual decisions.

**Needs validation:**

- Exact ANSI 16-color values
- Contrast measurements
- Dynamic Type and browser zoom behavior
- Physical iPhone 16 Pro safe-area measurements
- xterm.js cursor and renderer compatibility
- PWA icon mask behavior
- Terminal fit timing under `visualViewport`
- VoiceOver behavior inside the terminal viewport
- Desktop breakpoint values
- Tablet split-view behavior
- Haptic API availability and fallback behavior

**Not authorized by this document:**

- Remote repository writes
- Pull-request creation
- Pull-request merge
- Published release changes
- Implementation before Phase 0 planning review

---

## Phase 0 consistency reconciliation — terminology lock

**Reconciled:** 2026-07-24

The interface must distinguish **Connection** (global authenticated WebSocket transport), **Attachment** (this client subscribed to a terminal), and **Control** (valid writable lease). Phase 1 must not present read-only observers or multi-viewer state. Authentication expiry immediately renders control invalid and requires an explicit reacquire action after reauthentication. Public `FAILED` is shown only after cleanup has been attempted, with truthful cleanup outcome and residual-process uncertainty.
