import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const __dirname = new URL(".", import.meta.url).pathname;

const sharedConfig = {
	bundle: true,
	platform: "node",
	target: "node22",
	format: "esm",
	external: ["node-pty", "proper-lockfile", "pino", "pino-pretty", "thread-stream"],
	define: { "process.env.NODE_ENV": '"production"' },
};

// Shim require() for CJS deps (e.g. commander) that load node: builtins at
// runtime inside an ESM bundle.
const esmRequireShim = `import { createRequire as __ovrCreateRequire } from "node:module";\nconst require = __ovrCreateRequire(import.meta.url);`;

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

// Copy SQL migration files (esbuild ignores .sql, but db.ts reads them at runtime)
const migrationsSrc = "src/state/migrations";
const migrationsDst = "dist/state/migrations";
mkdirSync(migrationsDst, { recursive: true });
for (const file of readdirSync(migrationsSrc)) {
	if (file.endsWith(".sql")) {
		copyFileSync(join(migrationsSrc, file), join(migrationsDst, file));
	}
}

console.log("Build complete.");
