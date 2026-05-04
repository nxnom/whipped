import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const __dirname = new URL(".", import.meta.url).pathname;

const sharedConfig = {
	bundle: true,
	platform: "node",
	target: "node22",
	format: "esm",
	external: ["node-pty", "proper-lockfile"],
	define: { "process.env.NODE_ENV": '"production"' },
};

await Promise.all([
	esbuild.build({
		...sharedConfig,
		entryPoints: ["src/cli.ts"],
		outfile: "dist/cli.js",
		banner: { js: "#!/usr/bin/env node" },
	}),
	esbuild.build({
		...sharedConfig,
		entryPoints: ["src/mcp/kanban-mcp-server.ts"],
		outfile: "dist/mcp-server.js",
		banner: { js: "#!/usr/bin/env node" },
	}),
]);

// Copy web UI build output
mkdirSync("dist/web-ui", { recursive: true });

console.log("Build complete.");
