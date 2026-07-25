#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { env, exit } from "node:process";
import { type PocketServer, startPocketServer } from "./server.ts";

interface CliOptions {
	workspaceRoot: string;
	host?: string;
	port?: number;
	publicOrigin?: string;
	localInsecure: boolean;
	tlsCertPath?: string;
	tlsKeyPath?: string;
	maxInstances?: number;
}

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

function printHelp(): void {
	console.log(`Pi Pocket Console v${packageJson.version}

Usage:
  pi-pocket --workspace <path> --origin <https-origin> [options]
  pi-pocket --workspace <path> --local-insecure [options]

Required:
  --workspace <path>       Fixed startup working directory for mobile Pi instances.

Private HTTPS proxy mode (recommended):
  --origin <origin>        Exact external HTTPS origin, such as
                           https://calvinpc.example-tailnet.ts.net

Local preview mode:
  --local-insecure         Allow HTTP cookies on loopback only. Never use remotely.

Options:
  --host <host>            Listener address. Default: 127.0.0.1
  --port <port>            Listener port. Default: 31415
  --max-instances <n>      Maximum concurrent live Pi instances. Default: 1
  --tls-cert <path>        PEM certificate for native HTTPS.
  --tls-key <path>         PEM private key for native HTTPS.
  -h, --help               Show this help.
  -v, --version            Print the version.

Environment equivalents:
  PI_POCKET_WORKSPACE, PI_POCKET_ORIGIN, PI_POCKET_HOST, PI_POCKET_PORT,
  PI_POCKET_MAX_INSTANCES

Recommended private remote path:
  1. Start Pi Pocket with --origin set to the Tailscale Serve HTTPS URL.
  2. In another terminal, run: tailscale serve 31415
  3. Open the displayed HTTPS URL on the paired iPhone.

Pi Pocket starts Pi with the host user's privileges. It does not auto-approve
project resources and it does not turn Pi into a sandbox.`);
}

function valueAfter(args: string[], index: number, flag: string): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

function parsePort(value: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 0 || port > 65_535) {
		throw new Error(`Invalid port: ${value}`);
	}
	return port;
}

function parseUnsignedInt(value: string, name: string): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1 || n > 256) {
		throw new Error(`${name} must be an integer between 1 and 256: ${value}`);
	}
	return n;
}

function parseArgs(args: string[]): CliOptions | "help" | "version" {
	let workspaceRoot = env.PI_POCKET_WORKSPACE;
	let host = env.PI_POCKET_HOST;
	let port = env.PI_POCKET_PORT ? parsePort(env.PI_POCKET_PORT) : undefined;
	let publicOrigin = env.PI_POCKET_ORIGIN;
	let maxInstances = env.PI_POCKET_MAX_INSTANCES
		? parseUnsignedInt(env.PI_POCKET_MAX_INSTANCES, "PI_POCKET_MAX_INSTANCES")
		: undefined;
	let localInsecure = false;
	let tlsCertPath: string | undefined;
	let tlsKeyPath: string | undefined;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		switch (argument) {
			case "--help":
			case "-h":
				return "help";
			case "--version":
			case "-v":
				return "version";
			case "--workspace":
				workspaceRoot = valueAfter(args, index, argument);
				index += 1;
				break;
			case "--host":
				host = valueAfter(args, index, argument);
				index += 1;
				break;
			case "--port":
				port = parsePort(valueAfter(args, index, argument));
				index += 1;
				break;
			case "--origin":
				publicOrigin = valueAfter(args, index, argument);
				index += 1;
				break;
			case "--local-insecure":
				localInsecure = true;
				break;
			case "--max-instances":
				maxInstances = parseUnsignedInt(valueAfter(args, index, argument), "--max-instances");
				index += 1;
				break;
			case "--tls-cert":
				tlsCertPath = valueAfter(args, index, argument);
				index += 1;
				break;
			case "--tls-key":
				tlsKeyPath = valueAfter(args, index, argument);
				index += 1;
				break;
			default:
				throw new Error(`Unknown option: ${argument}`);
		}
	}

	if (!workspaceRoot) {
		throw new Error("--workspace is required");
	}
	if (localInsecure && publicOrigin) {
		throw new Error("--local-insecure cannot be combined with --origin");
	}
	if ((tlsCertPath && !tlsKeyPath) || (!tlsCertPath && tlsKeyPath)) {
		throw new Error("--tls-cert and --tls-key must be provided together");
	}
	if (localInsecure && tlsCertPath) {
		throw new Error("--local-insecure cannot be combined with --tls-cert/--tls-key");
	}
	if (!localInsecure && !publicOrigin && !tlsCertPath) {
		throw new Error("--origin is required unless --local-insecure or native TLS is used");
	}

	return {
		workspaceRoot,
		host,
		port,
		publicOrigin,
		localInsecure,
		tlsCertPath,
		tlsKeyPath,
		maxInstances,
	};
}

async function loadTls(options: CliOptions): Promise<{ cert: Buffer; key: Buffer } | undefined> {
	if (!options.tlsCertPath || !options.tlsKeyPath) {
		return undefined;
	}
	const [cert, key] = await Promise.all([readFile(options.tlsCertPath), readFile(options.tlsKeyPath)]);
	return { cert, key };
}

function printStartup(server: PocketServer, localInsecure: boolean, nativeTls: boolean): void {
	const localProtocol = nativeTls ? "https" : "http";
	const localUrl = `${localProtocol}://${server.host.includes(":") ? `[${server.host}]` : server.host}:${server.port}`;
	const groupedCode = `${server.pairingCode.slice(0, 3)} ${server.pairingCode.slice(3)}`;

	console.log(`
Pi Pocket Console is ready.

Workspace:      ${server.workspaceRoot}
Local listener: ${localUrl}
Open on iPhone: ${server.origin}
Pairing code:   ${groupedCode}
Host access:    FULL
Project trust:  Host Pi settings; no mobile approval override

The pairing code expires after 10 minutes and can be used once.`);
	if (localInsecure) {
		console.warn("\nWARNING: local HTTP preview mode is active. Do not expose this listener remotely.");
	}
}

async function run(): Promise<void> {
	let parsed: CliOptions | "help" | "version";
	try {
		parsed = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.error("Run pi-pocket --help for usage.");
		exit(1);
	}

	if (parsed === "help") {
		printHelp();
		return;
	}
	if (parsed === "version") {
		console.log(packageJson.version);
		return;
	}

	const server = await startPocketServer({
		workspaceRoot: parsed.workspaceRoot,
		host: parsed.host,
		port: parsed.port,
		publicOrigin: parsed.publicOrigin,
		localInsecure: parsed.localInsecure,
		tls: await loadTls(parsed),
		maxInstances: parsed.maxInstances,
	});
	printStartup(server, parsed.localInsecure, parsed.tlsCertPath !== undefined);

	let shutdownPromise: Promise<void> | undefined;
	const shutdown = (signal: string): void => {
		if (shutdownPromise) {
			return;
		}
		console.log(`\n${signal} received; stopping Pi Pocket Console...`);
		shutdownPromise = server
			.close()
			.then(() => exit(0))
			.catch((error: unknown) => {
				console.error(error instanceof Error ? error.message : String(error));
				exit(1);
			});
	};
	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
}

await run().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	exit(1);
});
