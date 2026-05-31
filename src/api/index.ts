import { Hono } from "hono";
import { errorHandler } from "./errors/error-handler.js";
import { agentController } from "./routes/agent.js";
import { agentsController } from "./routes/agents.js";
import { authController } from "./routes/auth.js";
import { cardsController } from "./routes/cards.js";
import { configController } from "./routes/config.js";
import { fsController } from "./routes/fs.js";
import { jiraController } from "./routes/jira.js";
import { memoryController } from "./routes/memory.js";
import { projectConfigController } from "./routes/project-config.js";
import { projectsController } from "./routes/projects.js";
import { runController } from "./routes/run.js";
import { slackController } from "./routes/slack.js";
import { terminalController } from "./routes/terminal.js";
import { workflowsController } from "./routes/workflows.js";
import { workspaceController } from "./routes/workspace.js";
import type { AppContext, AppEnv } from "./types/context.js";

// Root Hono app, mounted on the existing node:http server. Domain controllers
// are chained via .route() so the full route map is captured in the return
// type for @spoosh/hono inference.
export function createApiApp(ctx: AppContext) {
	const app = new Hono<AppEnv>()
		.basePath("/api")
		.use("*", async (c, next) => {
			c.set("ctx", ctx);
			await next();
		})
		.get("/health", (c) => c.json({ ok: true }))
		.route("/auth", authController)
		.route("/agent", agentController)
		.route("/agents", agentsController)
		.route("/cards", cardsController)
		.route("/config", configController)
		.route("/fs", fsController)
		.route("/jira", jiraController)
		.route("/memory", memoryController)
		.route("/project-config", projectConfigController)
		.route("/projects", projectsController)
		.route("/run", runController)
		.route("/slack", slackController)
		.route("/terminal", terminalController)
		.route("/workflows", workflowsController)
		.route("/workspace", workspaceController);

	app.onError(errorHandler);

	return app;
}

export type ApiApp = ReturnType<typeof createApiApp>;
