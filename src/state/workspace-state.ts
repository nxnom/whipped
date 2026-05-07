import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ATTACHMENTS_DIR, WORKSPACES_DIR } from "../config/runtime-config.js";
import {
	BOARD_COLUMNS,
	SCHEMA_VERSION,
	type RuntimeBoardCard,
	type RuntimeBoardColumnId,
	type RuntimeBoardData,
	type RuntimeProjectConfig,
	type RuntimeTaskSessionState,
	type RuntimeTerminalSessionEntry,
	type RuntimeWorkspaceStateResponse,
	type RuntimeWorkspaceStateSaveRequest,
	runtimeBoardDataSchema,
	runtimeProjectConfigSchema,
} from "../core/api-contract.js";
import { generateTaskId } from "../core/task-id.js";

// ─── Per-workspace write mutex ────────────────────────────────────────────────
//
// All read-modify-write operations on a workspace's JSON files must run inside
// withLock(workspaceId, fn).  Node.js is single-threaded but every `await`
// point is an interleaving opportunity — without the lock, two concurrent ops
// (e.g. moveCard + appendActivityLog) both read the same stale board, both
// mutate independently, then one overwrites the other's changes.
//
// Implementation: per-workspace promise chain (tail-append queue).  Acquiring
// the lock appends a new promise to the chain; releasing it resolves that
// promise so the next waiter can proceed.

const writeLocks = new Map<string, Promise<void>>();

async function withLock<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
	const prev = writeLocks.get(workspaceId) ?? Promise.resolve();
	let release!: () => void;
	const next = new Promise<void>((resolve) => { release = resolve; });
	writeLocks.set(workspaceId, next);
	await prev;
	try {
		return await fn();
	} finally {
		release();
	}
}

// ─── Index ────────────────────────────────────────────────────────────────────

const INDEX_FILE = join(WORKSPACES_DIR, "index.json");

interface WorkspaceIndex {
	entries: Record<string, { workspaceId: string; repoPath: string; name: string }>;
	repoPathToId: Record<string, string>;
}

async function loadIndex(): Promise<WorkspaceIndex> {
	try {
		const raw = await readFile(INDEX_FILE, "utf-8");
		return JSON.parse(raw) as WorkspaceIndex;
	} catch {
		return { entries: {}, repoPathToId: {} };
	}
}

