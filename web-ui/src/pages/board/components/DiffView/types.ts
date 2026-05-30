export interface DiffLine {
	type: "added" | "removed" | "context";
	content: string;
	oldNum: number | null;
	newNum: number | null;
}

export interface DiffHunk {
	header: string;
	lines: DiffLine[];
}

export interface DiffFile {
	oldPath: string;
	newPath: string;
	additions: number;
	deletions: number;
	hunks: DiffHunk[];
	isBinary: boolean;
	isNew: boolean;
	isDeleted: boolean;
}

export interface PendingComment {
	id: string;
	file: string;
	lineKey: string;
	lineNum: number | null;
	text: string;
}

export interface TreeNode {
	name: string;
	fullPath: string;
	isFile: boolean;
	file?: DiffFile;
	children: TreeNode[];
}
