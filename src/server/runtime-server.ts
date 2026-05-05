import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { WebSocketServer } from "ws";
import { writeClaudeTaskHookSettings } from "../agents/agent-hooks.js";
import { DEFAULT_PORT, loadGlobalConfig } from "../config/runtime-config.js";
import type { RuntimeBoardCard } from "../core/api-contract.js";
import { BoardPoller } from "../daemon/poller.js";
import { runReviewPipeline } from "../daemon/review-pipeline.js";
import { getMcpServerPath, TaskScheduler } from "../daemon/scheduler.js";
import { createGithubClient } from "../github/github-client.js";
import {
	listWorkspaces,
	loadProjectConfig,
	loadWorkspaceContext,
	loadWorkspaceState,
} from "../state/workspace-state.js";
import { loadTerminalBuffer } from "../state/workspace-state.js";
import { type AppContext, appRouter } from "../trpc/app-router.js";
import { RuntimeStateHub } from "./runtime-state-hub.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

interface ServerOptions {
	port?: number;
	host?: string;
	repoPath: string;
}

export async function createRuntimeServer(options: ServerOptions) {
	const { port = DEFAULT_PORT, host = "127.0.0.1", repoPath } = options;

	const globalConfig = await loadGlobalConfig();
	const initialCtx = await loadWorkspaceContext(repoPath);

	const stateHub = new RuntimeStateHub();
	const schedulers = new Map<string, TaskScheduler>();
	const pollers = new Map<string, BoardPoller>();

	async function ensureWorkspace(workspaceId: string): Promise<{ workspaceId: string; repoPath: string }> {
		const workspaces = await listWorkspaces();
		const ws = workspaces.find((w) => w.workspaceId === workspaceId);
		if (!ws) throw new Error(`Workspace not found: ${workspaceId}`);

		if (!schedulers.has(workspaceId)) {
			await initWorkspace(workspaceId, ws.repoPath);
		}
		return ws;
	}

	async function initWorkspace(workspaceId: string, wsRepoPath: string): Promise<void> {
		if (schedulers.has(workspaceId)) return;

		const projectConfig = await loadProjectConfig(workspaceId);
		const config = await loadGlobalConfig();

		const githubClient = projectConfig.github?.token ? createGithubClient(projectConfig.github.token) : undefined;

		stateHub.registerWorkspace(workspaceId, wsRepoPath);

		// Guard against duplicate review pipelines — both onTaskCompleted and the
		// poller can observe the same in_review card. The Set is the single source
		// of truth for which tasks currently have a running pipeline.
		const activeReviews = new Set<string>();

		function startReview(card: RuntimeBoardCard): void {
			if (activeReviews.has(card.id)) return;
			activeReviews.add(card.id);

			(async () => {
				const latestProjectConfig = await loadProjectConfig(workspaceId);
				const latestGithubClient = latestProjectConfig.github?.token
					? createGithubClient(latestProjectConfig.github.token)
					: undefined;
				await runReviewPipeline(card, {
					workspaceId,
					repoPath: wsRepoPath,
					serverUrl: `http://${host}:${port}`,
					mcpBinary: getMcpServerPath(),
					codeReviewAgent: config.review.codeReviewAgent,
					qaAgent: config.review.qaAgent,
					maxAutoFixAttempts: config.maxAutoFixAttempts,
					stateHub,
					githubClient: latestGithubClient,
					codeReviewPrompt: latestProjectConfig.codeReviewPrompt,
					qaPrompt: latestProjectConfig.qaPrompt,
					registerStopCallback: scheduler.registerStopCallback.bind(scheduler),
					registerLiveProcess: scheduler.registerLiveProcess.bind(scheduler),
				});
			})().finally(() => activeReviews.delete(card.id));
		}

		const scheduler = new TaskScheduler({
			workspaceId,
			repoPath: wsRepoPath,
			serverUrl: `http://${host}:${port}`,
			maxParallelTasks: projectConfig.maxParallelTasks ?? config.maxParallelTasks,
			maxAutoFixAttempts: config.maxAutoFixAttempts,
			defaultAgent: projectConfig.defaultAgent ?? config.defaultAgent,
			stateHub,
			onTaskCompleted: (taskId) => {
				loadWorkspaceState(workspaceId, wsRepoPath)
					.then((state) => {
						const card = state.board.cards[taskId];
						if (card?.columnId === "in_review") {
							startReview(card);
						}
					})
					.catch(() => {});
			},
		});

		const poller = new BoardPoller({
			workspaceId,
			repoPath: wsRepoPath,
			pollingIntervalSeconds: config.pollingIntervalSeconds,
			scheduler,
			onCardReadyForReview: (card: RuntimeBoardCard) => {
				startReview(card);
			},
		});

		schedulers.set(workspaceId, scheduler);
		pollers.set(workspaceId, poller);

		if (projectConfig.autonomousModeEnabled) {
			poller.start();
		}
	}

	// Init all known workspaces on startup
	const allWorkspaces = await listWorkspaces();
	for (const ws of allWorkspaces) {
		await initWorkspace(ws.workspaceId, ws.repoPath);
	}
	// Always init the current cwd workspace
	await initWorkspace(initialCtx.workspaceId, repoPath);

	function createContext(): AppContext {
		return {
			stateHub,
			getScheduler: (id) => schedulers.get(id),
			getPoller: (id) => pollers.get(id),
			ensureWorkspace,
			currentWorkspaceId: initialCtx.workspaceId,
			currentRepoPath: repoPath,
		};
	}

	const webUiDistPath = join(__dirname, "..", "web-ui");
	const webUiIndexPath = join(webUiDistPath, "index.html");
	const hasWebUi = existsSync(webUiIndexPath);

	const httpServer = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://${host}`);

		if (url.pathname === "/api/hook") {
			const event = url.searchParams.get("event") as "stop" | "user_prompt" | null;
			const taskId = url.searchParams.get("taskId");
			const workspaceId = url.searchParams.get("workspaceId");
			if (event && taskId && workspaceId) {
				const scheduler = schedulers.get(workspaceId);
				if (scheduler) {
					void scheduler.handleHookEvent(event, taskId);
				}
			}
			res.writeHead(200, { "Content-Type": "text/plain" });
			res.end("ok");
			return;
		}

		if (url.pathname.startsWith("/api/trpc")) {
			const fetchReq = new Request(`http://${host}${req.url}`, {
				method: req.method,
				headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
				body: req.method !== "GET" && req.method !== "HEAD" ? await readBody(req) : undefined,
			});

			const response = await fetchRequestHandler({
				endpoint: "/api/trpc",
				req: fetchReq,
				router: appRouter,
				createContext,
			});

			res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
			res.end(await response.text());
			return;
		}

		if (hasWebUi) {
			const filePath =
				url.pathname === "/" || !url.pathname.includes(".") ? webUiIndexPath : join(webUiDistPath, url.pathname);

			if (existsSync(filePath)) {
				const content = readFileSync(filePath);
				res.writeHead(200, { "Content-Type": getContentType(filePath) });
				res.end(content);
				return;
			}

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(readFileSync(webUiIndexPath));
			return;
		}

		res.writeHead(200, { "Content-Type": "text/plain" });
		res.end("kanbom running");
	});

	// Single terminal WebSocket per task: /api/terminal?workspaceId=...&taskId=...
	// On connect: immediately dump the full output buffer, then stream live output.
	// No restore handshake needed — Node.js is single-threaded so buffer dump and
	// listener registration happen in the same tick; live output can only arrive after.
	const stateWss = new WebSocketServer({ noServer: true });
	const terminalWss = new WebSocketServer({ noServer: true });

	httpServer.on("upgrade", (req, socket, head) => {
		try {
			const url = new URL(req.url ?? "/", `http://${host}`);
			if (url.pathname === "/ws") {
				stateWss.handleUpgrade(req, socket as import("node:net").Socket, head, (ws) => {
					stateWss.emit("connection", ws, req);
				});
			} else if (url.pathname === "/api/terminal") {
				terminalWss.handleUpgrade(req, socket as import("node:net").Socket, head, (ws) => {
					terminalWss.emit("connection", ws, req);
				});
			} else {
				(socket as import("node:net").Socket).end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
			}
		} catch {
			socket.destroy();
		}
	});

	terminalWss.on("connection", (ws, req) => {
		try {
			const url = new URL(req.url ?? "/", `http://${host}`);
			const workspaceId = url.searchParams.get("workspaceId") ?? "";
			const taskId = url.searchParams.get("taskId") ?? "";
			if (!workspaceId || !taskId) { ws.close(1008, "Missing params"); return; }

			// Register listener first (same sync tick) so no live output is missed.
			const unsubscribe = stateHub.addTerminalListener(workspaceId, (streamId, data) => {
				if (streamId !== taskId) return;
				if (ws.readyState === 1) {
					try { ws.send(data); } catch { /* */ }
				}
			});

			// Send snapshot: in-memory buffer first, then fall back to persisted disk file.
			const memSnapshot =
				schedulers.get(workspaceId)?.getOutputBuffer(taskId) ||
				stateHub.getTerminalBuffer(workspaceId, taskId);

			if (memSnapshot) {
				if (ws.readyState === 1) ws.send(memSnapshot);
			} else {
				loadTerminalBuffer(workspaceId, taskId)
					.then((diskSnapshot) => {
						if (diskSnapshot && ws.readyState === 1) ws.send(diskSnapshot);
					})
					.catch(() => {});
			}

			// Forward keyboard input and resize messages from client to PTY
			ws.on("message", (raw) => {
				const text = raw.toString();
				try {
					const msg = JSON.parse(text) as { type?: string; cols?: number; rows?: number };
					if (msg.type === "resize" && msg.cols && msg.rows) {
						schedulers.get(workspaceId)?.resizeTerminal(taskId, msg.cols, msg.rows);
						return;
					}
				} catch { /* not JSON — fall through to PTY write */ }
				schedulers.get(workspaceId)?.writeToTerminal(taskId, text);
			});

			ws.on("error", () => {});
			ws.on("close", () => { unsubscribe(); });
		} catch { ws.close(1011, "Internal error"); }
	});

	stateWss.on("connection", (ws) => {
		// New clients subscribe to all workspaces they request
		ws.on("message", (data) => {
			try {
				const msg = JSON.parse(data.toString()) as {
					type: string;
					workspaceId?: string;
					taskId?: string;
					cols?: number;
					rows?: number;
				};

				if (msg.type === "subscribe" && msg.workspaceId) {
					const clientId = stateHub.addClient(ws, msg.workspaceId);
					void stateHub.sendSnapshot(clientId, msg.workspaceId!, repoPath);
				}

				if (msg.type === "terminal_resize" && msg.workspaceId && msg.taskId && msg.cols && msg.rows) {
					schedulers.get(msg.workspaceId)?.resizeTerminal(msg.taskId, msg.cols, msg.rows);
				}
			} catch {
				// ignore
			}
		});

		ws.on("error", () => {});

		// Auto-subscribe to initial workspace
		const clientId = stateHub.addClient(ws, initialCtx.workspaceId);
		void stateHub.sendSnapshot(clientId, initialCtx.workspaceId, repoPath);
	});

	await new Promise<void>((resolve, reject) => {
		httpServer.listen(port, host, () => resolve());
		httpServer.on("error", reject);
	});

	// Write hook settings now that the port is bound.
	await writeClaudeTaskHookSettings(port).catch((err) => {
		console.warn("[server] Failed to write claude hook settings:", err);
	});

	return {
		url: `http://${host}:${port}`,
		close: async () => {
			for (const [, poller] of pollers) poller.stop();
			for (const [, scheduler] of schedulers) scheduler.stopAll();
			for (const ws of stateWss.clients) ws.terminate();
			for (const ws of terminalWss.clients) ws.terminate();
			await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		},
	};
}

async function readBody(req: import("node:http").IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

function getContentType(filePath: string): string {
	if (filePath.endsWith(".html")) return "text/html";
	if (filePath.endsWith(".js")) return "application/javascript";
	if (filePath.endsWith(".css")) return "text/css";
	if (filePath.endsWith(".svg")) return "image/svg+xml";
	if (filePath.endsWith(".png")) return "image/png";
	if (filePath.endsWith(".ico")) return "image/x-icon";
	return "application/octet-stream";
}
