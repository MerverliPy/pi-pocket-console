# Architecture

Pi Pocket Console is a standalone companion to [`earendil-works/pi`](https://github.com/earendil-works/pi). It does not patch or embed Pi's terminal UI.

## System Overview

```mermaid
flowchart LR
    A["📱 iPhone PWA"] -->|"HTTPS<br/>(Tailscale Serve)"| B["🔐 Pocket Gateway"]
    B -->|"JSONL over stdio"| C["🧠 Pi RPC Process"]
    C --> D["🔧 Agent Session & Tools"]
    D --> E["📁 Configured Workspace"]

    subgraph "Host Computer"
        B
        C
        D
        E
    end

    style A fill:#1a1a2e,stroke:#63e6df,color:#edf7f8
    style B fill:#16213e,stroke:#83b9ff,color:#edf7f8
    style C fill:#0f3460,stroke:#6ae2a0,color:#edf7f8
    style D fill:#11171c,stroke:#ffc66d,color:#edf7f8
    style E fill:#080b0e,stroke:#66777c,color:#edf7f8
```

## Request Flow

```mermaid
sequenceDiagram
    participant PWA as iPhone PWA
    participant GW as Pocket Gateway
    participant AUTH as Auth Manager
    participant RPC as Pi RPC Process

    PWA->>GW: POST /api/pair {code}
    GW->>AUTH: verify pairing code
    AUTH-->>GW: session + CSRF token
    GW-->>PWA: 200 {csrfToken} + Set-Cookie

    PWA->>GW: GET /api/bootstrap (cookie)
    GW->>AUTH: authenticate session
    AUTH-->>GW: session
    GW-->>PWA: 200 {instances, workspace, csrfToken}

    PWA->>GW: POST /api/instances (cookie + CSRF)
    GW->>RPC: spawn child process
    RPC-->>GW: get_state response
    GW-->>PWA: 201 {instance}

    PWA->>GW: GET /api/instances/{id}/events
    GW-->>PWA: 200 SSE stream (snapshot + events)

    PWA->>GW: POST /api/instances/{id}/commands (cookie + CSRF)
    GW->>RPC: send command via JSONL
    RPC-->>GW: response
    GW-->>PWA: 200 {ok, commandId, response}

    Note over PWA,RPC: SSE delivers streaming events<br/>(text, thinking, tools, status)
```

## Why the UI Is Semantic

Pi's TUI is designed for a terminal cell grid and hardware keyboard. Scaling that grid into a 402-point portrait viewport makes text, selection, tool activity, and shortcuts unnecessarily difficult.

The companion instead consumes Pi's typed RPC commands and events:

- `prompt`, `steer`, `follow-up`, `abort`, and queue updates
- Streamed assistant text, thinking, tools, retries, and compaction
- Model and thinking-level discovery and selection
- Session state, messages, entries, tree, statistics, clone, and new session
- Image prompts and extension input dialogs
- RPC shell execution and streamed output

The PWA renders those events as touch-native controls while Pi and all provider credentials remain on the host.

## Process Boundaries

```
┌─────────────────────────────────────────────────────┐
│                  Pocket Gateway                      │
│                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   Auth    │  │  Instance    │  │  Controller    │  │
│  │  Manager  │  │   Manager    │  │    Leases      │  │
│  └──────────┘  └──────┬───────┘  └───────────────┘  │
│                        │                             │
│  ┌─────────────────────▼──────────────────────────┐  │
│  │              Stream Hub (SSE)                   │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │            HTTP Server + Router                 │  │
│  │  - Security headers   - Rate limiting           │  │
│  │  - CSRF enforcement   - Static serving          │  │
│  │  - Origin validation  - Path traversal guard    │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │
              JSONL over stdio
                       │
┌──────────────────────▼──────────────────────────────┐
│              Pi RPC Child Process                    │
│  Spawned per instance, configured workspace as CWD   │
└─────────────────────────────────────────────────────┘
```

The gateway starts one Pi RPC child process per live instance, always with the configured workspace as its working directory. It correlates command responses, fans events into Server-Sent Events, and forwards extension UI responses.

The HTTP layer adds controls that Pi RPC itself does not provide:

- Device pairing and session cookies
- CSRF and same-origin checks
- A single-controller lease
- Workspace-root enforcement
- Request and rate limits
- PWA asset delivery and security headers

## Key Components

| Component | File | Responsibility |
|---|---|---|
| `AuthManager` | `src/auth.ts` | Pairing codes, session tokens, CSRF tokens, rate-limited attempts |
| `PocketRpcProcess` | `src/rpc-process.ts` | Spawns Pi RPC child, JSONL communication, timeout handling |
| `InstanceManager` | `src/instance-manager.ts` | Instance lifecycle, status tracking, listener fan-out |
| `StreamHub` | `src/server.ts` | SSE stream management, history replay, keepalive, backpressure |
| `ControllerLeases` | `src/controller-lease.ts` | Single-controller lease with TTL |
| CLI entry | `src/cli.ts` | Argument parsing, TLS loading, signal handling |

## Deliberate Non-Goals for v0.1

- Public-internet hosting
- Client-side provider keys
- Recreating the removed Pi web UI
- ANSI TUI mirroring
- Interactive PTY applications such as `vim` or `tmux`
- A claim that Pi is sandboxed when it is not
