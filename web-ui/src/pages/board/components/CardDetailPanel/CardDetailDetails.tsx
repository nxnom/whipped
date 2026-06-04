import { Input, Select, SelectOption, toast } from "@geckoui/geckoui";
import { type RuntimeBoardCard, type TierLevel, TIER_LEVEL_OPTIONS } from "@runtime-contract";
import { Check, ChevronRight, ExternalLink, Gauge, GitBranch, Pencil, X } from "lucide-react";
import { useState } from "react";
import { useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";
import { COLUMN_LABELS, DEP_COL_BADGE } from "./constants";
import { DescAttachment } from "./DescAttachment";

interface CardDetailDetailsProps {
	card: RuntimeBoardCard;
	workspaceId: string;
	allCards?: Record<string, RuntimeBoardCard>;
	onRefresh: () => void;
}

export function CardDetailDetails({ card, workspaceId, allCards, onRefresh }: CardDetailDetailsProps) {
	const { trigger: updateCardTrigger } = useWrite((api) => api("cards/:id").PATCH());
	const [descExpanded, setDescExpanded] = useState(false);
	const [activityExpanded, setActivityExpanded] = useState(false);

	const saveLevel = async (level: TierLevel) => {
		const res = await updateCardTrigger({
			params: { id: card.id },
			body: { workspaceId, cardId: card.id, activeLevel: level, revision: 0 },
		});
		if (res.error) {
			toast.error("Failed to update model tier");
			return;
		}
		onRefresh();
	};
	const [editingBranch, setEditingBranch] = useState(false);
	const [branchInput, setBranchInput] = useState("");
	const [savingBranch, setSavingBranch] = useState(false);

	const currentBranch = card.branchName ?? `task/${card.id}`;
	const canEditBranch = !card.worktreePath;

	const startEditBranch = () => {
		setBranchInput(card.branchName ?? "");
		setEditingBranch(true);
	};

	const cancelEditBranch = () => {
		setEditingBranch(false);
		setBranchInput("");
	};

	const saveBranchName = async () => {
		const next = branchInput.trim();
		if (next === (card.branchName ?? "")) {
			cancelEditBranch();
			return;
		}
		setSavingBranch(true);
		try {
			const res = await updateCardTrigger({
				params: { id: card.id },
				body: { workspaceId, cardId: card.id, branchName: next || undefined, revision: 0 },
			});
			if (res.error) {
				toast.error("Failed to update branch name");
				return;
			}
			toast.success("Branch name updated");
			cancelEditBranch();
			onRefresh();
		} finally {
			setSavingBranch(false);
		}
	};

	const isImg = (att: { mimeType?: string; name: string }) =>
		(att.mimeType ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name);
	const imgs = (card.descriptionAttachments ?? []).filter(isImg);
	const files = (card.descriptionAttachments ?? []).filter((a) => !isImg(a));

	return (
		<>
			<div className="h-px bg-[#2a2a35] shrink-0" />

			{/* Details */}
			<div className="px-[18px] pt-3.5 pb-2 shrink-0">
				<span className="text-[11px] font-semibold text-[#8888a0] tracking-[0.3px]">Details</span>
			</div>
			<div className="flex-1 min-h-0 overflow-y-auto px-[18px] pb-4 flex flex-col gap-3">
				{/* Description */}
				{card.description && (
					<div>
						<p
							className={classNames(
								"text-xs text-[#8888a0] whitespace-pre-wrap leading-relaxed",
								descExpanded ? "" : "line-clamp-4",
							)}
						>
							{card.description}
						</p>
						{(card.description.split("\n").length > 4 || card.description.length > 240) && (
							<button
								onClick={() => setDescExpanded((v) => !v)}
								className="mt-1 text-[11px] text-[#4a4a5a] hover:text-[#8888a0] transition-colors"
							>
								{descExpanded ? "Show less" : "Show more"}
							</button>
						)}
					</div>
				)}

				{/* Description attachments — read-only */}
				{(card.descriptionAttachments?.length ?? 0) > 0 && (
					<div className="flex flex-col gap-1.5">
						{imgs.length > 0 && (
							<div className="flex flex-wrap gap-2">
								{imgs.map((att, idx) => (
									<DescAttachment key={idx} path={att.path} name={att.name} mimeType={att.mimeType} />
								))}
							</div>
						)}
						{files.length > 0 && (
							<div className="flex flex-wrap gap-1.5">
								{files.map((att, idx) => (
									<DescAttachment key={idx} path={att.path} name={att.name} mimeType={att.mimeType} />
								))}
							</div>
						)}
					</div>
				)}

				{/* Branch */}
				{card.baseRef && (
					<div className="flex items-start gap-2 text-xs text-[#8888a0]">
						<GitBranch size={11} className="shrink-0 mt-0.5" />
						{editingBranch ? (
							<div className="flex items-center gap-1 flex-1 min-w-0">
								<Input
									autoFocus
									value={branchInput}
									onChange={(e) => setBranchInput(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") void saveBranchName();
										if (e.key === "Escape") cancelEditBranch();
									}}
									placeholder={`task/${card.id}`}
									disabled={savingBranch}
								/>
								<button
									onClick={() => void saveBranchName()}
									disabled={savingBranch}
									className="p-1 rounded text-[#4a4a5a] hover:text-[#22c55e] hover:bg-[#1a1a1f] transition-colors disabled:opacity-50"
								>
									<Check size={12} />
								</button>
								<button
									onClick={cancelEditBranch}
									disabled={savingBranch}
									className="p-1 rounded text-[#4a4a5a] hover:text-[#8888a0] hover:bg-[#1a1a1f] transition-colors disabled:opacity-50"
								>
									<X size={12} />
								</button>
							</div>
						) : (
							<div className="flex items-center gap-1 flex-wrap">
								<span className="font-mono text-[#8888a0] truncate max-w-[110px]" title={currentBranch}>
									{currentBranch}
								</span>
								{canEditBranch && (
									<button
										onClick={startEditBranch}
										className="p-0.5 rounded text-[#4a4a5a] hover:text-[#8888a0] hover:bg-[#1a1a1f] transition-colors"
									>
										<Pencil size={10} />
									</button>
								)}
								<span className="text-[#4a4a5a]">→</span>
								<span className="font-mono text-[#8888a0] truncate max-w-[110px]">{card.baseRef}</span>
							</div>
						)}
					</div>
				)}

				{/* Model tier */}
				<div className="flex items-center gap-2 text-xs text-[#8888a0]">
					<Gauge size={11} className="shrink-0" />
					<span className="shrink-0">Tier</span>
					<div className="flex-1">
						<Select value={card.activeLevel} onChange={(v) => void saveLevel(v as TierLevel)}>
							{TIER_LEVEL_OPTIONS.map((o) => (
								<SelectOption key={o.value} value={o.value} label={o.label} />
							))}
						</Select>
					</div>
				</div>

				{/* Dependencies */}
				{(card.dependsOn ? [card.dependsOn] : (card.waitsFor ?? [])).length > 0 && (
					<div>
						<p className="text-[10px] font-medium text-[#4a4a5a] mb-1.5">
							{card.dependsOn ? "Depends on" : "Waits for"}
						</p>
						<div className="space-y-1">
							{(card.dependsOn ? [card.dependsOn] : (card.waitsFor ?? [])).map((depId) => {
								const dep = allCards?.[depId];
								if (!dep) return null;
								return (
									<div
										key={depId}
										className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-[#1a1a1f] border border-[#2a2a35]"
									>
										<span className="text-xs text-gray-300 truncate">{dep.description?.split("\n")[0] ?? dep.id}</span>
										<span
											className={classNames(
												"text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium",
												DEP_COL_BADGE[dep.columnId] ?? "text-gray-400 bg-gray-700",
											)}
										>
											{COLUMN_LABELS[dep.columnId] ?? dep.columnId}
										</span>
									</div>
								);
							})}
						</div>
					</div>
				)}

				{/* External links */}
				{(card.githubIssueUrl || card.pr?.url || card.jiraUrl) && (
					<div className="space-y-1">
						{card.githubIssueUrl && (
							<a
								href={card.githubIssueUrl}
								target="_blank"
								rel="noreferrer"
								className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300"
							>
								<ExternalLink size={11} /> GitHub Issue
							</a>
						)}
						{card.pr?.url && (
							<a
								href={card.pr?.url}
								target="_blank"
								rel="noreferrer"
								className="flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300"
							>
								<ExternalLink size={11} /> Pull Request
							</a>
						)}
						{card.jiraUrl && (
							<a
								href={card.jiraUrl}
								target="_blank"
								rel="noreferrer"
								className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300"
							>
								<ExternalLink size={11} /> {card.jiraKey}
							</a>
						)}
					</div>
				)}
			</div>

			<div className="h-px bg-[#2a2a35] shrink-0" />

			{/* Activity */}
			<div className="shrink-0">
				<button
					onClick={() => setActivityExpanded((v) => !v)}
					className="flex items-center w-full gap-1.5 px-[18px] py-3.5"
				>
					<span className="text-[11px] font-semibold text-[#8888a0] tracking-[0.3px] flex-1 text-left">Activity</span>
					<ChevronRight
						size={14}
						className={classNames(
							"text-[#4a4a5a] transition-transform duration-150",
							activityExpanded ? "rotate-90" : "",
						)}
					/>
				</button>
				{activityExpanded && (
					<div className="px-[18px] pb-3 max-h-48 overflow-y-auto">
						{!card.activityLog?.length ? (
							<p className="text-xs text-[#4a4a5a] py-2">No activity yet</p>
						) : (
							<div className="space-y-1.5">
								{card.activityLog.map((entry, i) => (
									<div key={i} className="flex items-baseline gap-2 text-xs">
										<span className="text-[#4a4a5a] shrink-0 tabular-nums">
											{new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
										</span>
										<span className="text-[#8888a0]">{entry.message}</span>
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</div>
		</>
	);
}
