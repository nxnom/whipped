import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function git(args: string[], cwd: string): string {
	return spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).stdout?.trim() ?? "";
}

function readFileSafe(filePath: string): string {
	try {
		return readFileSync(filePath, "utf-8");
	} catch {
		return "";
	}
}

// Stat summary only — always small, safe to include in every prompt
export function getGitStat(worktreePath: string, baseRef: string): string {
	const parts = [
		git(["diff", "--stat", `${baseRef}...HEAD`], worktreePath),
		git(["diff", "--stat", "--cached"], worktreePath),
		git(["diff", "--stat"], worktreePath),
	].filter(Boolean);

	const newUntracked = git(["ls-files", "--others", "--exclude-standard"], worktreePath)
		.split("\n")
		.map((f) => f.trim())
		.filter(Boolean);
	if (newUntracked.length > 0) {
		parts.push(`New files:\n${newUntracked.map((f) => `  ${f}`).join("\n")}`);
	}

	return parts.join("\n") || "(no changes detected — agent may not have committed yet)";
}

// Full diff + new file contents — can be huge for large changesets
export function getGitFullDiff(worktreePath: string, baseRef: string): string {
	const sections: string[] = [];

	const diffParts = [
		git(["diff", "-U15", `${baseRef}...HEAD`], worktreePath),
		git(["diff", "-U15", "--cached"], worktreePath),
		git(["diff", "-U15"], worktreePath),
	].filter(Boolean);

	if (diffParts.length > 0) {
		sections.push(`\`\`\`diff\n${diffParts.join("\n")}\n\`\`\``);
	}

	const newUntracked = git(["ls-files", "--others", "--exclude-standard"], worktreePath)
		.split("\n")
		.map((f) => f.trim())
		.filter(Boolean);
	if (newUntracked.length > 0) {
		const newFileContents: string[] = [];
		for (const file of newUntracked) {
			const content = readFileSafe(join(worktreePath, file));
			const ext = file.split(".").pop() ?? "";
			newFileContents.push(content ? `### ${file}\n\`\`\`${ext}\n${content}\n\`\`\`` : `### ${file} (unreadable)`);
		}
		sections.push(`New files (full content):\n\n${newFileContents.join("\n\n")}`);
	}

	return sections.join("\n\n");
}

// Current HEAD commit of the worktree. Anchors a follow-up review's diff to the
// state a prior same-type review already looked at. Empty string if unavailable.
export function getGitHeadSha(worktreePath: string): string {
	return git(["rev-parse", "HEAD"], worktreePath);
}

const DIFF_MAX_BUFFER = 4 * 1024 * 1024;

export interface WorktreeDiffResult {
	diff: string | null;
	error: string | null;
	baseBehindCount?: number;
}

// One diff from the merge-base to the working tree covers committed, staged and
// unstaged changes in a single coherent pass. Concatenating separate diffs
// (base...HEAD + --cached + unstaged) repeats any file that changed in more
// than one of them, which breaks consumers that key by file path.
export function buildWorktreeDiff(worktreePath: string, baseRef: string): WorktreeDiffResult {
	const mergeBaseResult = spawnSync("git", ["merge-base", baseRef, "HEAD"], {
		cwd: worktreePath,
		encoding: "utf-8",
	});
	if (mergeBaseResult.status !== 0) {
		return { diff: null, error: mergeBaseResult.stderr?.trim() || "Failed to resolve merge base" };
	}

	const diffResult = spawnSync("git", ["diff", mergeBaseResult.stdout.trim(), "--no-color", "-U3"], {
		cwd: worktreePath,
		encoding: "utf-8",
		maxBuffer: DIFF_MAX_BUFFER,
	});
	if (diffResult.status !== 0 && diffResult.stderr) {
		return { diff: null, error: diffResult.stderr.trim() };
	}

	// Untracked new files are invisible to git diff but are real changes when
	// auto-commit is disabled — include them as synthetic diffs.
	const untrackedResult = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
		cwd: worktreePath,
		encoding: "utf-8",
	});
	const untrackedDiffs = (untrackedResult.stdout ?? "")
		.split("\n")
		.map((f) => f.trim())
		.filter(Boolean)
		.map((file) => {
			const header = `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}`;
			const content = readFileSafe(join(worktreePath, file));
			if (!content) return header;
			const lines = content.split("\n");
			const addedLines = lines.map((l) => `+${l}`).join("\n");
			return `${header}\n@@ -0,0 +1,${lines.length} @@\n${addedLines}`;
		});

	const diff = [diffResult.stdout, ...untrackedDiffs].filter((s) => s?.trim()).join("\n");

	const behindResult = spawnSync("git", ["rev-list", "--count", `HEAD..${baseRef}`], {
		cwd: worktreePath,
		encoding: "utf-8",
	});
	const baseBehindCount = parseInt(behindResult.stdout?.trim() ?? "0", 10) || 0;

	return { diff, error: null, baseBehindCount };
}

const INLINE_DIFF_LIMIT = 8000;

/** Format the diff block. Inlines when small; otherwise tells the agent how to fetch. */
export function formatDiffBlock(fullDiff: string, baseRef: string, header = "Git diff"): string {
	if (fullDiff.length <= INLINE_DIFF_LIMIT) return `${header}:\n${fullDiff}`;
	return `Large changeset (${fullDiff.length.toLocaleString()} chars). Use \`git diff ${baseRef}...HEAD\` and read individual files to explore.`;
}
