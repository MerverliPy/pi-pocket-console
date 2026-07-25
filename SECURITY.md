# Security model

Pi Pocket Console is a remote control surface for a process that can read and
modify files, run commands, use network access, and read credentials available
to its host process. Treat access to this app like shell access to the host.

## Defaults

- The HTTP server listens on loopback only.
- A six-digit pairing code is generated at startup and rate limited.
- Successful pairing creates a random, HttpOnly, SameSite session cookie.
- Mutation requests require a same-origin request and a per-session CSRF token.
- Every Pi instance starts in the configured workspace; the phone cannot
  choose a different startup directory.
- Only one browser profile (identified by a stable client ID generated with
  `crypto.randomUUID` and stored in localStorage) can control a given instance
  at a time. Two devices sharing the same session cookie are still isolated
  by their client ID.
- The number of live Pi instances is capped at 1 by default. The cap is
  configurable via `--max-instances` / `PI_POCKET_MAX_INSTANCES` and enforced
  atomically at the instance-manager level. The UI shows a capacity warning
  when the limit is reached.
- Request bodies and labels are size limited.
- Static assets use a strict Content Security Policy and no third-party code.
- The service worker caches only the public app shell. It never caches API
  responses, transcripts, tool output, provider credentials, or pairing data.

## Remote access

Keep the listener on `127.0.0.1` and place a private HTTPS proxy in front of it.
Tailscale Serve is the recommended initial deployment because it keeps the app
inside the tailnet and terminates HTTPS. Do not use Tailscale Funnel or expose
the listener directly to the public internet.

Pairing protects the application even inside the private network. Restart the
gateway to invalidate in-memory device sessions and generate a new pairing
code.

## Pi privileges

Pi has no built-in filesystem, process, network, or credential permission
system. The fixed startup workspace is not a filesystem sandbox: Pi and its
shell commands can still access anything available to the host account. Pi
Pocket Console therefore reports `Full host access` unless a real container or
sandbox surrounds the gateway process. UI confirmations are not a host
security boundary.

For stronger isolation, run the gateway and Pi inside one of Pi's documented
container or sandbox patterns with only the repository and credentials needed
for the task.

## Project trust

Pi Pocket Console never silently adds Pi's `--approve` option. Project-local
extensions, skills, prompts, themes, and context files follow the trust
decision already saved by Pi on the host. Review and establish that decision
locally before relying on project resources from mobile.

## Current limitations

- Pairing uses a one-time code, not a passkey.
- Device sessions are in memory and are revoked by restarting the gateway.
- The Shell surface uses Pi RPC `bash`; it is not an interactive PTY.
- Browser drafts (saved message text in localStorage) may contain sensitive
  prompts. They are stored only on this device and are never synchronized
  to the host. Clear them from the Controls menu.
- Browser background suspension can interrupt the live event stream. The PWA
  reconnects and rehydrates Pi state when it returns to the foreground.
- A stopped gateway cannot wake a sleeping host.

These limitations are shown in the UI and must not be represented as completed
security features.
