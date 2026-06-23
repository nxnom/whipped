import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const __dirname = new URL(".", import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));

const sharedConfig = {
	bundle: true,
	platform: "node",
	target: "node22",
	format: "esm",
	// Externalized so they load from node_modules at runtime instead of being bundled:
	//  - native addons (better-sqlite3, node-pty) ship platform .node binaries;
	//  - proper-lockfile/pino/pino-pretty/thread-stream resolve files relative to themselves;
	//  - zod + the MCP SDK: bundling zod v4 mis-orders its internal class init
	//    (crashes the MCP server at import); keeping both external also guarantees a
	//    single shared zod instance between our schemas and the SDK.
	// All are runtime `dependencies`, so they're present for `npx`/global installs.
	external: [
		"better-sqlite3",
		"node-pty",
		"proper-lockfile",
		"pino",
		"pino-pretty",
		"thread-stream",
		"zod",
		"@modelcontextprotocol/sdk",
	],
	define: { "process.env.NODE_ENV": '"production"', __WHIPPED_VERSION__: `"${version}"` },
};

// Shim require()/__filename for CJS deps that reference them at runtime inside
// an ESM bundle. __dirname is left alone: the entry modules already declare their
// own via import.meta.url, and adding it here would be a duplicate declaration.
const esmRequireShim = [
	`import { createRequire as __ovrCreateRequire } from "node:module";`,
	`import { fileURLToPath as __ovrFileURLToPath } from "node:url";`,
	`const require = __ovrCreateRequire(import.meta.url);`,
	`const __filename = __ovrFileURLToPath(import.meta.url);`,
].join("\n");

await Promise.all([
	esbuild.build({
		...sharedConfig,
		entryPoints: ["src/cli.ts"],
		outfile: "dist/cli.js",
		banner: { js: `#!/usr/bin/env node\n${esmRequireShim}` },
	}),
	esbuild.build({
		...sharedConfig,
		entryPoints: ["src/mcp/kanban-mcp-server.ts"],
		outfile: "dist/mcp-server.js",
		banner: { js: `#!/usr/bin/env node\n${esmRequireShim}` },
	}),
]);

// Copy web UI build output
mkdirSync("dist/web-ui", { recursive: true });

// Copy SQL migration files (esbuild ignores .sql, but db.ts reads them at runtime).
// The bundle flattens to dist/cli.js, so db.ts's import.meta.url-relative
// "migrations" dir resolves to dist/migrations — copy there, not dist/state/migrations.
const migrationsSrc = "src/state/migrations";
const migrationsDst = "dist/migrations";
mkdirSync(migrationsDst, { recursive: true });
for (const file of readdirSync(migrationsSrc)) {
	if (file.endsWith(".sql")) {
		copyFileSync(join(migrationsSrc, file), join(migrationsDst, file));
	}
}

// Copy notification sound files. The bundle flattens to dist/cli.js, so
// sound-player.ts's import.meta.url-relative "sounds" dir resolves to dist/sounds.
const soundsSrc = "src/notifications/sounds";
const soundsDst = "dist/sounds";
mkdirSync(soundsDst, { recursive: true });
for (const file of readdirSync(soundsSrc)) {
	if (file.endsWith(".wav")) {
		copyFileSync(join(soundsSrc, file), join(soundsDst, file));
	}
}

console.log("Build complete.");
