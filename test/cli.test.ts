import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Phase 1A: validate CLI startup contract for hybrid terminal scope

describe("CLI startup", () => {
	test("starts and gracefully stops in explicit loopback preview mode", async () => {
		const child = spawn(
			process.execPath,
			[
				"--import",
				"tsx",
				"src/cli.ts",
				"--workspace",
				projectRoot,
				"--local-insecure",
				"--host",
				"127.0.0.1",
				"--port",
				"0",
			],
			{
				cwd: projectRoot,
				env: {
					...process.env,
					PI_POCKET_HOST: "",
					PI_POCKET_ORIGIN: "",
					PI_POCKET_PORT: "",
					PI_POCKET_WORKSPACE: "",
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});

		await new Promise<void>((resolveReady, rejectReady) => {
			const timeout = setTimeout(() => {
				child.kill("SIGKILL");
				rejectReady(new Error(`CLI startup timed out.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
			}, 10_000);
			const poll = setInterval(() => {
				if (!stdout.includes("Pi Pocket Console is ready.")) {
					return;
				}
				clearTimeout(timeout);
				clearInterval(poll);
				resolveReady();
			}, 25);
			child.once("exit", (code, signal) => {
				clearTimeout(timeout);
				clearInterval(poll);
				rejectReady(new Error(`CLI exited before startup (code=${code}, signal=${signal}).\nstderr:\n${stderr}`));
			});
		});

		assert.match(stdout, /Pairing code:\s+\d{3} \d{3}/);
		assert.match(stdout, /Host access:\s+FULL/);
		const origin = stdout.match(/Local listener:\s+(http:\/\/\S+)/)?.[1];
		assert(origin, `CLI did not print its local listener.\n${stdout}`);
		const [indexResponse, appResponse] = await Promise.all([fetch(`${origin}/`), fetch(`${origin}/app.js`)]);
		assert.equal(indexResponse.status, 200);
		assert.match(indexResponse.headers.get("content-security-policy") ?? "", /default-src 'self'/);
		assert.match(await indexResponse.text(), /Pi Pocket Console/);
		assert.equal(appResponse.status, 200);
		assert.match(await appResponse.text(), /visualViewport/);
		child.kill("SIGTERM");
		const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
			child.once("exit", (code, signal) => resolveExit({ code, signal }));
		});
		assert.deepEqual(exit, { code: 0, signal: null });
	});
});
