# iPhone acceptance contract

Primary target: iPhone 16 Pro at a 402 × 874 CSS-point portrait viewport and
874 × 402 landscape viewport. The layout remains responsive and never
model-sniffs.

## Layout and input

- `viewport-fit=cover` with runtime `safe-area-inset-*` values.
- Dynamic viewport height plus `visualViewport` correction for the software
  keyboard.
- One transcript scroll container; the document itself does not become the
  terminal scroller.
- Composer input is at least 16 px to prevent Safari focus zoom.
- Every interactive target is at least 44 × 44 CSS px.
- Return inserts a newline; the visible Send control submits. `Command+Enter`
  also submits for a hardware keyboard.
- Pinch zoom and native text selection remain available.

## Display modes

- Safari tab.
- Installed Home Screen PWA.
- Portrait and landscape.
- Keyboard repeatedly shown and dismissed.
- Default and increased text size.
- Dark, light, increased-contrast, reduced-transparency, and reduced-motion
  preferences.

## Recovery

- Offline drafts remain local and never execute automatically.
- Foreground, `pageshow`, and `online` events trigger state reconciliation.
- Reconnecting and offline states remain explicit text, never color alone.
- Background suspension may stop live streaming; the host-side Pi process
  remains authoritative.

## Accessibility

- Semantic landmarks, buttons, dialogs, labels, and status regions.
- Visible keyboard focus and logical focus restoration after sheets close.
- Streaming tokens are not individually announced to assistive technology.
- Connection errors and completed responses receive concise announcements.
- Tool output remains selectable, copyable, and expandable.

## Manual device matrix

| Test | Required result |
|---|---|
| Safari portrait | No clipping behind browser chrome, Dynamic Island, or home indicator |
| Safari landscape | Composer, sheets, and primary controls remain reachable |
| Home Screen portrait | Standalone navigation and reconnect controls are present |
| Keyboard open/close | No blank gap, overlap, or oscillating layout |
| Rotate while streaming | Draft and transcript position survive |
| 200% text zoom | No lost action or page-level horizontal scrolling |
| Reduce Motion | Decorative transitions are removed |
| VoiceOver | Pair, launch, send, inspect tool, and stop are operable |
| Offline/foreground | Draft is preserved and not automatically sent |
| External keyboard | Focus order and `Command+Enter` work |

Physical-device confirmation remains required before claiming complete
iPhone-specific acceptance.
