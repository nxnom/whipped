import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import * as nodePty from "node-pty";
import { WebSocketServer } from "ws";
import { writeClaudeTaskHookSettings } from "../agents/agent-hooks.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { tunnelManager } from "../slack/cloudflare-tunnel.js";
import { exchangeCodeForBotToken } from "../slack/slack-setup.js";
import { slackNotifier } from "../slack/slack-notifier.js";
import { ATTACHMENTS_DIR, DEFAULT_PORT, loadGlobalConfig } from "../config/runtime-config.js";
import type { RuntimeBoardCard } from "../core/api-contract.js";
import { logger } from "../core/logger.js";
import { BoardPoller } from "../daemon/poller.js";
import { runReviewPipeline } from "../daemon/review-pipeline.js";
import { getMcpServerPath, TaskScheduler } from "../daemon/scheduler.js";
import { createGithubClient } from "../github/github-client.js";
import {
	appendActivityLog,
	closeAllOpenTerminalSessions,
	listWorkspaces,
	loadBoard,
	loadProjectConfig,
	loadTerminalBuffer,
	loadWorkspaceContext,
	moveCard,
	saveAttachment,
	updateCard,
} from "../state/workspace-state.js";
import { type AppContext, appRouter, type RunSession } from "../trpc/app-router.js";
import { RuntimeStateHub } from "./runtime-state-hub.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

async function cleanupStaleTasks(workspaceId: string, hub: RuntimeStateHub): Promise<void> {
	const board = await loadBoard(workspaceId);
	const now = Date.now();

	// Close open terminal sessions on every card regardless of column (crashed cascade agents
	// can leave sessions open on rfr/done/todo cards).
	for (const card of Object.values(board.cards)) {
		if (card.terminalSessions?.some((s) => s.endedAt === undefined)) {
			await closeAllOpenTerminalSessions(workspaceId, card.id, now);
		}
	}

	const inProgressCol = board.columns.find((c) => c.id === "in_progress");
	if (!inProgressCol || inProgressCol.taskIds.length === 0) return;

	const taskIds = [...inProgressCol.taskIds];
	for (const taskId of taskIds) {
		const card = board.cards[taskId];
		if (!card) continue;
		logger.info(`[server] Cleanup stale in-progress task "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}" → todo`);
		await moveCard(workspaceId, taskId, "todo");
		await appendActivityLog(workspaceId, taskId, "Server stopped — task interrupted, moved back to Todo");
	}

	if (taskIds.length > 0) hub.broadcastWorkspaceUpdate(workspaceId);
}

interface ServerOptions {
	port?: number;
	host?: string;
	repoPath: string;
}

