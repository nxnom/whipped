import type { DiffFile, DiffHunk, TreeNode } from "./types";

export function parseDiff(raw: string): DiffFile[] {
	const files: DiffFile[] = [];
	let file: DiffFile | null = null;
	let hunk: DiffHunk | null = null;
	let oldLine = 0;
	let newLine = 0;

	for (const line of raw.split("\n")) {
		if (line.startsWith("diff --git ")) {
			if (file) files.push(file);
			file = {
				oldPath: "",
				newPath: "",
				additions: 0,
				deletions: 0,
				hunks: [],
				isBinary: false,
				isNew: false,
				isDeleted: false,
			};
			hunk = null;
		} else if (file && (line.startsWith("new file mode") || line === "new file")) {
			file.isNew = true;
		} else if (file && (line.startsWith("deleted file mode") || line === "deleted file")) {
			file.isDeleted = true;
		} else if (file && line.startsWith("Binary files")) {
			file.isBinary = true;
		} else if (file && line.startsWith("--- ")) {
			const p = line.slice(4);
			file.oldPath = p === "/dev/null" ? "/dev/null" : p.startsWith("a/") ? p.slice(2) : p;
		} else if (file && line.startsWith("+++ ")) {
			const p = line.slice(4);
			file.newPath = p === "/dev/null" ? "/dev/null" : p.startsWith("b/") ? p.slice(2) : p;
		} else if (file && line.startsWith("@@ ")) {
			const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (m) {
				oldLine = parseInt(m[1]!, 10) - 1;
				newLine = parseInt(m[2]!, 10) - 1;
			}
			hunk = { header: line, lines: [] };
			file.hunks.push(hunk);
		} else if (hunk && file) {
			if (line.startsWith("+") && !line.startsWith("+++")) {
				newLine++;
				hunk.lines.push({ type: "added", content: line.slice(1), oldNum: null, newNum: newLine });
				file.additions++;
			} else if (line.startsWith("-") && !line.startsWith("---")) {
				oldLine++;
				hunk.lines.push({ type: "removed", content: line.slice(1), oldNum: oldLine, newNum: null });
				file.deletions++;
			} else if (line.startsWith(" ")) {
				oldLine++;
				newLine++;
				hunk.lines.push({ type: "context", content: line.slice(1), oldNum: oldLine, newNum: newLine });
			}
		}
	}

	if (file) files.push(file);
	return files.filter((f) => f.oldPath || f.newPath || f.isBinary);
}

export function displayPath(file: DiffFile): string {
	if (file.isNew) return file.newPath;
	if (file.isDeleted) return file.oldPath;
	if (file.oldPath !== file.newPath && file.oldPath && file.newPath) return `${file.oldPath} → ${file.newPath}`;
	return file.newPath || file.oldPath;
}

export function fileElemId(path: string): string {
	return `diff-file-${path.replace(/[^a-z0-9]/gi, "_")}`;
}

export function buildFileTree(files: DiffFile[]): TreeNode {
	const root: TreeNode = { name: "", fullPath: "", isFile: false, children: [] };

	function insertFile(dirParts: string[], name: string, fullPath: string, file: DiffFile) {
		let node = root;
		for (let i = 0; i < dirParts.length; i++) {
			const part = dirParts[i]!;
			const fp = dirParts.slice(0, i + 1).join("/");
			let child = node.children.find((c) => c.fullPath === fp);
			if (!child) {
				child = { name: part, fullPath: fp, isFile: false, children: [] };
				node.children.push(child);
			}
			node = child;
		}
		node.children.push({ name, fullPath, isFile: true, file, children: [] });
	}

	for (const file of files) {
		const path = displayPath(file);
		if (path.includes(" → ")) {
			// Rename: place under new path's directory, show "oldFile → newFile"
			const [oldPath, newPath] = path.split(" → ") as [string, string];
			const newParts = newPath.split("/");
			const newFilename = newParts.pop()!;
			const oldFilename = oldPath.split("/").pop()!;
			const shortName = oldFilename === newFilename ? newFilename : `${oldFilename} → ${newFilename}`;
			insertFile(newParts, shortName, path, file);
		} else {
			const parts = path.split("/");
			const filename = parts.pop()!;
			insertFile(parts, filename, path, file);
		}
	}

	sortTree(root);
	return root;
}

function sortTree(node: TreeNode): void {
	node.children.sort((a, b) => {
		if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
		return a.name.localeCompare(b.name);
	});
	for (const child of node.children) {
		if (!child.isFile) sortTree(child);
	}
}
