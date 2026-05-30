export type FlatItem =
	| { kind: "folder-header"; folderId: string }
	| { kind: "project"; workspaceId: string; folderId: string | null }
	| { kind: "empty-folder-slot"; folderId: string };
