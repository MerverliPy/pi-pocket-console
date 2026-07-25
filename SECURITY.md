# Security Model

> **Treat access to Pi Pocket Console like shell access to the host.**

Pi Pocket Console is a remote control surface for a process that can read and modify files, run commands, use network access, and read credentials available to its host process.

## Defaults

| Layer | Protection |
|---|---|
| **Network** | HTTP server listens on loopback only (`127.0.0.1`) |
| **Pairing** | Six-digit code, generated at startup, rate-limited (5 attempts per 10-minute window) |
| **Session** | Random, HttpOnly, SameSite=Strict cookie; 12-hour TTL |
| **CSRF** | Per-session token required for mutation requests |
| **Workspace** | Fixed at startup; phone cannot change it |
| **Controller** | Single renewable lease prevents two devices from driving one instance |
| **Request limits** | Body size capped at 3 MB; labels capped at 128 bytes |
| **Content Security** | Strict CSP, no third-party code, `frame-ancestors 'none'` |
| **Cache** | Service worker caches only the public app shell — never API responses, transcripts, tool output, or credentials |

## Remote Access

Keep the listener on `127.0.0.1` and place a private HTTPS proxy in front of it. [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) is the recommended deployment:

```
tailscale serve 31415
```

This keeps the app inside your tailnet and terminates HTTPS. **Do not use Tailscale Funnel** or expose the listener directly to the public internet.

Restart the gateway to invalidate all in-memory sessions and generate a new pairing code.

## Pi Privileges

Pi has no built-in permission system. The fixed startup workspace is **not a filesystem sandbox** — Pi and its shell commands can access anything available to the host account. Pi Pocket Console reports `Full host access` unless a real container or sandbox surrounds the gateway process.

UI confirmations are not a host security boundary.

For stronger isolation, run the gateway and Pi inside one of Pi's documented container or sandbox patterns.

## Project Trust

Pi Pocket Console never silently adds Pi's `--approve` option. Project-local extensions, skills, prompts, themes, and context files follow the trust decision saved by Pi on the host.

## Current Limitations

| Limitation | Impact |
|---|---|
| Pairing uses a one-time code, not a passkey | Weaker than FIDO2/WebAuthn |
| Device sessions are in-memory only | Restarting the gateway revokes all sessions |
| Shell is Pi RPC `bash` — not an interactive PTY | Cannot run `vim`, `tmux`, or other TUI apps |
| iOS background suspension may interrupt SSE | PWA reconnects and reconciles state on foreground |
| Stopped gateway cannot wake a sleeping host | No wake-on-LAN or push notification support |

These limitations are shown in the UI and must not be represented as completed security features.

## Security Vulnerability Reporting

Report security vulnerabilities by opening a [GitHub issue](https://github.com/calvinbrady/pi-pocket-console/issues/new) with the `security` label. Describe the vulnerability, how to reproduce it, and your suggested fix.
