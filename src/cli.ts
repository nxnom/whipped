import { logger } from "./core/logger.js";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { Command } from "commander";
import open from "open";
import ora from "ora";
import { DEFAULT_PORT } from "./config/runtime-config.js";
import { installGracefulShutdownHandlers } from "./core/graceful-shutdown.js";
import { createRuntimeServer } from "./server/runtime-server.js";

// Ignore SIGPIPE so a closed pipe/socket doesn't crash the process
process.on("SIGPIPE", () => {});
// Swallow EPIPE errors from broken HTTP/WS connections
process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE" || err.code === "ECONNRESET") return;
	throw err;
});

const VERSION = "0.1.0";

function hasGitRepository(path: string): boolean {
	const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
		cwd: path,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	return result.status === 0 && result.stdout.trim() === "true";
}

async function isPortAvailable(port: number, host: string): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = createServer();
		probe.once("error", () => resolve(false));
		probe.listen(port, host, () => probe.close(() => resolve(true)));
	});
}

interface RunOptions {
	port: number;
	host: string;
	noOpen: boolean;
}

async function runServer(options: RunOptions): Promise<void> {
	const { port, host, noOpen } = options;
	const repoPath = process.cwd();

	if (!hasGitRepository(repoPath)) {
		logger.error("Error: kanbom must be run inside a git repository.");
		process.exit(1);
	}

	const portAvailable = await isPortAvailable(port, host);
	if (!portAvailable) {
		logger.error(`Error: port ${port} is already in use. Use --port to specify a different port.`);
		process.exit(1);
	}

	const spinner = ora("Starting kanbom...").start();

	let server: Awaited<ReturnType<typeof createRuntimeServer>>;
	try {
		server = await createRuntimeServer({ port, host, repoPath });
		spinner.succeed(`kanbom running at ${server.url}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		spinner.fail(`Failed to start: ${message}`);
		process.exit(1);
	}

	if (!noOpen) {
		try {
			await open(server.url);
		} catch {
			// non-fatal
		}
	}

	logger.info("Press Ctrl+C to stop.");

	let shuttingDown = false;
	installGracefulShutdownHandlers({
		process,
		delayMs: 10_000,
		exit: (code) => process.exit(code),
		onShutdown: async () => {
			if (shuttingDown) return;
			shuttingDown = true;
			const indicator = ora("Cleaning up...").start();
			await server.close();
			indicator.succeed("Cleaned up.");
		},
		onShutdownError: (error) => {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`Shutdown error: ${message}`);
		},
		onTimeout: (delayMs) => {
			logger.error(`Forced exit after ${delayMs}ms timeout.`);
		},
		onSecondSignal: (signal) => {
			logger.error(`Forced exit on second ${signal}.`);
		},
	});
}

const program = new Command();

program
	.name("kanbom")
	.description("Autonomous AI agent kanban board for Claude and Codex")
	.version(VERSION, "-v, --version")
	.option("--port <number>", "Port to listen on", String(DEFAULT_PORT))
	.option("--host <ip>", "Host to bind to", "127.0.0.1")
	.option("--no-open", "Do not open browser automatically")
	.action(async (options: { port: string; host: string; open: boolean }) => {
		await runServer({
			port: Number(options.port),
			host: options.host,
			noOpen: !options.open,
		});
	});

program.parseAsync(process.argv).catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	logger.error(`Error: ${message}`);
	process.exit(1);
});
