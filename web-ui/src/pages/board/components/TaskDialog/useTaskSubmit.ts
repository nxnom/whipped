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

	const submitTask = async (data: CreateTaskForm, { workspaceId, readyForDev, pendingImages }: TaskSubmitArgs) => {
		const res = await createCard({
			body: {
				workspaceId,
				description: data.description.trim(),
				priority: data.priority || undefined,
				readyForDev: readyForDev || undefined,
				dependsOn: data.dependsOn || undefined,
				waitsFor: data.waitsFor.length > 0 ? data.waitsFor : undefined,
				baseRef: data.baseRef || undefined,
				workflowId: data.workflowId || undefined,
				branchName: data.branchName.trim() || undefined,
				activeLevel: data.activeLevel || undefined,
				modelConfig: data.modelConfig,
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
		const created: Array<{ realId: string; rawDep?: string }> = [];
		for (const subtask of drafts) {
			const existingDep =
				subtask.dependsOn && !drafts.some((s) => s.tempId === subtask.dependsOn) ? subtask.dependsOn : undefined;
			const res = await createCard({
				body: {
					workspaceId,
					description: subtask.description.trim(),
					type: "subtask",
					priority: subtask.priority || undefined,
					baseRef: subtask.baseRef || data.baseRef || undefined,
					workflowId: subtask.workflowId || undefined,
					branchName: subtask.branchName.trim() || undefined,
					dependsOn: existingDep,
					readyForDev,
					activeLevel: subtask.activeLevel || undefined,
					modelConfig: subtask.modelConfig,
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
			created.push({ realId: card.id, rawDep: subtask.dependsOn || undefined });
		}

		// Resolve intra-batch dependencies (tempId → real id) now that all exist.
		for (const { realId, rawDep } of created) {
			const batchDep = rawDep && tempIdToRealId.has(rawDep) ? tempIdToRealId.get(rawDep) : undefined;
			if (!batchDep) continue;
			await updateCard({
				params: { id: realId },
				body: { workspaceId, cardId: realId, dependsOn: batchDep, revision: 0 },
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
				activeLevel: data.activeLevel || undefined,
				modelConfig: data.modelConfig,
				subtaskIds: created.map((c) => c.realId),
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

		// Subtasks share the story's worktree implicitly — resolved at runtime from the
		// story's subtaskIds, so no per-subtask wiring is needed.
		return true;
	};

	return { submitTask, submitStory };
}
