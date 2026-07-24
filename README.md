# Pi Pocket Console

An iPhone-first remote control surface for
[`earendil-works/pi`](https://github.com/earendil-works/pi), designed around the
iPhone 16 Pro's 402 × 874 point portrait viewport.

Pi Pocket Console runs beside Pi on your computer and translates Pi's JSONL
RPC stream into a touch-native Progressive Web App. It is a semantic
controller—not an ANSI terminal mirror or raw PTY—so prompts, streaming
responses, tool activity, models, queues, and shell runs remain usable on a
phone while provider credentials stay on the host.

## Prerequisites

- Node.js 22.19 or newer and npm.
- Pi credentials and settings configured on the host.
- A project directory the mobile controller may access.
- For remote use, [Tailscale](https://tailscale.com/download) on the host and
  iPhone, signed in to the same tailnet with access permitted by its policy.

From this project checkout:

```sh
npm ci
npm run check
npm test
```

## Private iPhone setup

[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) is the
recommended HTTPS boundary. The gateway itself remains on loopback.

1. In one terminal, start a private Serve proxy:

   ```sh
   tailscale serve 31415
   ```

   Tailscale may first ask you to enable HTTPS for the tailnet. Copy the exact
   `https://…ts.net` origin shown by Serve, and leave this command running.

2. In a second terminal, start Pi Pocket Console with that exact origin and an
   absolute workspace:

   ```sh
   npm run dev -- \
     --workspace /absolute/path/to/project \
     --origin https://your-host.your-tailnet.ts.net
   ```

   For the compiled entry point, run `npm run build`, then replace
   `npm run dev` above with `npm start`.

3. Open the HTTPS URL in Safari on the iPhone. Enter the six-digit code printed
   by the gateway. The code expires after 10 minutes and works once.

Keep this deployment private: do not use Tailscale Funnel, forward the port
from a router, or expose the listener to the public internet. Tailnet access
rules still apply; see the
[Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

### Add to Home Screen

In Safari, open the paired HTTPS site, choose **More or Share → Add to Home
Screen**, enable **Open as Web App**, then tap **Add**. Launch Pi Pocket Console
from its new Home Screen icon. Apple documents the current flow in
[Turn a website into an app on iPhone](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).

## Local host preview

For an HTTP preview in a browser on the same computer:

```sh
npm run dev -- \
  --workspace /absolute/path/to/project \
  --local-insecure
```

Open `http://127.0.0.1:31415`. This mode accepts insecure cookies only on
loopback and is intentionally unsuitable for remote iPhone access.

## Capabilities

| Area | Implemented behavior |
|---|---|
| Conversation | Prompt, steer, follow-up, abort, and queue controls over Pi RPC |
| Streaming | Assistant text, thinking, tool activity, retries, compaction, and connection recovery |
| Models | Model discovery and selection plus thinking-level controls |
| Sessions | Live state and message hydration plus a guarded new-session action |
| Rich input | Image prompts and Pi extension confirmation, select, input, and editor dialogs |
| Shell | Streamed Pi RPC `bash` execution; non-interactive and not a PTY |
| Instances | One Pi RPC child per live instance, always started in the configured workspace |
| Control | A renewable single-controller lease prevents two devices from driving one instance at once |
| Offline behavior | App-shell availability and local draft preservation; commands never execute offline |
| Credentials | Provider credentials and Pi configuration remain on the host |

## CLI

```text
pi-pocket --workspace <path> --origin <https-origin> [options]
pi-pocket --workspace <path> --local-insecure [options]
```

| Option | Purpose |
|---|---|
| `--workspace <path>` | Required fixed startup directory for every mobile Pi instance |
| `--origin <origin>` | Exact external HTTPS origin used for same-origin and cookie security |
| `--host <host>` | Listener address; defaults to `127.0.0.1` |
| `--port <port>` | Listener port; defaults to `31415` |
| `--local-insecure` | Loopback-only HTTP preview |
| `--tls-cert <path>` and `--tls-key <path>` | Native HTTPS alternative; both are required together |

`PI_POCKET_WORKSPACE`, `PI_POCKET_ORIGIN`, `PI_POCKET_HOST`, and
`PI_POCKET_PORT` are equivalent environment variables. Run
`npm run dev -- --help` or `pi-pocket --help` after installation for the full
reference.

## Security and limitations

Treat access to Pi Pocket Console like shell access to the host:

- Pi runs with the gateway user's filesystem, process, network, and credential
  privileges. The app is not a sandbox.
- Project trust follows Pi's saved host settings. The gateway never silently
  adds Pi's `--approve` option.
- Pairing is a rate-limited one-time code, not a passkey. Device sessions last
  up to 12 hours in memory; restarting the gateway revokes them and generates
  a new code.
- Gateway instances, controller leases, and conversation state are not a
  durable session service. A restart removes them, even if Pi has written its
  own session files on disk.
- The shell surface cannot run interactive PTY applications such as `vim` or
  `tmux`.
- iOS background suspension may interrupt the event stream. The app reconnects
  and reconciles state when foregrounded, but a stopped gateway cannot wake a
  sleeping host.
- The service worker caches only the public app shell—not API responses,
  transcripts, tool output, pairing data, or provider credentials.

Read the complete [security model](SECURITY.md) before remote use.

## Development

```sh
npm ci
npm run check
npm test
npm run build
```

The automated checks cover gateway security and controller behavior. Physical
device review is still required for the full
[iPhone acceptance matrix](docs/IPHONE-ACCEPTANCE.md).

Design and process boundaries are documented in
[Architecture](docs/ARCHITECTURE.md). Security disclosures belong in
[SECURITY.md](SECURITY.md).

## Upstream and license

Pi Pocket Console is a standalone companion to
[`earendil-works/pi`](https://github.com/earendil-works/pi). It uses
`@earendil-works/pi-coding-agent` and does not patch or embed Pi's terminal UI.

Pi Pocket Console is available under the [MIT License](LICENSE). Pi is an
upstream project with its own license and terms.