export async function createRuntimeServer(options: ServerOptions) {
	const { port = DEFAULT_PORT, host = "127.0.0.1", repoPath } = options;

	const _globalConfig = await loadGlobalConfig();
	const initialCtx = await loadWorkspaceContext(repoPath);

	const stateHub = new RuntimeStateHub();
	const schedulers = new Map<string, TaskScheduler>();
	const pollers = new Map<string, BoardPoller>();
	const runSessions = new Map<string, RunSession>();
	type RunTerminalListener = (data: string) => void;
	const runTerminalListeners = new Map<string, Set<RunTerminalListener>>();

	function startRun(workspaceId: string, cardId: string | null, command: string, cwd: string): void {
		stopRun(workspaceId);
		const shell = process.env.SHELL ?? "/bin/bash";
		const pty = nodePty.spawn(shell, ["-c", command], {
			name: "xterm-256color",
			cols: 120,
			rows: 40,
			cwd,
			env: { ...process.env, TERM: "xterm-color" },
		});
		const session: RunSession = {
			cardId,
			status: "running",
			outputBuffer: "",
			kill: () => {
				try {
					pty.kill();
				} catch {
					/* already dead */
				}
			},
			writeInput: (data: string) => {
				try {
					pty.write(data);
				} catch {
					/* pty may have exited */
				}
			},
		};
		runSessions.set(workspaceId, session);
		stateHub.broadcastRunSessionChange(workspaceId, cardId, "running");

		pty.onData((data) => {
			session.outputBuffer = (session.outputBuffer + data).slice(-131072); // keep last 128KB
			runTerminalListeners.get(workspaceId)?.forEach((cb) => {
				cb(data);
			});
		});

		pty.onExit(({ exitCode }) => {
			const current = runSessions.get(workspaceId);
			if (current !== session) return; // superseded by a newer run
			if (exitCode === 0 || exitCode == null) {
				session.status = "stopped";
				stateHub.broadcastRunSessionChange(workspaceId, cardId, "stopped");
			} else {
				session.status = "error";
				session.errorMessage = `Process exited with code ${exitCode}`;
				stateHub.broadcastRunSessionChange(workspaceId, cardId, "error", session.errorMessage);
			}
		});
	}

	function stopRun(workspaceId: string): void {
		const session = runSessions.get(workspaceId);
		if (!session) return;
		session.kill();
		session.status = "stopped";
		runSessions.delete(workspaceId);
		stateHub.broadcastRunSessionChange(workspaceId, null, "stopped");
	}

	function getRunSession(workspaceId: string): RunSession | null {
		return runSessions.get(workspaceId) ?? null;
	}

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

		const resolveGithubToken = (cfg: typeof projectConfig): string | undefined =>
			cfg.secrets?.find((s) => s.key === "GITHUB_TOKEN")?.value ?? cfg.github?.token;

		const _githubClient = resolveGithubToken(projectConfig)
			? createGithubClient(resolveGithubToken(projectConfig)!)
			: undefined;

		stateHub.registerWorkspace(workspaceId, wsRepoPath);

		// On startup, move any in-progress tasks left over from a previous run back to todo.
		await cleanupStaleTasks(workspaceId, stateHub);

		// Guard against duplicate review pipelines — both onTaskCompleted and the
		// poller can observe the same ready_for_review card. The Set is the single source
		// of truth for which tasks currently have a running pipeline.
		const activeReviews = new Set<string>();

		function startReview(card: RuntimeBoardCard): void {
			if (activeReviews.has(card.id)) return;
			activeReviews.add(card.id);
			logger.info(`[server] Starting review pipeline for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}"`);

			(async () => {
				const latestConfig = await loadGlobalConfig(); // reload fresh each review
				const latestProjectConfig = await loadProjectConfig(workspaceId);
				const latestGithubToken = resolveGithubToken(latestProjectConfig);
				const latestGithubClient = latestGithubToken ? createGithubClient(latestGithubToken) : undefined;
				const isStoryCard = card.type === "story";
				const cardWorkflow =
					latestProjectConfig.workflows.find((w) => w.id === card.workflowId) ??
					latestProjectConfig.workflows.find((w) => w.isDefault && w.forStory === isStoryCard) ??
					latestProjectConfig.workflows.find((w) => w.forStory === isStoryCard) ??
					latestProjectConfig.workflows[0];
				const reviewSlots = (cardWorkflow?.slots ?? [])
					.filter((s) => s.type !== "dev" && s.enabled)
					.sort((a, b) => a.order - b.order);
				if (reviewSlots.length === 0 && !(latestProjectConfig.autoPR ?? false)) return;
				await runReviewPipeline(card, {
					workspaceId,
					repoPath: wsRepoPath,
					serverUrl: `http://${host}:${port}`,
					mcpBinary: getMcpServerPath(),
					reviewSlots,
					maxAutoFixAttempts: latestProjectConfig.maxAutoFixAttempts ?? latestConfig.maxAutoFixAttempts,
					stateHub,
					githubClient: latestGithubClient,
					autoPR: latestProjectConfig.autoPR ?? false,
					autoCommit: latestProjectConfig.autoCommit ?? true,
					secrets: latestProjectConfig.secrets ?? [],
					systemPrompt: latestProjectConfig.systemPrompt,
					registerStopCallback: scheduler.registerStopCallback.bind(scheduler),
					registerLiveProcess: scheduler.registerLiveProcess.bind(scheduler),
				});
			})()
				.catch((err) => logger.error({ err }, `[server] Review pipeline error for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}":`))
				.finally(() => activeReviews.delete(card.id));
		}

		const scheduler = new TaskScheduler({
			workspaceId,
			repoPath: wsRepoPath,
			serverUrl: `http://${host}:${port}`,
			maxParallelTasks: projectConfig.maxParallelTasks ?? config.maxParallelTasks,
			maxAutoFixAttempts: projectConfig.maxAutoFixAttempts ?? config.maxAutoFixAttempts,
			defaultAgent: projectConfig.defaultAgent ?? config.defaultAgent,
			stateHub,
			onTaskCompleted: (taskId) => {
				loadBoard(workspaceId)
					.then((board) => {
						const card = board.cards[taskId];
						if (card?.columnId === "in_progress" || card?.columnId === "ready_for_review") {
							startReview(card);
						}
					})
					.catch((err) => logger.error({ err }, `[server] onTaskCompleted board load failed for ${taskId}:`));
			},
		});

		const poller = new BoardPoller({
			workspaceId,
			repoPath: wsRepoPath,
			pollingIntervalSeconds: projectConfig.pollingIntervalSeconds ?? config.pollingIntervalSeconds,
			prPollingIntervalSeconds: config.prPollingIntervalSeconds,
			scheduler,
			stateHub,
			onCardReadyForReview: (card: RuntimeBoardCard) => {
				startReview(card);
			},
		});

		schedulers.set(workspaceId, scheduler);
		pollers.set(workspaceId, poller);

		if (projectConfig.autonomousModeEnabled) {
			poller.start();
		}
		poller.startPRPolling();

		void slackNotifier.joinExistingChannels(workspaceId);
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
			startRun,
			stopRun,
			getRunSession,
		};
	}

	const webUiDistPath = join(__dirname, "..", "web-ui");
	const webUiIndexPath = join(webUiDistPath, "index.html");
	const hasWebUi = existsSync(webUiIndexPath);

	const httpServer = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://${host}`);

		if (url.pathname === "/api/slack/oauth-callback") {
			const code = url.searchParams.get("code");
			if (!code) {
				res.writeHead(400, { "Content-Type": "text/plain" });
				res.end("Missing code");
				return;
			}
			try {
				const config = await loadGlobalConfig();
				if (!config.slackClientId || !config.slackClientSecret || !config.slackPublicUrl) {
					res.writeHead(400, { "Content-Type": "text/plain" });
					res.end("Slack app not configured");
					return;
				}
				const { botToken, installerUserId } = await exchangeCodeForBotToken(
					code,
					config.slackClientId,
					config.slackClientSecret,
					config.slackPublicUrl,
				);
				const update: Record<string, unknown> = { slackBotToken: botToken };
				if (installerUserId) update.slackInstallerUserId = installerUserId;
				await import("../config/runtime-config.js").then((m) =>
					m.updateGlobalConfig(update),
				);
				logger.info("[slack] Bot token saved via OAuth callback");
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(`<!DOCTYPE html><html><head><title>Slack Connected</title></head><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f0f10;color:#f0f0f5"><div style="text-align:center"><div style="font-size:48px;margin-bottom:16px">✓</div><h2 style="margin:0 0 8px">Slack connected!</h2><p style="color:#60607a;margin:0">You can close this tab and return to the app.</p></div></body></html>`);
			} catch (err) {
				logger.error({ err }, "[slack] OAuth callback failed");
				res.writeHead(500, { "Content-Type": "text/plain" });
				res.end("OAuth failed");
			}
			return;
		}

		if (url.pathname === "/api/slack/events" || url.pathname === "/api/slack/commands") {
			const body = await readBody(req);
			const config = await loadGlobalConfig();
			const signingSecret = config.slackSigningSecret;

			if (signingSecret) {
				const timestamp = String(req.headers["x-slack-request-timestamp"] ?? "");
				const signature = String(req.headers["x-slack-signature"] ?? "");
				if (!timestamp || !signature) {
					logger.warn("[slack] Missing timestamp or signature headers");
					res.writeHead(403, { "Content-Type": "text/plain" });
					res.end("Forbidden");
					return;
				}
				if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
					logger.warn({ timestamp }, "[slack] Request timestamp too old");
					res.writeHead(403, { "Content-Type": "text/plain" });
					res.end("Forbidden");
					return;
				}
				const sigBase = `v0:${timestamp}:${body.toString()}`;
				const hmac = createHmac("sha256", signingSecret).update(sigBase).digest("hex");
				const expected = Buffer.from(`v0=${hmac}`);
				const actual = Buffer.from(signature);
				const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
				if (!valid) {
					logger.warn({ path: url.pathname, sigExpected: `v0=${hmac}`.slice(0, 16), sigActual: signature.slice(0, 16) }, "[slack] Signature mismatch");
					res.writeHead(403, { "Content-Type": "text/plain" });
					res.end("Forbidden");
					return;
				}
			}

			if (url.pathname === "/api/slack/events") {
				const payload = JSON.parse(body.toString()) as {
					type: string;
					challenge?: string;
					event?: { type: string; subtype?: string; text?: string; thread_ts?: string; ts?: string; bot_id?: string };
				};

				// URL verification must respond with the challenge synchronously
				if (payload.type === "url_verification") {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ challenge: payload.challenge }));
					return;
				}

				// Ack immediately; process async so we never hit Slack's 3s timeout
				res.writeHead(200, { "Content-Type": "text/plain" });
				res.end("ok");

				void (async () => {
					try {
						const event = payload.event;

						// Only handle real human messages in threads; skip bot messages, edits, and thread-root notifications
						if (
							event?.type === "message" &&
							!event.bot_id &&
							!event.subtype &&
							event.thread_ts &&
							event.ts !== event.thread_ts &&
							event.text?.trim()
						) {
							const text = event.text.trim();
							const found = await slackNotifier.findCardByThreadTs(event.thread_ts);
							if (found) logger.info(`[slack] Thread reply → "${found.card.description?.split("\n")[0]?.slice(0, 60) ?? found.card.id}"`);
							if (found) {
								const { workspaceId, card } = found;
								if (card.columnId === "done") {
									await slackNotifier.replyToCard(card, "This ticket is completed and no longer accepts feedback.");
								} else {
									const updatedComments = [
										...(card.reviewComments ?? []),
										{
											type: "human" as const,
											actor: { type: "human" as const, id: "human" },
											createdAt: Date.now(),
											summary: text,
											metadata: { fromSlack: true },
										},
									];
									await updateCard(workspaceId, card.id, { reviewComments: updatedComments });
									if (/\breopen\b/i.test(text)) {
										await moveCard(workspaceId, card.id, "reopened");
									}
									stateHub.broadcastWorkspaceUpdate(workspaceId);
								}
							}
						}
					} catch (err) {
						logger.error({ err }, "[slack] Event processing error");
					}
				})();
				return;
			}

			if (url.pathname === "/api/slack/commands") {
				const params = new URLSearchParams(body.toString());
				const command = params.get("command");
				const threadTs = params.get("thread_ts");

				if (command === "/reopen" && threadTs) {
					const found = await slackNotifier.findCardByThreadTs(threadTs);
					if (!found) {
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ response_type: "ephemeral", text: "No ticket found for this thread." }));
						return;
					}
					const { workspaceId, card } = found;
					if (card.columnId === "done") {
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ response_type: "ephemeral", text: ":x: Cannot reopen — this ticket is already completed." }));
						return;
					}
					await moveCard(workspaceId, card.id, "reopened");
					stateHub.broadcastWorkspaceUpdate(workspaceId);
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ response_type: "in_channel", text: `:arrows_counterclockwise: Ticket reopened: *${card.description?.split("\n")[0]?.slice(0, 80) ?? card.id}*` }));
					return;
				}

				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ response_type: "ephemeral", text: "Unknown command." }));
				return;
			}
		}

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

		// ── Attachment file server ──────────────────────────────────────────────
		// GET  /api/attachments/{cardId}/{filename}  — serve with caching
		// POST /api/attachments/{cardId}?workspaceId=…&filename=…  — raw binary upload
		const attachMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)\/([^/]+)$/);
		const attachUploadMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)$/);

		if (attachMatch && req.method === "GET") {
			const [, cardId, filename] = attachMatch;
			// Sanitise: no dots-dot, no slashes inside segments
			if (!cardId || !filename || cardId.includes("..") || filename.includes("..") || filename.includes("/")) {
				res.writeHead(400);
				res.end("Bad request");
				return;
			}
			const filePath = join(ATTACHMENTS_DIR, cardId, filename);
			const { readFile } = await import("node:fs/promises");
			try {
				const data = await readFile(filePath);
				const ext = filename.split(".").pop()?.toLowerCase() ?? "";
				const MIME: Record<string, string> = {
					png: "image/png",
					jpg: "image/jpeg",
					jpeg: "image/jpeg",
					gif: "image/gif",
					webp: "image/webp",
					svg: "image/svg+xml",
					pdf: "application/pdf",
					txt: "text/plain",
					json: "application/json",
					zip: "application/zip",
					mp4: "video/mp4",
					mp3: "audio/mpeg",
				};
				res.writeHead(200, {
					"Content-Type": MIME[ext] ?? "application/octet-stream",
					"Cache-Control": "public, max-age=31536000, immutable",
					"Content-Length": String(data.length),
				});
				res.end(data);
			} catch {
				res.writeHead(404);
				res.end("Not found");
			}
			return;
		}

		if (attachUploadMatch && req.method === "POST") {
			const [, cardId] = attachUploadMatch;
			const workspaceId = url.searchParams.get("workspaceId");
			const filename = url.searchParams.get("filename") ?? "file";
			const mimeType = url.searchParams.get("mimeType") ?? req.headers["content-type"] ?? "application/octet-stream";
			if (!cardId || !workspaceId || cardId.includes("..")) {
				res.writeHead(400);
				res.end("Bad request");
				return;
			}
			const ext = (filename.split(".").pop()?.toLowerCase() ?? "bin").replace(/[^a-z0-9]/g, "");
			if (!ext) {
				res.writeHead(400);
				res.end("Bad filename");
				return;
			}
			const board = await loadBoard(workspaceId);
			if (!board.cards[cardId]) {
				res.writeHead(404);
				res.end("Card not found");
				return;
			}
			const body = await readBody(req);
			const filePath = await saveAttachment(body, ext, cardId);
			const attachType = mimeType.startsWith("image/") ? "image" : "file";
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ path: filePath, name: filename, mimeType, type: attachType }));
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
		res.end("overemployed running");
	});

	// Single terminal WebSocket per task: /api/terminal?workspaceId=...&taskId=...
	// On connect: immediately dump the full output buffer, then stream live output.
	// No restore handshake needed — Node.js is single-threaded so buffer dump and
	// listener registration happen in the same tick; live output can only arrive after.
	const stateWss = new WebSocketServer({ noServer: true });
	const terminalWss = new WebSocketServer({ noServer: true });
	const runTerminalWss = new WebSocketServer({ noServer: true });

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
			} else if (url.pathname === "/api/run-terminal") {
				runTerminalWss.handleUpgrade(req, socket as import("node:net").Socket, head, (ws) => {
					runTerminalWss.emit("connection", ws, req);
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
			if (!workspaceId || !taskId) {
				ws.close(1008, "Missing params");
				return;
			}

			// Register listener first (same sync tick) so no live output is missed.
			const unsubscribe = stateHub.addTerminalListener(workspaceId, (streamId, data) => {
				if (streamId !== taskId) return;
				if (ws.readyState === 1) {
					try {
						ws.send(data);
					} catch {
						/* */
					}
				}
			});

			// Send snapshot: prefer active session buffer; fall back to hub/disk for completed tasks.
			// null means no active session — safe to use stale fallback.
			// "" means active session with no output yet — send nothing (blank terminal).
			const activeBuffer = schedulers.get(workspaceId)?.getOutputBuffer(taskId) ?? null;
			if (activeBuffer !== null) {
				if (activeBuffer && ws.readyState === 1) ws.send(activeBuffer);
			} else {
				const hubSnapshot = stateHub.getTerminalBuffer(workspaceId, taskId);
				if (hubSnapshot) {
					if (ws.readyState === 1) ws.send(hubSnapshot);
				} else {
					loadTerminalBuffer(workspaceId, taskId)
						.then((diskSnapshot) => {
							if (diskSnapshot && ws.readyState === 1) ws.send(diskSnapshot);
						})
						.catch(() => {});
				}
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
				} catch {
					/* not JSON — fall through to PTY write */
				}
				schedulers.get(workspaceId)?.writeToTerminal(taskId, text);
			});

			ws.on("error", () => {});
			ws.on("close", () => {
				unsubscribe();
			});
		} catch {
			ws.close(1011, "Internal error");
		}
	});

	runTerminalWss.on("connection", (ws, req) => {
		try {
			const url = new URL(req.url ?? "/", `http://${host}`);
			const workspaceId = url.searchParams.get("workspaceId") ?? "";
			if (!workspaceId) {
				ws.close(1008, "Missing params");
				return;
			}

			// Register live output listener
			if (!runTerminalListeners.has(workspaceId)) runTerminalListeners.set(workspaceId, new Set());
			const listener: RunTerminalListener = (data) => {
				if (ws.readyState === 1) {
					try {
						ws.send(data);
					} catch {
						/* */
					}
				}
			};
			runTerminalListeners.get(workspaceId)?.add(listener);

			// Send buffered output so far
			const session = runSessions.get(workspaceId);
			if (session?.outputBuffer && ws.readyState === 1) ws.send(session.outputBuffer);

			// Forward keyboard input from client to PTY
			ws.on("message", (raw) => {
				runSessions.get(workspaceId)?.writeInput(raw.toString());
			});

			ws.on("error", () => {});
			ws.on("close", () => {
				runTerminalListeners.get(workspaceId)?.delete(listener);
			});
		} catch {
			ws.close(1011, "Internal error");
		}
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
	});

	await new Promise<void>((resolve, reject) => {
		httpServer.listen(port, host, () => resolve());
		httpServer.on("error", reject);
	});

	// Write hook settings now that the port is bound.
	await writeClaudeTaskHookSettings(port).catch((err) => {
		logger.warn("[server] Failed to write claude hook settings:", err);
	});

	if (_globalConfig.autoStartTunnel) tunnelManager.start();

	return {
		url: `http://${host}:${port}`,
		close: async () => {
			tunnelManager.stop();
			for (const [, poller] of pollers) poller.stop();
			// Persist failed/todo state for in-progress tasks before killing processes.
			for (const [wsId, scheduler] of schedulers) {
				await cleanupStaleTasks(wsId, stateHub);
				scheduler.prepareShutdown();
				scheduler.stopAll();
			}
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
