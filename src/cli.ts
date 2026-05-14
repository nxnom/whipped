import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { Command } from "commander";
import open from "open";
import ora from "ora";
import { getDaemonLogPath, restartDaemon, startDaemon, statusDaemon, stopDaemon } from "./cli/daemon-commands.js";
import { isAlive, readState } from "./cli/daemon-state.js";
import { runLogs } from "./cli/logs-command.js";
import { DEFAULT_PORT } from "./config/runtime-config.js";
import { installGracefulShutdownHandlers } from "./core/graceful-shutdown.js";
import { logger } from "./core/logger.js";
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

async function runServerForeground(options: RunOptions): Promise<void> {
	const { port, host, noOpen } = options;
	const repoPath = process.cwd();

	if (!hasGitRepository(repoPath)) {
		logger.error("Error: overemployed must be run inside a git repository.");
		process.exit(1);
	}

	const portAvailable = await isPortAvailable(port, host);
	if (!portAvailable) {
		logger.error(`Error: port ${port} is already in use. Use --port to specify a different port.`);
		process.exit(1);
	}

	const spinner = ora("Starting overemployed...").start();

	let server: Awaited<ReturnType<typeof createRuntimeServer>>;
	try {
		server = await createRuntimeServer({ port, host, repoPath });
		spinner.succeed(`overemployed running at ${server.url}`);
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

	logger.info("Press Ctrl+C to stop. Tip: run `overemployed start` to background.");

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

// Bare invocation: open the browser if the daemon is already running, else
// run in the foreground.
async function runDefault(options: RunOptions): Promise<void> {
	const state = readState();
	if (state && isAlive(state.pid)) {
		console.log(`overemployed is already running at ${state.url} (pid ${state.pid}).`);
		if (!options.noOpen) {
			try {
				await open(state.url);
			} catch {
				// non-fatal
			}
		}
		console.log("Use `overemployed stop` to stop, `overemployed logs -f` to tail logs.");
		return;
	}
	await runServerForeground(options);
}

const program = new Command();
program.enablePositionalOptions();

program
	.name("overemployed")
	.description("Autonomous AI agent kanban board for Claude and Codex")
	.version(VERSION, "-v, --version")
	.option("--port <number>", "Port to listen on", String(DEFAULT_PORT))
	.option("--host <ip>", "Host to bind to", "127.0.0.1")
	.option("--no-open", "Do not open browser automatically")
	.action(async (options: { port: string; host: string; open: boolean }) => {
		await runDefault({
			port: Number(options.port),
			host: options.host,
			noOpen: !options.open,
		});
	});

program
	.command("start")
	.description("Start overemployed as a detached background daemon")
	.option("--port <number>", "Port to listen on", String(DEFAULT_PORT))
	.option("--host <ip>", "Host to bind to", "127.0.0.1")
	.action(async (opts: { port: string; host: string }) => {
		await startDaemon({ port: Number(opts.port), host: opts.host });
	});

program
	.command("stop")
	.description("Stop the background daemon")
	.action(async () => {
		await stopDaemon();
	});

program
	.command("restart")
	.description("Restart the background daemon")
	.option("--port <number>", "Port to listen on", String(DEFAULT_PORT))
	.option("--host <ip>", "Host to bind to", "127.0.0.1")
	.action(async (opts: { port: string; host: string }) => {
		await restartDaemon({ port: Number(opts.port), host: opts.host });
	});

program
	.command("status")
	.description("Show whether the daemon is running and where")
	.action(() => {
		statusDaemon();
	});

program
	.command("logs")
	.description("Show overemployed logs")
	.option("-f, --follow", "Follow log output (like tail -f)", false)
	.option("-n, --lines <count>", "Number of lines to show", "200")
	.action(async (opts: { follow: boolean; lines: string }) => {
		await runLogs({ follow: opts.follow, lines: Number(opts.lines) });
	});

program
	.command("help [command]")
	.description("Show help for a command")
	.action((command?: string) => {
		if (!command) {
			program.outputHelp();
			return;
		}
		const target = program.commands.find((c) => c.name() === command);
		if (!target) {
			console.error(`Unknown command: ${command}`);
			program.outputHelp();
			process.exit(1);
		}
		target.outputHelp();
	});

// Internal: actually run the server (used by `start` after detaching).
program
	.command("__daemon-run", { hidden: true })
	.option("--port <number>", "Port", String(DEFAULT_PORT))
	.option("--host <ip>", "Host", "127.0.0.1")
	.action(async (opts: { port: string; host: string }) => {
		await runServerForeground({
			port: Number(opts.port),
			host: opts.host,
			noOpen: true,
		});
	});

program.addHelpText(
	"after",
	`
Examples:
  $ overemployed              Open the board (smart default: foreground or open existing)
  $ overemployed start        Background daemon — keeps running after terminal closes
  $ overemployed logs -f      Tail the live log
  $ overemployed stop         Stop the background daemon
  $ overemployed help start   Show help for the start command

Daemon log: ${getDaemonLogPath()}
`,
);

program.parseAsync(process.argv).catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	logger.error(`Error: ${message}`);
	process.exit(1);
});
