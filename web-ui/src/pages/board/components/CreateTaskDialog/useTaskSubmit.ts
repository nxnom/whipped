import { toast } from "@geckoui/geckoui";
import type { RuntimeBoardCard } from "@runtime-contract";
import type { CreateStoryForm, CreateTaskForm } from "@runtime-validation/card";
import { useWrite } from "@/runtime/api-client";
import { uploadImages } from "./helpers";
import type { PendingImage, SubtaskDraft } from "./types";

interface TaskSubmitArgs {
	workspaceId: string;
	allCards: Record<string, RuntimeBoardCard>;
	readyForDev: boolean;
	pendingImages: PendingImage[];
}

interface StorySubmitArgs {
	workspaceId: string;
	drafts: SubtaskDraft[];
	readyForDev: boolean;
	pendingImages: PendingImage[];
}

// Card creation flows for the task/story dialog. Each returns whether the create
// succeeded so the caller can close/refresh; failures surface their own toast.
export function useTaskSubmit() {
	const { trigger: createCard } = useWrite((api) => api("cards").POST());
	const { trigger: updateCard } = useWrite((api) => api("cards/:id").PATCH());

	const submitTask = async (
		data: CreateTaskForm,
		{ workspaceId, allCards, readyForDev, pendingImages }: TaskSubmitArgs,
	) => {
		// Inherit shared worktree from the single dep if present
		let sharedWorktreeId: string | undefined;
		if (data.dependsOn.length === 1) {
			const dep = allCards[data.dependsOn[0]!];
			if (dep) sharedWorktreeId = dep.sharedWorktreeId ?? dep.id;
		}
		const res = await createCard({
			body: {
				workspaceId,
				description: data.description.trim(),
				priority: data.priority || undefined,
				readyForDev: readyForDev || undefined,
				dependsOn: data.dependsOn.length > 0 ? data.dependsOn : undefined,
				baseRef: data.baseRef || undefined,
				workflowId: data.workflowId || undefined,
				branchName: data.branchName.trim() || undefined,
				sharedWorktreeId,
			},
		});
		if (res.error || !res.data) {
			toast.error("Failed to create task");
			return false;
		}
		const card = res.data;
		if (pendingImages.length > 0) {
			const uploaded = await uploadImages(workspaceId, card.id, pendingImages);
			await updateCard({
				params: { id: card.id },
				body: { workspaceId, cardId: card.id, descriptionAttachments: uploaded, revision: 0 },
			});
		}
		return true;
	};

	const submitStory = async (
		data: CreateStoryForm,
		{ workspaceId, drafts, readyForDev, pendingImages }: StorySubmitArgs,
	) => {
		const tempIdToRealId = new Map<string, string>();
		const created: Array<{ realId: string; rawDeps: string[] }> = [];
		for (const subtask of drafts) {
			const existingDeps = subtask.dependsOn.filter((dep) => !drafts.some((s) => s.tempId === dep));
			const res = await createCard({
				body: {
					workspaceId,
					description: subtask.description.trim(),
					type: "subtask",
					priority: subtask.priority || undefined,
					baseRef: subtask.baseRef || data.baseRef || undefined,
					workflowId: subtask.workflowId || undefined,
					branchName: subtask.branchName.trim() || undefined,
					dependsOn: existingDeps.length > 0 ? existingDeps : undefined,
					readyForDev,
				},
			});
			if (res.error || !res.data) {
				toast.error("Failed to create story");
				return false;
			}
			const card = res.data;
			if (subtask.pendingImages.length > 0) {
				const uploaded = await uploadImages(workspaceId, card.id, subtask.pendingImages);
				await updateCard({
					params: { id: card.id },
					body: { workspaceId, cardId: card.id, descriptionAttachments: uploaded, revision: 0 },
				});
			}
			tempIdToRealId.set(subtask.tempId, card.id);
			created.push({ realId: card.id, rawDeps: subtask.dependsOn });
		}

		// Resolve intra-batch dependencies (tempId → real id) now that all exist.
		for (const { realId, rawDeps } of created) {
			const batchDeps = rawDeps.filter((dep) => tempIdToRealId.has(dep));
			if (batchDeps.length === 0) continue;
			const resolvedBatchDeps = batchDeps.map((dep) => tempIdToRealId.get(dep)!);
			const existingDeps = rawDeps.filter((dep) => !tempIdToRealId.has(dep));
			await updateCard({
				params: { id: realId },
				body: { workspaceId, cardId: realId, dependsOn: [...existingDeps, ...resolvedBatchDeps], revision: 0 },
			});
		}

		const storyRes = await createCard({
			body: {
				workspaceId,
				description: data.description.trim(),
				type: "story",
				priority: data.priority || undefined,
				baseRef: data.baseRef || undefined,
				workflowId: data.workflowId || undefined,
				dependsOn: created.map((c) => c.realId),
			},
		});
		if (storyRes.error || !storyRes.data) {
			toast.error("Failed to create story");
			return false;
		}
		const storyCard = storyRes.data;
		if (pendingImages.length > 0) {
			const uploaded = await uploadImages(workspaceId, storyCard.id, pendingImages);
			await updateCard({
				params: { id: storyCard.id },
				body: { workspaceId, cardId: storyCard.id, descriptionAttachments: uploaded, revision: 0 },
			});
		}

		// Wire sharedWorktreeId on all subtasks so they share the story's worktree.
		for (const { realId } of created) {
			await updateCard({
				params: { id: realId },
				body: { workspaceId, cardId: realId, sharedWorktreeId: storyCard.id, revision: 0 },
			});
		}
		return true;
	};

	return { submitTask, submitStory };
}
