import {
	ArrowLeft,
	BookOpen,
	Brain,
	ChevronDown,
	FolderGit2,
	Globe,
	Server,
	SlidersHorizontal,
	Slack,
	Terminal,
	Workflow,
} from "lucide-react";
import { classNames } from "@/utils/classNames";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRead } from "@/runtime/api-client";
import { useWorkspaceState } from "@/stores/board-store";
import { GlobalSettings } from "./GlobalSettings";
import { ProjectSettings } from "./ProjectSettings";
import { SlackSettings } from "./SlackSettings";
import { TunnelSettings } from "./TunnelSettings";
import type { GlobalSection, ProjectSection, SettingsSection } from "./_shared";

const PROJECT_NAV: Array<{ id: ProjectSection; label: string; icon: React.ReactNode }> = [
	{ id: "general-automation", label: "General & Automation", icon: <SlidersHorizontal size={15} /> },
	{ id: "workflows", label: "Workflows", icon: <Workflow size={15} /> },
	{ id: "environment", label: "Environment & Secrets", icon: <Terminal size={15} /> },
	{ id: "instructions", label: "Instructions", icon: <BookOpen size={15} /> },
	{ id: "memory", label: "Memory", icon: <Brain size={15} /> },
];

const GLOBAL_NAV: Array<{ id: GlobalSection; label: string; icon: React.ReactNode }> = [
	{ id: "runtime", label: "Runtime Config", icon: <Server size={15} /> },
	{ id: "tunnel", label: "Tunnel", icon: <Globe size={15} /> },
	{ id: "slack", label: "Slack", icon: <Slack size={15} /> },
];

