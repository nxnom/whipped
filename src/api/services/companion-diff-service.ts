import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { getCompanionSession } from "../../state/companion-sessions-store.js";
import { NotFoundError } from "../errors/http-errors.js";

const MAX_BUFFER = 4 * 1024 * 1024;

export const getCompanionDiffService = async (
	id: string,
): Promise<{ diff: string | null; error: string | null; baseBehindCount?: number }> => {
	const session = getCompanionSession(id);
	if (!session) throw NotFoundError("Companion session");
	if (!session.worktreePath || !existsSync(session.worktreePath)) {
		return { diff: null, error: "No worktree — agent has not started yet" };
	}
	const worktreePath = session.worktreePath;

	const committedResult = spawnSync("git", ["diff", `${session.baseRef}...HEAD`, "--no-color", "-U3"], {
		cwd: worktreePath,
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
	});
	if (committedResult.status !== 0 && committedResult.stderr) {
		return { diff: null, error: committedResult.stderr.trim() };
	}

	const stagedResult = spawnSync("git", ["diff", "--cached", "--no-color", "-U3"], {
		cwd: worktreePath,
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
	});
	const unstagedResult = spawnSync("git", ["diff", "--no-color", "-U3"], {
		cwd: worktreePath,
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
	});

	const untrackedResult = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
		cwd: worktreePath,
		encoding: "utf-8",
	});
	const untrackedFiles = (untrackedResult.stdout ?? "")
		.split("\n")
		.map((f) => f.trim())
		.filter(Boolean);
	const untrackedDiffs = untrackedFiles
		.map((file) => {
			try {
				const content = readFileSync(`${worktreePath}/${file}`, "utf-8");
				const lines = content.split("\n");
				const addedLines = lines.map((l) => `+${l}`).join("\n");
				const hunkHeader = `@@ -0,0 +1,${lines.length} @@`;
				return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n${hunkHeader}\n${addedLines}`;
			} catch {
				return null;
			}
		})
		.filter((d): d is string => d !== null);

	const diff = [committedResult.stdout, stagedResult.stdout, unstagedResult.stdout, ...untrackedDiffs]
		.filter((s) => s?.trim())
		.join("\n");

	const behindResult = spawnSync("git", ["rev-list", "--count", `HEAD..${session.baseRef}`], {
		cwd: worktreePath,
		encoding: "utf-8",
	});
	const baseBehindCount = parseInt(behindResult.stdout?.trim() ?? "0", 10) || 0;

	return { diff, error: null, baseBehindCount };
};

export interface CompanionCommitEntry {
	hash: string;
	shortHash: string;
	message: string;
	author: string;
	date: string;
}

export const getCompanionCommitsService = async (id: string): Promise<{ commits: CompanionCommitEntry[] }> => {
	const session = getCompanionSession(id);
	if (!session) throw NotFoundError("Companion session");
	if (!session.worktreePath || !existsSync(session.worktreePath)) return { commits: [] };

	const result = spawnSync("git", ["log", "--pretty=format:%H%x00%h%x00%s%x00%an%x00%ai", `${session.baseRef}..HEAD`], {
		cwd: session.worktreePath,
		encoding: "utf-8",
	});
	if (result.status !== 0 || !result.stdout?.trim()) return { commits: [] };

	const commits = result.stdout
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [hash = "", shortHash = "", message = "", author = "", date = ""] = line.split("\x00");
			return { hash, shortHash, message, author, date };
		});

	return { commits };
};

export const getCompanionDiffForCommitService = async (
	id: string,
	commitHash: string,
): Promise<{ diff: string | null; error: string | null }> => {
	const session = getCompanionSession(id);
	if (!session) throw NotFoundError("Companion session");
	if (!/^[0-9a-f]{4,64}$/i.test(commitHash)) return { diff: null, error: "Invalid commit hash" };
	if (!session.worktreePath || !existsSync(session.worktreePath)) return { diff: null, error: "No worktree" };

	const result = spawnSync("git", ["show", commitHash, "--format=", "--patch", "--no-color", "-U3"], {
		cwd: session.worktreePath,
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
	});
	if (result.status !== 0) return { diff: null, error: result.stderr?.trim() || "git show failed" };

	return { diff: result.stdout, error: null };
};
