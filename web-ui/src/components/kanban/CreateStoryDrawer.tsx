import { Button, Drawer, Input, Select, SelectOption, Textarea, toast } from "@geckoui/geckoui";
import type { RuntimeBoardCard, Workflow } from "@runtime-contract";
import { ImagePlus, Layers, Pencil, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";

interface PendingImage { dataUrl: string; file: File }

async function uploadImages(workspaceId: string, cardId: string, images: PendingImage[]) {
  const { uploadAttachmentFile } = await import("@/runtime/attachments");
  const results = [];
  for (const img of images) results.push(await uploadAttachmentFile(workspaceId, cardId, img.file));
  return results;
}

function ImagePicker({ pending, onChange }: { pending: PendingImage[]; onChange: (imgs: PendingImage[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const addFiles = (files: FileList | File[]) => {
    Array.from(files).filter(f => f.type.startsWith("image/")).forEach(file => {
      const r = new FileReader();
      r.onload = ev => onChange([...pending, { dataUrl: ev.target?.result as string, file }]);
      r.readAsDataURL(file);
    });
  };
  return (
    <div>
      <input ref={ref} type="file" accept="image/*" multiple className="hidden"
        onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-1 mt-1">
          {pending.map((img, i) => (
            <div key={i} className="relative group">
              <img src={img.dataUrl} alt={img.file.name} className="h-12 w-12 object-cover rounded border border-gray-700" />
              <button type="button" onClick={() => onChange(pending.filter((_, j) => j !== i))}
                className="absolute -top-1 -right-1 size-4 rounded-full bg-gray-800 border border-gray-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <X size={9} className="text-gray-300" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => ref.current?.click()}
        className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors mt-1">
        <ImagePlus size={12} /> Attach image
      </button>
    </div>
  );
}

const COLUMN_BADGE: Record<string, string> = {
  todo: "text-gray-400 bg-gray-700",
  in_progress: "text-blue-400 bg-blue-400/10",
  reopened: "text-orange-400 bg-orange-400/10",
  ready_for_review: "text-green-400 bg-green-400/10",
  blocked: "text-red-400 bg-red-400/10",
  done: "text-emerald-400 bg-emerald-400/10",
};

const COLUMN_LABEL: Record<string, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  reopened: "Reopened",
  ready_for_review: "Ready for Review",
  blocked: "Blocked",
  done: "Done",
};

interface SubtaskDraft {
  tempId: string;
  title: string;
  description: string;
  priority: string;
  baseRef: string;
  workflowId: string;
  // real card IDs for existing board cards, or tempId strings for other drafts in this batch
  dependsOn: string[];
  pendingImages: PendingImage[];
}

interface CreateStoryDrawerProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  allCards: Record<string, RuntimeBoardCard>;
  workflows: Workflow[];
  onRefresh: () => void;
}

export function CreateStoryDrawer({
  open,
  onClose,
  workspaceId,
  allCards,
  workflows,
  onRefresh,
}: CreateStoryDrawerProps) {
  const storyWorkflows = workflows.filter((w) => w.forStory);
  const defaultStoryWorkflow = storyWorkflows[0];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [storyPendingImages, setStoryPendingImages] = useState<PendingImage[]>([]);
  const [priority, setPriority] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [workflowId, setWorkflowId] = useState(defaultStoryWorkflow?.id ?? "");
  const [subtasks, setSubtasks] = useState<SubtaskDraft[]>([]);
  const [subtaskDrawerOpen, setSubtaskDrawerOpen] = useState(false);
  const [editingTempId, setEditingTempId] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      trpc.cards.listBranches
        .query({ workspaceId })
        .then(({ branches: b, defaultBranch }) => {
          setBranches(b);
          setBaseRef(defaultBranch);
        })
        .catch(() => {});
    }
  }, [open, workspaceId]);

  const handleClose = () => {
    setTitle("");
    setDescription("");
    setStoryPendingImages([]);
    setPriority("");
    setWorkflowId(defaultStoryWorkflow?.id ?? "");
    setSubtasks([]);
    setEditingTempId(null);
    onClose();
  };

  const openAddDrawer = () => {
    setEditingTempId(null);
    setSubtaskDrawerOpen(true);
  };

  const openEditDrawer = (tempId: string) => {
    setEditingTempId(tempId);
    setSubtaskDrawerOpen(true);
  };

  const handleSubtaskSave = (subtask: SubtaskDraft) => {
    setSubtasks((prev) => {
      const idx = prev.findIndex((s) => s.tempId === subtask.tempId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = subtask;
        return next;
      }
      return [...prev, subtask];
    });
    setSubtaskDrawerOpen(false);
    setEditingTempId(null);
  };

  const handleCreate = async () => {
    if (!title.trim() || subtasks.length === 0) return;
    setLoading(true);
    try {
      // Pass 1: create all subtasks without intra-batch deps, build tempId → realId map
      const tempIdToRealId = new Map<string, string>();
      const created: Array<{ realId: string; rawDeps: string[] }> = [];

      for (const subtask of subtasks) {
        const existingDeps = subtask.dependsOn.filter(
          (dep) => !subtasks.some((s) => s.tempId === dep),
        );
        const card = await trpc.cards.create.mutate({
          workspaceId,
          title: subtask.title.trim(),
          description: subtask.description,
          type: "subtask",
          priority: (subtask.priority as "urgent" | "high" | "medium" | "low") || undefined,
          baseRef: subtask.baseRef || baseRef || undefined,
          workflowId: subtask.workflowId || undefined,
          dependsOn: existingDeps.length > 0 ? existingDeps : undefined,
          readyForDev: true,
        });
        if (subtask.pendingImages.length > 0) {
          const uploaded = await uploadImages(workspaceId, card.id, subtask.pendingImages);
          await trpc.cards.update.mutate({ workspaceId, cardId: card.id, descriptionAttachments: uploaded, revision: 0 });
        }
        tempIdToRealId.set(subtask.tempId, card.id);
        created.push({ realId: card.id, rawDeps: subtask.dependsOn });
      }

      // Pass 2: wire up intra-batch deps now that all IDs exist
      for (const { realId, rawDeps } of created) {
        const batchDeps = rawDeps.filter((dep) => tempIdToRealId.has(dep));
        if (batchDeps.length === 0) continue;
        const resolvedBatchDeps = batchDeps.map((dep) => tempIdToRealId.get(dep)!);
        const existingDeps = rawDeps.filter((dep) => !tempIdToRealId.has(dep));
        await trpc.cards.update.mutate({
          workspaceId,
          cardId: realId,
          dependsOn: [...existingDeps, ...resolvedBatchDeps],
          revision: 0,
        });
      }

      // Create the story card depending on all subtasks
      const storyCard = await trpc.cards.create.mutate({
        workspaceId,
        title: title.trim(),
        description,
        type: "story",
        priority: (priority as "urgent" | "high" | "medium" | "low") || undefined,
        baseRef: baseRef || undefined,
        workflowId: workflowId || undefined,
        dependsOn: created.map((c) => c.realId),
      });
      if (storyPendingImages.length > 0) {
        const uploaded = await uploadImages(workspaceId, storyCard.id, storyPendingImages);
        await trpc.cards.update.mutate({ workspaceId, cardId: storyCard.id, descriptionAttachments: uploaded, revision: 0 });
      }

      handleClose();
      onRefresh();
    } catch {
      toast.error("Failed to create story");
    } finally {
      setLoading(false);
    }
  };

  const editingSubtask = editingTempId ? subtasks.find((s) => s.tempId === editingTempId) : undefined;

  return (
    <>
      <Drawer
        open={open}
        handleClose={handleClose}
        placement="right"
        className="flex flex-col w-[500px] max-w-[500px] overflow-hidden"
      >
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Layers size={15} className="text-purple-400" />
            <h2 className="text-sm font-semibold text-gray-100">New Story</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Story</p>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Title</label>
              <Input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Story title..."
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Description</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/"));
                  if (files.length) { e.preventDefault(); files.forEach(file => { const r = new FileReader(); r.onload = ev => setStoryPendingImages(p => [...p, { dataUrl: ev.target?.result as string, file }]); r.readAsDataURL(file); }); }
                }}
                placeholder="What does this story accomplish?"
                rows={3}
              />
              <ImagePicker pending={storyPendingImages} onChange={setStoryPendingImages} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Base Branch</label>
                <Select value={baseRef} onChange={(v) => setBaseRef(v as string)} placeholder="Select branch">
                  {branches.map((b) => (
                    <SelectOption key={b} value={b} label={b} />
                  ))}
                </Select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Orch Workflow</label>
                <Select value={workflowId} onChange={(v) => setWorkflowId(v as string)} placeholder="None">
                  {storyWorkflows.map((w) => (
                    <SelectOption key={w.id} value={w.id} label={w.name} />
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Priority</label>
              <Select value={priority} onChange={(v) => setPriority(v as string)} placeholder="No priority" clearable>
                <SelectOption value="urgent" label="Urgent" />
                <SelectOption value="high" label="High" />
                <SelectOption value="medium" label="Medium" />
                <SelectOption value="low" label="Low" />
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Subtasks{subtasks.length > 0 && (
                  <span className="ml-1 text-gray-400 normal-case font-normal">({subtasks.length})</span>
                )}
              </p>
              {subtasks.length > 0 && (
                <Button size="sm" variant="ghost" onClick={openAddDrawer}>
                  <Plus size={11} className="mr-1" /> Add
                </Button>
              )}
            </div>

            {subtasks.length === 0 ? (
              <div
                onClick={openAddDrawer}
                className="border border-dashed border-gray-700 rounded-lg p-5 flex flex-col items-center gap-2 cursor-pointer hover:border-gray-600 hover:bg-gray-800/50 transition-colors"
              >
                <Plus size={16} className="text-gray-600" />
                <p className="text-xs text-gray-500">At least one subtask is required</p>
                <p className="text-xs text-gray-600">Click to add first subtask</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {subtasks.map((subtask, i) => {
                  const depLabels = subtask.dependsOn.map((dep) => {
                    const draft = subtasks.find((s) => s.tempId === dep);
                    if (draft) return draft.title;
                    return allCards[dep]?.title ?? dep;
                  });
                  return (
                    <div
                      key={subtask.tempId}
                      className="flex items-center gap-2.5 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2"
                    >
                      <span className="text-xs text-gray-600 shrink-0 w-4">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 truncate">{subtask.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {subtask.priority && (
                            <span className="text-xs text-gray-500">{subtask.priority}</span>
                          )}
                          {depLabels.length > 0 && (
                            <span className="text-[10px] text-orange-400 bg-orange-400/10 px-1.5 py-0.5 rounded">
                              after: {depLabels.join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => openEditDrawer(subtask.tempId)}
                        className="p-1 rounded text-gray-600 hover:text-gray-200 hover:bg-gray-700 transition-colors shrink-0"
                        title="Edit subtask"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => setSubtasks((prev) => prev.filter((s) => s.tempId !== subtask.tempId))}
                        className="p-1 rounded text-gray-600 hover:text-red-400 hover:bg-gray-700 transition-colors shrink-0"
                        title="Remove subtask"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 flex gap-2 justify-end px-5 py-4 border-t border-gray-800">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!title.trim() || subtasks.length === 0 || loading}>
            {loading ? "Creating..." : "Create Story"}
          </Button>
        </div>
      </Drawer>

      <AddSubtaskDrawer
        open={subtaskDrawerOpen}
        onClose={() => { setSubtaskDrawerOpen(false); setEditingTempId(null); }}
        allCards={allCards}
        workflows={workflows}
        branches={branches}
        defaultBranch={baseRef}
        draftSubtasks={subtasks}
        editingSubtask={editingSubtask}
        onSave={handleSubtaskSave}
      />
    </>
  );
}

interface AddSubtaskDrawerProps {
  open: boolean;
  onClose: () => void;
  allCards: Record<string, RuntimeBoardCard>;
  workflows: Workflow[];
  branches: string[];
  defaultBranch: string;
  draftSubtasks: SubtaskDraft[];
  editingSubtask?: SubtaskDraft;
  onSave: (subtask: SubtaskDraft) => void;
}

function AddSubtaskDrawer({
  open,
  onClose,
  allCards,
  workflows,
  branches,
  defaultBranch,
  draftSubtasks,
  editingSubtask,
  onSave,
}: AddSubtaskDrawerProps) {
  const taskWorkflows = workflows.filter((w) => !w.forStory);
  const defaultWorkflow = taskWorkflows.find((w) => w.isDefault) ?? taskWorkflows[0];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [priority, setPriority] = useState("");
  const [baseRef, setBaseRef] = useState(defaultBranch);
  const [workflowId, setWorkflowId] = useState(defaultWorkflow?.id ?? "");
  const [dependsOn, setDependsOn] = useState<string[]>([]);

  // Populate fields when editing or when drawer opens
  useEffect(() => {
    if (open) {
      if (editingSubtask) {
        setTitle(editingSubtask.title);
        setDescription(editingSubtask.description);
        setPendingImages(editingSubtask.pendingImages);
        setPriority(editingSubtask.priority);
        setBaseRef(editingSubtask.baseRef || defaultBranch);
        setWorkflowId(editingSubtask.workflowId || (defaultWorkflow?.id ?? ""));
        setDependsOn(editingSubtask.dependsOn);
      } else {
        setTitle("");
        setDescription("");
        setPendingImages([]);
        setPriority("");
        setBaseRef(defaultBranch);
        setWorkflowId(defaultWorkflow?.id ?? "");
        setDependsOn([]);
      }
    }
  }, [open, editingSubtask]);

  const handleClose = () => {
    onClose();
  };

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      tempId: editingSubtask?.tempId ?? `draft-${Date.now()}-${Math.random()}`,
      title: title.trim(),
      description,
      pendingImages,
      priority,
      baseRef,
      workflowId,
      dependsOn,
    });
  };

  const isEditing = !!editingSubtask;
  // Deps pool: existing board cards (non-done, non-story) + other drafts in the batch (excluding self)
  const otherDrafts = draftSubtasks.filter((s) => s.tempId !== editingSubtask?.tempId);
  const boardCardPool = Object.values(allCards).filter(
    (c) => c.columnId !== "done" && c.type !== "story",
  );

  return (
    <Drawer
      open={open}
      handleClose={handleClose}
      placement="right"
      className="flex flex-col w-[460px] max-w-[460px] overflow-hidden"
    >
      <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-100">
          {isEditing ? "Edit Subtask" : "Add Subtask"}
        </h2>
        <button
          onClick={handleClose}
          className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Title</label>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSave()}
            placeholder="Subtask title..."
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Description</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/"));
              if (files.length) { e.preventDefault(); files.forEach(file => { const r = new FileReader(); r.onload = ev => setPendingImages(p => [...p, { dataUrl: ev.target?.result as string, file }]); r.readAsDataURL(file); }); }
            }}
            placeholder="Describe what needs to be done..."
            rows={4}
          />
          <ImagePicker pending={pendingImages} onChange={setPendingImages} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Base Branch</label>
            <Select value={baseRef} onChange={(v) => setBaseRef(v as string)} placeholder="Select branch">
              {branches.map((b) => (
                <SelectOption key={b} value={b} label={b} />
              ))}
            </Select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Workflow</label>
            <Select value={workflowId} onChange={(v) => setWorkflowId(v as string)} placeholder="Default">
              {taskWorkflows.map((w) => (
                <SelectOption key={w.id} value={w.id} label={w.name + (w.isDefault ? " (default)" : "")} />
              ))}
            </Select>
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Priority</label>
          <Select value={priority} onChange={(v) => setPriority(v as string)} placeholder="No priority" clearable>
            <SelectOption value="urgent" label="Urgent" />
            <SelectOption value="high" label="High" />
            <SelectOption value="medium" label="Medium" />
            <SelectOption value="low" label="Low" />
          </Select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Depends on</label>
          <Select
            multiple
            value={dependsOn}
            onChange={(v) => setDependsOn(v)}
            placeholder="None"
            filterable
            clearable
          >
            {/* Other drafts in this story batch */}
            {otherDrafts.map((draft) => (
              <SelectOption
                key={draft.tempId}
                value={draft.tempId}
                label={draft.title}
                hideCheckIcon
                className={({ selected }) => (selected ? "bg-gray-700" : "")}
              >
                <div className="flex items-center justify-between w-full gap-2 min-w-0">
                  <span className="truncate text-sm">{draft.title}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium text-purple-400 bg-purple-400/10">
                    this story
                  </span>
                </div>
              </SelectOption>
            ))}
            {/* Existing board cards */}
            {boardCardPool.map((c) => (
              <SelectOption
                key={c.id}
                value={c.id}
                label={c.title}
                hideCheckIcon
                className={({ selected }) => (selected ? "bg-gray-700" : "")}
              >
                <div className="flex items-center justify-between w-full gap-2 min-w-0">
                  <span className="truncate text-sm">{c.title}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium ${COLUMN_BADGE[c.columnId] ?? "text-gray-400 bg-gray-700"}`}
                  >
                    {COLUMN_LABEL[c.columnId] ?? c.columnId}
                  </span>
                </div>
              </SelectOption>
            ))}
          </Select>
        </div>
      </div>

      <div className="shrink-0 flex gap-2 justify-end px-5 py-4 border-t border-gray-800">
        <Button variant="ghost" onClick={handleClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!title.trim()}>
          {isEditing ? "Save Changes" : "Add Subtask"}
        </Button>
      </div>
    </Drawer>
  );
}
