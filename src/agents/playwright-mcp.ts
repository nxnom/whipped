import { join } from "node:path";
import { ATTACHMENTS_DIR } from "../config/runtime-config.js";

// Browser-control capability for QA agents, provided via Microsoft's Playwright
// MCP server. It drives the page through the accessibility tree (element refs),
// not screenshots — cheap, deterministic, no vision model needed — and exposes
// console/network inspection plus screenshots. The QA agent opts into it only
// when a change warrants exercising a running UI; registering the server is
// free (a browser launches only on the first navigate).
//
// Registered as a second MCP server (name "playwright") alongside "whipped" for
// QA slots. It needs no machine token — it talks to the local browser, not the
// daemon. Launched via npx; with @playwright/mcp in dependencies, npx resolves
// the pinned local copy instead of fetching. Browser binaries must be present
// (`npx playwright install chromium`); absence only surfaces if the agent calls
// a browser tool, as a reported error.
export const PLAYWRIGHT_MCP_SERVER_NAME = "playwright";

export interface BrowserMcpServer {
	command: string;
	args: string[];
	// Where Playwright MCP writes screenshots. Set to the card's attachment dir
	// so captured proof is already in the right place to attach to the QA comment.
	outputDir: string;
}

export function buildBrowserMcpServer(cardId: string): BrowserMcpServer {
	const outputDir = join(ATTACHMENTS_DIR, cardId);
	return {
		command: "npx",
		args: ["-y", "@playwright/mcp", "--headless", "--isolated", "--output-dir", outputDir],
		outputDir,
	};
}
