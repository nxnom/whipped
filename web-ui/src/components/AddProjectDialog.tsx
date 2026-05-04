import { Button, Input, toast } from "@geckoui/geckoui";
import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { trpc } from "@/runtime/trpc-client";
import { FolderPickerDialog } from "./FolderPickerDialog";

interface Props {
	onClose: () => void;
	onAdded: (workspaceId: string) => void;
}

export function AddProjectDialog({ onClose, onAdded }: Props) {
	const [repoPath, setRepoPath] = useState("");
	const [loading, setLoading] = useState(false);
	const [showPicker, setShowPicker] = useState(false);

	const handleAdd = async () => {
		if (!repoPath.trim()) return;
		setLoading(true);
		try {
			const result = await trpc.projects.add.mutate({ repoPath: repoPath.trim() });
			onAdded(result.workspaceId);
			toast.success("Project added");
		} catch {
			toast.error("Failed to add project. Check the path is a valid git repo.");
		} finally {
			setLoading(false);
		}
	};

	return (
		<>
			<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
				<div
					className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-full max-w-md"
					onClick={(e) => e.stopPropagation()}
				>
					<h3 className="text-base font-semibold text-gray-100 mb-4">Add Project</h3>

					<div className="mb-4">
						<label className="text-xs text-gray-400 block mb-1">Repository path</label>
						<div className="flex gap-2">
							<Input
								value={repoPath}
								onChange={(e) => setRepoPath(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && handleAdd()}
								placeholder="/Users/you/projects/my-app"
								className="flex-1"
							/>
							<Button variant="outlined" size="sm" onClick={() => setShowPicker(true)} title="Browse folders">
								<FolderOpen size={14} />
							</Button>
						</div>
					</div>

					<div className="flex gap-2 justify-end">
						<Button variant="ghost" onClick={onClose}>
							Cancel
						</Button>
						<Button onClick={handleAdd} disabled={!repoPath.trim() || loading}>
							{loading ? "Adding..." : "Add Project"}
						</Button>
					</div>
				</div>
			</div>

			{showPicker && (
				<FolderPickerDialog
					initialPath={repoPath || undefined}
					onSelect={(path) => {
						setRepoPath(path);
						setShowPicker(false);
					}}
					onClose={() => setShowPicker(false)}
				/>
			)}
		</>
	);
}
