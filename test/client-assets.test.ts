import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const root = resolve(import.meta.dirname, "..");

describe("mobile client assets", () => {
	it("keeps every JavaScript element reference aligned with the document", async () => {
		const [html, app] = await Promise.all([
			readFile(resolve(root, "public/index.html"), "utf8"),
			readFile(resolve(root, "public/app.js"), "utf8"),
		]);
		const ids = [...app.matchAll(/byId\("([^"]+)"\)/g)].map((match) => match[1]);
		assert(ids.length > 20);
		for (const id of new Set(ids)) {
			assert.match(html, new RegExp(`id=["']${id}["']`), `Missing #${id} in index.html`);
		}
		assert.doesNotMatch(app, /\.innerHTML\s*=/, "Host content must not be injected as HTML");
		assert.doesNotMatch(app, /\beval\s*\(/, "The mobile client must not evaluate host content");
	});

	it("retains the iPhone viewport, keyboard, safe-area, and zoom contracts", async () => {
		const [html, css, app] = await Promise.all([
			readFile(resolve(root, "public/index.html"), "utf8"),
			readFile(resolve(root, "public/app.css"), "utf8"),
			readFile(resolve(root, "public/app.js"), "utf8"),
		]);
		assert.match(html, /viewport-fit=cover/);
		assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
		assert.match(css, /safe-area-inset-top/);
		assert.match(css, /safe-area-inset-bottom/);
		assert.match(css, /prefers-color-scheme:\s*light/);
		assert.match(css, /prefers-reduced-motion:\s*reduce/);
		assert.match(app, /visualViewport/);
		assert.match(app, /event\.metaKey \|\| event\.ctrlKey/);
		assert.match(
			css,
			/\.extension-dialog textarea\s*\{[^}]*font-size:\s*16px;/s,
			"Text-entry controls must remain at least 16px to prevent iOS focus zoom",
		);
		assert.match(css, /\.composer textarea\s*\{[^}]*font-size:\s*16px;/s);
		assert.match(css, /\.spawn-form input\s*\{[^}]*font-size:\s*16px;/s);
	});

	it("ships installable icons and never puts API traffic in the shell cache", async () => {
		const [manifestText, worker] = await Promise.all([
			readFile(resolve(root, "public/manifest.webmanifest"), "utf8"),
			readFile(resolve(root, "public/sw.js"), "utf8"),
		]);
		const manifest = JSON.parse(manifestText) as {
			display: string;
			icons: Array<{ src: string; sizes: string }>;
		};
		assert.equal(manifest.display, "standalone");
		for (const icon of manifest.icons) {
			assert((await stat(resolve(root, "public", icon.src.replace(/^\//, "")))).isFile());
		}
		assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
		const shellBlock = worker.match(/const SHELL_PATHS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
		assert.doesNotMatch(shellBlock, /\/api/);
		assert.match(worker, /request\.method !== "GET"/);
	});
});
