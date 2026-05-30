export interface Props {
	onClose: () => void;
	onAdded: (workspaceId: string) => void;
}

export type Step = "select" | "configure";
export type PathStatus = "idle" | "checking" | "valid" | "invalid";

export interface RepoInfo {
	name: string | null;
	branch: string | null;
	remote: string | null;
}
