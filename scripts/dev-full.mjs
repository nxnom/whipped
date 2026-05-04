import { spawn } from "node:child_process";

const env = { ...process.env, NODE_ENV: "development" };

const backend = spawn("pnpm", ["exec", "tsx", "src/cli.ts", "--no-open"], {
	env,
	stdio: "inherit",
	shell: true,
});

const frontend = spawn("pnpm", ["web:dev"], {
	env: { ...env, KANBOM_WEB_UI_PORT: "4174" },
	stdio: "inherit",
	shell: true,
});

function killTree(child) {
	try {
		// Kill the entire process group so shells and grandchildren are included
		process.kill(-child.pid, "SIGTERM");
	} catch {
		child.kill("SIGTERM");
	}
}

process.on("SIGINT", () => {
	killTree(backend);
	killTree(frontend);
	process.exit(0);
});
