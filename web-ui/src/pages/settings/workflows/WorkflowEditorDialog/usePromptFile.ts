import { toast } from "@geckoui/geckoui";
import type { WorkflowSlotForm } from "@runtime-validation/workflow";
import { useEffect, useRef, useState } from "react";
import { useRead, useWrite } from "@/runtime/api-client";
import type { SaveStatus } from "./types";

export function usePromptFile({
	workspaceId,
	selectedSlot,
	slotKey,
}: {
	workspaceId: string;
	selectedSlot: WorkflowSlotForm | undefined;
	slotKey: string;
}) {
	const [linkedContent, setLinkedContent] = useState("");
	const [pathDraft, setPathDraft] = useState("");
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
	const [browsingPath, setBrowsingPath] = useState(false);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingSaveRef = useRef<{ path: string; content: string } | null>(null);

	const { trigger: writePromptFile } = useWrite((api) => api("workflows/prompt-file").POST());
	// Lazy read: the builder needs a query shape, but the actual path is supplied
	// per-fetch via trigger({ query }).
	const { trigger: readPromptFile } = useRead(
		(api) => api("workflows/prompt-file").GET({ query: { workspaceId, path: "" } }),
		{ enabled: false },
	);

	const flushSave = () => {
		if (saveTimerRef.current) {
			clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}
		const pending = pendingSaveRef.current;
		pendingSaveRef.current = null;
		if (!pending) return;
		setSaveStatus("saving");
		void writePromptFile({ body: { workspaceId, path: pending.path, content: pending.content } }).then((res) => {
			if (res.error) {
				setSaveStatus("error");
				toast.error(`Save failed: ${res.error.message}`);
			} else {
				setSaveStatus("saved");
			}
		});
	};

	const scheduleSave = (path: string, content: string) => {
		pendingSaveRef.current = { path, content };
		setSaveStatus("unsaved");
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(() => flushSave(), 500);
	};

	// Load file content when the selected slot (or its path) changes.
	useEffect(() => {
		if (!selectedSlot) return;
		if (selectedSlot.prompt.source !== "file") {
			setLinkedContent("");
			setPathDraft("");
			setSaveStatus("idle");
			return;
		}
		setPathDraft(selectedSlot.prompt.path);
		if (!selectedSlot.prompt.path) {
			setLinkedContent("");
			setSaveStatus("idle");
			return;
		}
		setSaveStatus("loading");
		void readPromptFile({ query: { workspaceId, path: selectedSlot.prompt.path } }).then((res) => {
			if (res.error) {
				setLinkedContent("");
				setSaveStatus("error");
				toast.error(`Couldn't read file: ${res.error.message}`);
			} else {
				setLinkedContent(res.data.content);
				setSaveStatus("saved");
			}
		});
		// slotKey covers id + source + path
	}, [slotKey, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

	// Flush any pending file save on unmount (closing the dialog).
	useEffect(() => {
		return () => {
			flushSave();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return {
		linkedContent,
		setLinkedContent,
		pathDraft,
		setPathDraft,
		saveStatus,
		setSaveStatus,
		browsingPath,
		setBrowsingPath,
		flushSave,
		scheduleSave,
	};
}
