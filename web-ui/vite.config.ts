import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss(), react()],
	build: {
		minify: false,
		sourcemap: false,
		outDir: "../dist/web-ui",
		emptyOutDir: true,
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
			"@runtime-contract": resolve(__dirname, "../src/core/api-contract.ts"),
			"@runtime-validation": resolve(__dirname, "../src/core/validation"),
		},
	},
	server: {
		host: "127.0.0.1",
		port: 50007,
		strictPort: true,
		// Open the frontend (this dev server) on start — not the backend API port.
		// In dev the backend runs with --no-open; the UI lives here and proxies /api → 50008.
		open: true,
		allowedHosts: true,
		proxy: {
			"/api": {
				target: `http://127.0.0.1:50008`,
				changeOrigin: true,
				ws: true,
			},
			"/ws": {
				target: `ws://127.0.0.1:50008`,
				ws: true,
			},
		},
	},
});
