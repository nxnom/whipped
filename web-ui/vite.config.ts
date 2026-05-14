import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss(), react()],
	build: {
		minify: false,
		sourcemap: true,
		outDir: "../dist/web-ui",
		emptyOutDir: true,
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
			"@runtime-contract": resolve(__dirname, "../src/core/api-contract.ts"),
			"@runtime-trpc": resolve(__dirname, "../src/trpc/app-router.ts"),
		},
	},
	server: {
		host: "127.0.0.1",
		port: 50007,
		strictPort: true,
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
