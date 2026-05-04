import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const __dirname = new URL(".", import.meta.url).pathname;

await esbuild.build({
	entryPoints: ["src/cli.ts"],
	bundle: true,
	platform: "node",
	target: "node22",
	format: "esm",
	outfile: "dist/cli.js",
	external: ["node-pty", "proper-lockfile"],
	banner: {
		js: "#!/usr/bin/env node",
	},
	define: {
		"process.env.NODE_ENV": '"production"',
	},
});

// Copy web UI build output
mkdirSync("dist/web-ui", { recursive: true });

console.log("Build complete.");