function ProjectDropdown({ workspaceId, onSwitch }: { workspaceId: string; onSwitch: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	const { data } = useRead((api) => api("projects").GET());
	const workspaces = data ?? [];

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	const currentWs = workspaces.find((ws) => ws.workspaceId === workspaceId);
	const displayName = currentWs
		? currentWs.name || currentWs.repoPath.split("/").filter(Boolean).at(-1) || workspaceId
		: workspaceId;
	const displayPath = currentWs ? currentWs.repoPath.replace(/^\/Users\/[^/]+/, "~") : "";

	return (
		<div ref={ref} className="relative">
			<button
				onClick={() => setOpen((v) => !v)}
				className="w-full flex items-center gap-2.5 px-[18px] py-3 hover:bg-[#1a1a1f] transition-colors text-left"
			>
				<FolderGit2 size={14} className="mt-px shrink-0 text-[#60607a]" />
				<div className="flex-1 min-w-0">
					<p className="text-[12px] font-medium truncate text-[#c0c0d0]">{displayName}</p>
					{displayPath && <p className="text-[10px] truncate mt-0.5 font-mono text-[#4a4a5a]">{displayPath}</p>}
				</div>
				<ChevronDown
					size={13}
					className={classNames("shrink-0 transition-transform text-[#60607a]", open ? "rotate-180" : "rotate-0")}
				/>
			</button>

			{open && (
				<div className="absolute left-0 right-0 z-50 flex flex-col overflow-hidden top-full bg-[#1a1a1f] border border-[#2a2a35] rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.4)] mt-1 mx-2">
					{workspaces.map((ws) => {
						const isCurrent = ws.workspaceId === workspaceId;
						const name = ws.name || ws.repoPath.split("/").filter(Boolean).at(-1) || ws.workspaceId;
						const path = ws.repoPath.replace(/^\/Users\/[^/]+/, "~");
						return (
							<button
								key={ws.workspaceId}
								onClick={() => {
									setOpen(false);
									if (!isCurrent) onSwitch(ws.workspaceId);
								}}
								className={classNames(
									"flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[#2a2a35]",
									isCurrent ? "bg-[#7c6aff12]" : "bg-transparent",
								)}
							>
								<FolderGit2
									size={13}
									className={classNames("shrink-0 mt-px", isCurrent ? "text-[#7c6aff]" : "text-[#60607a]")}
								/>
								<div className="flex-1 min-w-0">
									<p
										className={classNames(
											"text-[12px] font-medium truncate",
											isCurrent ? "text-[#f0f0f5]" : "text-[#c0c0d0]",
										)}
									>
										{name}
									</p>
									{path && <p className="text-[10px] truncate font-mono text-[#4a4a5a]">{path}</p>}
								</div>
								{isCurrent && <div className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#7c6aff]" />}
							</button>
						);
					})}
					{workspaces.length === 0 && <p className="px-3 py-2.5 text-[11px] text-[#4a4a5a]">Loading…</p>}
				</div>
			)}
		</div>
	);
}

const PROJECT_SECTIONS = new Set<SettingsSection>([
	"general-automation",
	"workflows",
	"environment",
	"instructions",
	"memory",
]);

export function SettingsPage() {
	const navigate = useNavigate();
	const { workspaceId, section: sectionParam } = useParams<{ workspaceId: string; section: string }>();
	const section = (sectionParam as SettingsSection | undefined) ?? "general-automation";
	const isProject = PROJECT_SECTIONS.has(section);
	useWorkspaceState(workspaceId ?? "");
	if (!workspaceId) return null;

	const handleSelect = (s: SettingsSection) => {
		navigate(`/${encodeURIComponent(workspaceId)}/settings/${s}`);
	};

	const handleSwitchProject = (toId: string) => {
		navigate(`/${encodeURIComponent(toId)}/settings/${section}`);
	};

	return (
		<div className="flex-1 overflow-hidden flex bg-[#0f0f10]">
			{/* Sidebar */}
			<aside className="w-[220px] shrink-0 flex flex-col bg-[#141418] border-r border-[#2a2a35]">
				{/* Header */}
				<button
					onClick={() => navigate(`/${encodeURIComponent(workspaceId)}/board`)}
					className="flex items-center gap-2 p-[18px] hover:opacity-80 transition-opacity text-left w-full"
				>
					<ArrowLeft size={16} className="text-[#60607a]" />
					<span className="text-sm font-semibold text-[#f0f0f5]">Settings</span>
				</button>
				<div className="h-px bg-[#2a2a35]" />

				{/* Project dropdown */}
				<ProjectDropdown workspaceId={workspaceId} onSwitch={handleSwitchProject} />
				<div className="h-px bg-[#2a2a35]" />

				{/* PROJECT section */}
				<div className="px-[18px] pt-[14px] pb-[6px]">
					<span className="text-[10px] font-medium uppercase text-[#4a4a5a] tracking-[1px]">PROJECT</span>
				</div>
				{PROJECT_NAV.map((item) => (
					<NavItem key={item.id} item={item} active={section === item.id} onSelect={handleSelect} />
				))}

				<div className="flex-1" />

				{/* GLOBAL section */}
				<div className="border-t border-[#2a2a35]">
					<div className="px-[18px] pt-[14px] pb-[6px]">
						<span className="text-[10px] font-medium uppercase text-[#4a4a5a] tracking-[1px]">GLOBAL</span>
					</div>
					{GLOBAL_NAV.map((item) => (
						<NavItem key={item.id} item={item} active={section === item.id} onSelect={handleSelect} />
					))}
					<div className="h-4" />
				</div>
			</aside>

			{/* Content */}
			<div className="flex-1 overflow-hidden flex flex-col">
				{isProject ? (
					<ProjectSettings workspaceId={workspaceId} section={section as ProjectSection} />
				) : section === "slack" ? (
					<SlackSettings />
				) : section === "tunnel" ? (
					<TunnelSettings />
				) : (
					<GlobalSettings section={section as GlobalSection} />
				)}
			</div>
		</div>
	);
}

function NavItem({
	item,
	active,
	onSelect,
}: {
	item: { id: SettingsSection; label: string; icon: React.ReactNode };
	active: boolean;
	onSelect: (id: SettingsSection) => void;
}) {
	return (
		<button
			onClick={() => onSelect(item.id)}
			className={classNames(
				"w-full flex items-center gap-[10px] py-2 px-[18px] text-xs transition-colors border-l-2",
				active ? "bg-[#1f1f28] border-[#7c6aff]" : "bg-transparent border-transparent",
			)}
		>
			<span className={classNames("flex items-center", active ? "text-[#7c6aff]" : "text-[#60607a]")}>{item.icon}</span>
			<span className={classNames(active ? "text-[#f0f0f5] font-medium" : "text-[#8888a0]")}>{item.label}</span>
		</button>
	);
}
