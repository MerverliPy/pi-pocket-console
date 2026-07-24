import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { describe, test } from "node:test";
import { resolveRpcEntryPath } from "../src/rpc-process.ts";

describe("Pi RPC entry resolution", () => {
	test("uses the package's ESM import export", async () => {
		const entryPath = resolveRpcEntryPath();
		assert.match(entryPath, /pi-coding-agent[/\\]dist[/\\]rpc-entry\.js$/);
		assert.equal((await stat(entryPath)).isFile(), true);
	});
});
