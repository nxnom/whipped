import {
  Button,
  ConfirmDialog,
  Dialog,
  Input,
  Select,
  SelectOption,
  Textarea,
  toast,
} from "@geckoui/geckoui";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import type {
  RuntimeBoardCard,
  RuntimeBoardColumnId,
  RuntimeWorkspaceStateResponse,
} from "@runtime-contract";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/runtime/trpc-client";
import { useUrlParam } from "@/runtime/url-state";
import { CardDetailPanel } from "./CardDetailPanel";
import { KanbanColumn } from "./KanbanColumn";

interface KanbanBoardProps {
  state: RuntimeWorkspaceStateResponse;
  onRefresh: () => void;
}

const DIALOG_CLASS = "w-full";

export function KanbanBoard({ state, onRefresh }: KanbanBoardProps) {
  const [detailCardId, setDetailCardId] = useUrlParam("card");
  const detailCard = detailCardId
    ? (state.board.cards[detailCardId] ?? null)
    : null;

  const handleCardDelete = (card: RuntimeBoardCard) => {
    ConfirmDialog.show({
      title: "Delete task?",
      content: `"${card.title}" will be permanently deleted.`,
      confirmButtonLabel: "Delete",
      cancelButtonLabel: "Cancel",
      onConfirm: async ({ dismiss }) => {
        try {
          await trpc.cards.delete.mutate({
            workspaceId: state.workspaceId,
            cardId: card.id,
          });
          dismiss();
          onRefresh();
        } catch {
          toast.error("Failed to delete task");
        }
      },
      onCancel: ({ dismiss }) => dismiss(),
    });
  };

  const openCreateDialog = () => {
    Dialog.show({
      className: DIALOG_CLASS,
      content: ({ dismiss }) => (
        <CreateCardContent
          workspaceId={state.workspaceId}
          allCards={state.board.cards}
          dismiss={dismiss}
          onRefresh={onRefresh}
        />
      ),
    });
  };

  const openEditDialog = (card: RuntimeBoardCard) => {
    Dialog.show({
      className: DIALOG_CLASS,
      content: ({ dismiss }) => (
        <EditCardContent
          workspaceId={state.workspaceId}
          card={card}
          allCards={state.board.cards}
          dismiss={dismiss}
          onRefresh={onRefresh}
        />
      ),
    });
  };

  const handleMoveAllToReady = () => {
    const todoColumn = state.board.columns.find((c) => c.id === "todo");
    const todoCards = (todoColumn?.taskIds ?? [])
      .map((id) => state.board.cards[id])
      .filter(Boolean);
    if (todoCards.length === 0) {
      toast.info("No tasks in Todo");
      return;
    }
    ConfirmDialog.show({
      title: "Move all to Ready for Dev?",
      content: `${todoCards.length} task${todoCards.length === 1 ? "" : "s"} will be moved from Todo to Ready for Dev.`,
      confirmButtonLabel: "Move all",
      cancelButtonLabel: "Cancel",
      onConfirm: async ({ dismiss }) => {
        dismiss();
        try {
          for (const card of todoCards) {
            await trpc.cards.move.mutate({
              workspaceId: state.workspaceId,
              cardId: card!.id,
              targetColumnId: "ready_for_dev",
              revision: state.revision,
            });
          }
          onRefresh();
          toast.success(
            `Moved ${todoCards.length} task${todoCards.length === 1 ? "" : "s"} to Ready for Dev`
          );
        } catch {
          toast.error("Failed to move tasks");
        }
      },
      onCancel: ({ dismiss }) => dismiss(),
    });
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    if (
      result.destination.droppableId === result.source.droppableId &&
      result.destination.index === result.source.index
    )
      return;

    try {
      await trpc.cards.move.mutate({
        workspaceId: state.workspaceId,
        cardId: result.draggableId,
        targetColumnId: result.destination.droppableId as RuntimeBoardColumnId,
        targetIndex: result.destination.index,
        revision: state.revision,
      });
      onRefresh();
    } catch {
      toast.error("Failed to move card");
    }
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col relative">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-medium text-gray-300">Board</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={handleMoveAllToReady}>
            Todo → Ready
          </Button>
          <Button size="sm" variant="outlined" onClick={openCreateDialog}>
            <Plus size={13} className="mr-1" /> New task
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto">
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-3 p-4 h-full">
            {state.board.columns.map((column) => {
              const cards = column.taskIds
                .map((id) => state.board.cards[id])
                .filter((c): c is RuntimeBoardCard => Boolean(c));
              return (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  cards={cards}
                  allCards={state.board.cards}
                  sessions={state.sessions}
                  onCardClick={(card) => setDetailCardId(card.id)}
                  onCardEdit={openEditDialog}
                  onCardDelete={handleCardDelete}
                />
              );
            })}
          </div>
        </DragDropContext>
      </div>

      {detailCard && (
        <CardDetailPanel
          card={detailCard}
          workspaceId={state.workspaceId}
          session={state.sessions[detailCard.id]}
          allCards={state.board.cards}
          onClose={() => setDetailCardId(null)}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}

const COLUMN_BADGE: Record<string, string> = {
  todo: "text-gray-400 bg-gray-700",
  ready_for_dev: "text-blue-400 bg-blue-400/10",
  in_progress: "text-blue-400 bg-blue-400/10",
  in_review: "text-purple-400 bg-purple-400/10",
  reopened: "text-orange-400 bg-orange-400/10",
  ready_for_review: "text-green-400 bg-green-400/10",
  blocked: "text-red-400 bg-red-400/10",
  done: "text-emerald-400 bg-emerald-400/10",
};

const COLUMN_LABEL: Record<string, string> = {
  todo: "Todo",
  ready_for_dev: "Ready",
  in_progress: "In Progress",
  in_review: "In Review",
  reopened: "Reopened",
  ready_for_review: "Ready for Review",
  blocked: "Blocked",
  done: "Done",
};

function CreateCardContent({
  workspaceId,
  allCards,
  dismiss,
  onRefresh,
}: {
  workspaceId: string;
  allCards: Record<string, RuntimeBoardCard>;
  dismiss: () => void;
  onRefresh: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState<"claude" | "codex">("claude");
  const [priority, setPriority] = useState<string>("");
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [baseRef, setBaseRef] = useState<string>("");
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    trpc.cards.listBranches
      .query({ workspaceId })
      .then(({ branches: b, defaultBranch }) => {
        setBranches(b);
        setBaseRef(defaultBranch);
      })
      .catch(() => { });
  }, [workspaceId]);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      await trpc.cards.create.mutate({
        workspaceId,
        title: title.trim(),
        description,
        agentId,
        priority:
          (priority as "urgent" | "high" | "medium" | "low" | undefined) ||
          undefined,
        dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
        baseRef: baseRef || undefined,
      });
      dismiss();
      onRefresh();
    } catch {
      toast.error("Failed to create task");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-100 mb-4">New Task</h3>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Title</label>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && !e.shiftKey && handleCreate()
            }
            placeholder="Task title..."
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">
            Description
          </label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what needs to be done..."
            rows={4}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              Base Branch
            </label>
            <Select
              value={baseRef}
              onChange={(v) => setBaseRef(v as string)}
              placeholder="Select branch"
            >
              {branches.map((b) => (
                <SelectOption key={b} value={b} label={b} />
              ))}
            </Select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Agent</label>
            <Select
              value={agentId}
              onChange={(v) => setAgentId(v as "claude" | "codex")}
              placeholder="Select agent"
            >
              <SelectOption value="claude" label="Claude Code" />
              <SelectOption value="codex" label="OpenAI Codex" />
            </Select>
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Priority</label>
          <Select
            value={priority}
            onChange={(v) => setPriority(v as string)}
            placeholder="No priority"
            clearable
          >
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
            {Object.values(allCards).map((c) => (
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

      <div className="flex gap-2 mt-5 justify-end">
        <Button variant="ghost" onClick={dismiss}>
          Cancel
        </Button>
        <Button onClick={handleCreate} disabled={!title.trim() || loading}>
          {loading ? "Creating..." : "Create"}
        </Button>
      </div>
    </div>
  );
}

function EditCardContent({
  workspaceId,
  card,
  allCards,
  dismiss,
  onRefresh,
}: {
  workspaceId: string;
  card: RuntimeBoardCard;
  allCards: Record<string, RuntimeBoardCard>;
  dismiss: () => void;
  onRefresh: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [priority, setPriority] = useState<string>(card.priority ?? "");
  const [dependsOn, setDependsOn] = useState<string[]>(card.dependsOn ?? []);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      await trpc.cards.update.mutate({
        workspaceId,
        cardId: card.id,
        title: title.trim(),
        description,
        priority:
          (priority as "urgent" | "high" | "medium" | "low" | undefined) ||
          undefined,
        dependsOn,
        revision: 0,
      });
      dismiss();
      onRefresh();
    } catch {
      toast.error("Failed to update task");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-100 mb-4">Edit Task</h3>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Title</label>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSave()}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">
            Description
          </label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Priority</label>
          <Select
            value={priority}
            onChange={(v) => setPriority(v as string)}
            placeholder="No priority"
            clearable
          >
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
            onChange={(v) => setDependsOn(v as string[])}
            placeholder="None"
            filterable
            clearable
          >
            {Object.values(allCards)
              .filter((c) => c.id !== card.id)
              .map((c) => (
                <SelectOption
                  key={c.id}
                  value={c.id}
                  label={c.title}
                  hideCheckIcon
                  className={({ selected }: { selected: boolean }) => selected ? "bg-gray-700" : ""}
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

      <div className="flex gap-2 mt-5 justify-end">
        <Button variant="ghost" onClick={dismiss}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!title.trim() || loading}>
          {loading ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