async function saveIndex(index: WorkspaceIndex): Promise<void> {
	await mkdir(WORKSPACES_DIR, { recursive: true });
	await writeFile(INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
}

// ─── Workspace paths ──────────────────────────────────────────────────────────

function workspaceDirPath(workspaceId: string): string {
	return join(WORKSPACES_DIR, workspaceId);
}

function boardFilePath(workspaceId: string): string {
	return join(workspaceDirPath(workspaceId), "board.json");
}

function metaFilePath(workspaceId: string): string {
	return join(workspaceDirPath(workspaceId), "meta.json");
}

function projectConfigFilePath(workspaceId: string): string {
	return join(workspaceDirPath(workspaceId), "project-config.json");
}

function bufferFilePath(workspaceId: string, streamId: string): string {
	// Sanitise streamId for use as a filename
	const safe = streamId.replace(/[^a-zA-Z0-9_-]/g, "_");
	return join(workspaceDirPath(workspaceId), "buffers", `${safe}.ansi`);
}

// ─── Board helpers ────────────────────────────────────────────────────────────

function createEmptyBoard(): RuntimeBoardData {
	return {
		columns: BOARD_COLUMNS.map((col) => ({ id: col.id, title: col.title, taskIds: [] })),
		cards: {},
	};
}

// ─── Load / save ──────────────────────────────────────────────────────────────

export async function loadBoard(workspaceId: string): Promise<RuntimeBoardData> {
	try {
		const raw = await readFile(boardFilePath(workspaceId), "utf-8");
		const parsed = runtimeBoardDataSchema.safeParse(JSON.parse(raw));
		if (!parsed.success) return createEmptyBoard();
		const board = parsed.data;
		// Schema migration: wipe all reviewComments if schemaVersion < 2
		if ((board.schemaVersion ?? 0) < SCHEMA_VERSION) {
			for (const card of Object.values(board.cards)) {
				card.reviewComments = [];
			}
			board.schemaVersion = SCHEMA_VERSION;
			await saveBoard(workspaceId, board);
		}
		return board;
	} catch {
		return createEmptyBoard();
	}
}

async function saveBoard(workspaceId: string, board: RuntimeBoardData): Promise<void> {
	await mkdir(workspaceDirPath(workspaceId), { recursive: true });
	await writeFile(boardFilePath(workspaceId), JSON.stringify(board, null, 2), "utf-8");
}

async function loadMeta(workspaceId: string): Promise<{ revision: number; autonomousModeEnabled: boolean }> {
	try {
		const raw = await readFile(metaFilePath(workspaceId), "utf-8");
		return JSON.parse(raw) as { revision: number; autonomousModeEnabled: boolean };
	} catch {
		return { revision: 0, autonomousModeEnabled: false };
	}
}

async function saveMeta(
	workspaceId: string,
	meta: { revision: number; autonomousModeEnabled: boolean },
): Promise<void> {
	await mkdir(workspaceDirPath(workspaceId), { recursive: true });
	await writeFile(metaFilePath(workspaceId), JSON.stringify(meta, null, 2), "utf-8");
}

export async function loadProjectConfig(workspaceId: string): Promise<RuntimeProjectConfig> {
	try {
		const raw = await readFile(projectConfigFilePath(workspaceId), "utf-8");
		const parsed = runtimeProjectConfigSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : runtimeProjectConfigSchema.parse({});
	} catch {
		return runtimeProjectConfigSchema.parse({});
	}
}

export async function saveProjectConfig(workspaceId: string, config: RuntimeProjectConfig): Promise<void> {
	await mkdir(workspaceDirPath(workspaceId), { recursive: true });
	await writeFile(projectConfigFilePath(workspaceId), JSON.stringify(config, null, 2), "utf-8");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface WorkspaceContext {
	workspaceId: string;
	repoPath: string;
	name: string;
	lastUpdated: number;
}

export async function loadWorkspaceContext(repoPath: string): Promise<WorkspaceContext> {
	const index = await loadIndex();
	const existingId = index.repoPathToId[repoPath];
	if (existingId) {
		const entry = index.entries[existingId];
		if (entry) {
			return { workspaceId: existingId, repoPath, name: entry.name, lastUpdated: 0 };
		}
	}

	const workspaceId = randomBytes(4).toString("hex");
	const name = repoPath.split("/").pop() ?? repoPath;
	index.entries[workspaceId] = { workspaceId, repoPath, name };
	index.repoPathToId[repoPath] = workspaceId;
	await saveIndex(index);

	return { workspaceId, repoPath, name, lastUpdated: 0 };
}

export async function listWorkspaces(): Promise<WorkspaceContext[]> {
	const index = await loadIndex();
	return Object.values(index.entries).map((e) => ({
		workspaceId: e.workspaceId,
		repoPath: e.repoPath,
		name: e.name,
		lastUpdated: 0,
	}));
}

export async function loadWorkspaceState(
	workspaceId: string,
	repoPath: string,
): Promise<RuntimeWorkspaceStateResponse> {
	const [board, meta, projectConfig] = await Promise.all([
		loadBoard(workspaceId),
		loadMeta(workspaceId),
		loadProjectConfig(workspaceId),
	]);

	return {
		workspaceId,
		repoPath,
		board,
		revision: meta.revision,
		autonomousModeEnabled: meta.autonomousModeEnabled,
		projectConfig,
	};
}

export async function saveWorkspaceState(
	workspaceId: string,
	request: RuntimeWorkspaceStateSaveRequest,
): Promise<{ revision: number }> {
	return withLock(workspaceId, async () => {
		const meta = await loadMeta(workspaceId);
		if (request.revision !== meta.revision) {
			throw new Error(`Revision conflict: expected ${meta.revision}, got ${request.revision}`);
		}
		const newRevision = meta.revision + 1;
		await Promise.all([saveBoard(workspaceId, request.board), saveMeta(workspaceId, { ...meta, revision: newRevision })]);
		return { revision: newRevision };
	});
}

export async function clearCardSession(workspaceId: string, cardId: string): Promise<void> {
	return withLock(workspaceId, async () => {
		const board = await loadBoard(workspaceId);
		const card = board.cards[cardId];
		if (!card) return;
		board.cards[cardId] = { ...card, worktreePath: undefined, updatedAt: Date.now() };
		const meta = await loadMeta(workspaceId);
		await Promise.all([saveBoard(workspaceId, board), saveMeta(workspaceId, { ...meta, revision: meta.revision + 1 })]);
	});
}

export async function setAutonomousMode(workspaceId: string, enabled: boolean): Promise<void> {
	return withLock(workspaceId, async () => {
		const [meta, projectConfig] = await Promise.all([loadMeta(workspaceId), loadProjectConfig(workspaceId)]);
		await Promise.all([
			saveMeta(workspaceId, { ...meta, autonomousModeEnabled: enabled }),
			saveProjectConfig(workspaceId, { ...projectConfig, autonomousModeEnabled: enabled }),
		]);
	});
}

export async function moveCard(
	workspaceId: string,
	cardId: string,
	targetColumnId: RuntimeBoardColumnId,
	targetIndex?: number,
): Promise<RuntimeBoardData> {
	return withLock(workspaceId, async () => {
		const board = await loadBoard(workspaceId);
		const card = board.cards[cardId];
		if (!card) {
			// Card was deleted before the move arrived — silently ignore
			return board;
		}

		// Remove from current column
		for (const col of board.columns) {
			col.taskIds = col.taskIds.filter((id) => id !== cardId);
		}

		// Add to target column
		const targetCol = board.columns.find((c) => c.id === targetColumnId);
		if (!targetCol) {
			throw new Error(`Column not found: ${targetColumnId}`);
		}

		if (typeof targetIndex === "number") {
			targetCol.taskIds.splice(targetIndex, 0, cardId);
		} else {
			targetCol.taskIds.push(cardId);
		}

		board.cards[cardId] = { ...card, columnId: targetColumnId, updatedAt: Date.now() };

		const meta = await loadMeta(workspaceId);
		await Promise.all([saveBoard(workspaceId, board), saveMeta(workspaceId, { ...meta, revision: meta.revision + 1 })]);

		return board;
	});
}

export async function createCard(
	workspaceId: string,
	data: Pick<RuntimeBoardCard, "title" | "description"> &
		Partial<Pick<RuntimeBoardCard, "type" | "agentId" | "priority" | "readyForDev" | "dependsOn" | "columnId" | "githubIssueUrl" | "jiraKey" | "jiraUrl" | "workflowId">>,
	baseRef: string,
): Promise<RuntimeBoardCard> {
	return withLock(workspaceId, async () => {
		const board = await loadBoard(workspaceId);
		const id = generateTaskId();
		const now = Date.now();
		const type = data.type ?? "task";

		const card: RuntimeBoardCard = {
			id,
			title: data.title,
			description: data.description,
			columnId: data.columnId ?? "todo",
			type,
			readyForDev: data.readyForDev ?? type === "story",
			agentId: data.agentId,
			priority: data.priority,
			dependsOn: data.dependsOn ?? [],
			autoFixAttempts: 0,
			baseRef,
			createdAt: now,
			updatedAt: now,
			githubIssueUrl: data.githubIssueUrl,
			jiraKey: data.jiraKey,
			jiraUrl: data.jiraUrl,
			workflowId: data.workflowId,
			reviewComments: [],
			activityLog: [],
			terminalSessions: [],
			githubCommentIds: [],
		};

		board.cards[id] = card;
		const col = board.columns.find((c) => c.id === card.columnId);
		if (col) {
			col.taskIds.push(id);
		}

		const meta = await loadMeta(workspaceId);
		await Promise.all([saveBoard(workspaceId, board), saveMeta(workspaceId, { ...meta, revision: meta.revision + 1 })]);

		return card;
	});
}

export async function appendActivityLog(workspaceId: string, cardId: string, message: string): Promise<void> {
	return withLock(workspaceId, async () => {
		const board = await loadBoard(workspaceId);
		const card = board.cards[cardId];
		if (!card) return;
		card.activityLog = [...(card.activityLog ?? []), { timestamp: Date.now(), message }];
		card.updatedAt = Date.now();
		board.cards[cardId] = card;
		await saveBoard(workspaceId, board);
	});
}

export async function saveTerminalBuffer(workspaceId: string, streamId: string, data: string): Promise<void> {
	const filePath = bufferFilePath(workspaceId, streamId);
	await mkdir(join(workspaceDirPath(workspaceId), "buffers"), { recursive: true });
	await writeFile(filePath, data, "utf-8");
}

export async function loadTerminalBuffer(workspaceId: string, streamId: string): Promise<string> {
	try {
		return await readFile(bufferFilePath(workspaceId, streamId), "utf-8");
	} catch {
		return "";
	}
}

export async function appendTerminalSession(
	workspaceId: string,
	cardId: string,
	entry: RuntimeTerminalSessionEntry,
): Promise<void> {
	return withLock(workspaceId, async () => {
		const board = await loadBoard(workspaceId);
		const card = board.cards[cardId];
		if (!card) return;
		card.terminalSessions = [...(card.terminalSessions ?? []), entry];
		card.updatedAt = Date.now();
		board.cards[cardId] = card;
		await saveBoard(workspaceId, board);
	});
}

export async function closeAllOpenTerminalSessions(workspaceId: string, cardId: string, endedAt: number): Promise<void> {
	return withLock(workspaceId, async () => {
		const board = await loadBoard(workspaceId);
		const card = board.cards[cardId];
		if (!card) return;
		const updated = card.terminalSessions?.map((s) =>
			s.endedAt === undefined ? { ...s, endedAt, state: "killed" as const } : s,
		);
		if (!updated) return;
		board.cards[cardId] = { ...card, terminalSessions: updated };
		const meta = await loadMeta(workspaceId);
		await Promise.all([saveBoard(workspaceId, board), saveMeta(workspaceId, { ...meta, revision: meta.revision + 1 })]);
	});
}

export async function endTerminalSession(workspaceId: string, cardId: string, streamId: string, endedAt: number, state?: RuntimeTaskSessionState): Promise<void> {
	return withLock(workspaceId, async () => {
		const board = await loadBoard(workspaceId);
		const card = board.cards[cardId];
		if (!card) return;
		const updated = card.terminalSessions?.map((s) =>
			s.streamId === streamId ? { ...s, endedAt, ...(state ? { state } : {}) } : s,
		);
		if (!updated) return;
		board.cards[cardId] = { ...card, terminalSessions: updated };
		const meta = await loadMeta(workspaceId);
		await Promise.all([saveBoard(workspaceId, board), saveMeta(workspaceId, { ...meta, revision: meta.revision + 1 })]);
	});
}

export async function linkCommentToSession(workspaceId: string, cardId: string, commentCreatedAt: number, streamId: string): Promise<void> {
	return withLock(workspaceId, async () => {
		const board = await loadBoard(workspaceId);
		const card = board.cards[cardId];
		if (!card) return;
		const updated = (card.reviewComments ?? []).map((c) =>
			c.createdAt === commentCreatedAt ? { ...c, streamId } : c,
		);
		board.cards[cardId] = { ...card, reviewComments: updated };
		const meta = await loadMeta(workspaceId);
		await Promise.all([saveBoard(workspaceId, board), saveMeta(workspaceId, { ...meta, revision: meta.revision + 1 })]);
	});
}

export async function saveAttachment(data: Buffer, ext: string, cardId: string): Promise<string> {
	const dir = join(ATTACHMENTS_DIR, cardId);
	await mkdir(dir, { recursive: true });
	const hash = createHash("sha256").update(data).digest("hex");
	const filePath = join(dir, `${hash}.${ext}`);
	if (!existsSync(filePath)) {
		await writeFile(filePath, data);
	}
	return filePath;
}

export async function updateCard(
	workspaceId: string,
	cardId: string,
	update: Partial<
		Pick<RuntimeBoardCard, "type" | "title" | "description" | "agentId" | "priority" | "readyForDev" | "dependsOn" | "workflowId" | "githubPrUrl" | "reviewComments" | "autoFixAttempts" | "githubCommentIds" | "worktreePath">
	>,
): Promise<RuntimeBoardCard> {
	return withLock(workspaceId, async () => {
		const board = await loadBoard(workspaceId);
		const card = board.cards[cardId];
		if (!card) {
			// Card was deleted before the update arrived — silently ignore
			return null as unknown as RuntimeBoardCard;
		}

		const updated: RuntimeBoardCard = { ...card, ...update, updatedAt: Date.now() };
		board.cards[cardId] = updated;

		const meta = await loadMeta(workspaceId);
		await Promise.all([saveBoard(workspaceId, board), saveMeta(workspaceId, { ...meta, revision: meta.revision + 1 })]);

		return updated;
	});
}

export async function deleteCard(workspaceId: string, cardId: string): Promise<void> {
	return withLock(workspaceId, async () => {
		const board = await loadBoard(workspaceId);
		delete board.cards[cardId];
		for (const col of board.columns) {
			col.taskIds = col.taskIds.filter((id) => id !== cardId);
		}

		const meta = await loadMeta(workspaceId);
		await Promise.all([saveBoard(workspaceId, board), saveMeta(workspaceId, { ...meta, revision: meta.revision + 1 })]);
	});

	// Best-effort cleanup of per-card attachment folder
	try {
		const { rm } = await import("node:fs/promises");
		await rm(join(ATTACHMENTS_DIR, cardId), { recursive: true, force: true });
	} catch {
		// ignore
	}
}

export async function removeWorkspace(workspaceId: string): Promise<void> {
	const index = await loadIndex();
	const entry = index.entries[workspaceId];
	if (!entry) return;
	delete index.entries[workspaceId];
	delete index.repoPathToId[entry.repoPath];
	await saveIndex(index);
}
