import {
	ArrowLeft,
	BookOpen,
	ChevronDown,
	FolderGit2,
	Plug,
	Server,
	SlidersHorizontal,
	Slack,
	Terminal,
	Workflow,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { trpc } from "@/runtime/trpc-client";
import { useWorkspaceState } from "@/stores/board-store";
import { GlobalSettings } from "./GlobalSettings";
import { ProjectSettings } from "./ProjectSettings";
import { SlackSettings } from "./SlackSettings";
import {
	type GlobalSection,
	type ProjectSection,
	type SettingsSection,
} from "./_shared";

const PROJECT_NAV: Array<{ id: ProjectSection; label: string; icon: React.ReactNode }> = [
	{ id: "general-automation", label: "General & Automation", icon: <SlidersHorizontal size={15} /> },
	{ id: "workflows", label: "Workflows", icon: <Workflow size={15} /> },
	{ id: "environment", label: "Environment & Secrets", icon: <Terminal size={15} /> },
	{ id: "instructions", label: "Instructions", icon: <BookOpen size={15} /> },
	{ id: "integrations", label: "Integrations", icon: <Plug size={15} /> },
];

const GLOBAL_NAV: Array<{ id: GlobalSection; label: string; icon: React.ReactNode }> = [
	{ id: "runtime", label: "Runtime Config", icon: <Server size={15} /> },
	{ id: "slack", label: "Slack", icon: <Slack size={15} /> },
];

function ProjectDropdown({
	workspaceId,
	projectName,
	shortPath,
	onSwitch,
}: {
	workspaceId: string;
	projectName: string;
	shortPath: string;
	onSwitch: (id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [workspaces, setWorkspaces] = useState<{ workspaceId: string; name: string; repoPath: string }[]>([]);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		trpc.projects.list.query().then(setWorkspaces).catch(() => {});
	}, []);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	return (
		<div ref={ref} className="relative">
			<button
				onClick={() => setOpen((v) => !v)}
				className="w-full flex items-center gap-2.5 px-[18px] py-3 hover:bg-[#1a1a1f] transition-colors text-left"
			>
				<FolderGit2 size={14} className="mt-px shrink-0" style={{ color: "#60607a" }} />
				<div className="flex-1 min-w-0">
					<p className="text-[12px] font-medium truncate" style={{ color: "#c0c0d0" }}>
						{projectName}
					</p>
					{shortPath && (
						<p className="text-[10px] truncate mt-0.5 font-mono" style={{ color: "#4a4a5a" }}>
							{shortPath}
						</p>
					)}
				</div>
				<ChevronDown
					size={13}
					className="shrink-0 transition-transform"
					style={{ color: "#60607a", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
				/>
			</button>

			{open && (
				<div
					className="absolute left-0 right-0 z-50 flex flex-col overflow-hidden"
					style={{
						top: "100%",
						background: "#1a1a1f",
						border: "1px solid #2a2a35",
						borderRadius: 8,
						boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
						margin: "4px 8px 0",
					}}
				>
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
								className="flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[#2a2a35]"
								style={{ background: isCurrent ? "#7c6aff12" : "transparent" }}
							>
								<FolderGit2
									size={13}
									className="shrink-0 mt-px"
									style={{ color: isCurrent ? "#7c6aff" : "#60607a" }}
								/>
								<div className="flex-1 min-w-0">
									<p
										className="text-[12px] font-medium truncate"
										style={{ color: isCurrent ? "#f0f0f5" : "#c0c0d0" }}
									>
										{name}
									</p>
									{path && (
										<p className="text-[10px] truncate font-mono" style={{ color: "#4a4a5a" }}>
											{path}
										</p>
									)}
								</div>
								{isCurrent && (
									<div
										className="shrink-0"
										style={{ width: 6, height: 6, borderRadius: "50%", background: "#7c6aff" }}
									/>
								)}
							</button>
						);
					})}
					{workspaces.length === 0 && (
						<p className="px-3 py-2.5 text-[11px]" style={{ color: "#4a4a5a" }}>
							Loading…
						</p>
					)}
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
	"integrations",
]);

export function SettingsPage() {
	const navigate = useNavigate();
	const { workspaceId, section: sectionParam } = useParams<{ workspaceId: string; section: string }>();
	const section = (sectionParam as SettingsSection | undefined) ?? "general-automation";
	const isProject = PROJECT_SECTIONS.has(section);
	const { state: wsState } = useWorkspaceState(workspaceId ?? "");
	if (!workspaceId) return null;

	const repoPath = wsState?.repoPath ?? "";
	const projectName = wsState?.projectConfig.name || repoPath.split("/").filter(Boolean).at(-1) || workspaceId;
	const shortPath = repoPath.replace(/^\/Users\/[^/]+/, "~");

	const handleSelect = (s: SettingsSection) => {
		navigate(`/${encodeURIComponent(workspaceId)}/settings/${s}`);
	};

	const handleSwitchProject = (toId: string) => {
		navigate(`/${encodeURIComponent(toId)}/settings/${section}`);
	};

	return (
		<div className="flex-1 overflow-hidden flex bg-[#0f0f10]">
			{/* Sidebar */}
			<aside
				className="w-[220px] shrink-0 flex flex-col"
				style={{ background: "#141418", borderRight: "1px solid #2a2a35" }}
			>
				{/* Header */}
				<button
					onClick={() => navigate(`/${encodeURIComponent(workspaceId)}/board`)}
					className="flex items-center gap-2 p-[18px] hover:opacity-80 transition-opacity text-left w-full"
				>
					<ArrowLeft size={16} style={{ color: "#60607a" }} />
					<span className="text-sm font-semibold" style={{ color: "#f0f0f5" }}>
						Settings
					</span>
				</button>
				<div style={{ height: 1, background: "#2a2a35" }} />

				{/* Project dropdown */}
				<ProjectDropdown
					workspaceId={workspaceId}
					projectName={projectName}
					shortPath={shortPath}
					onSwitch={handleSwitchProject}
				/>
				<div style={{ height: 1, background: "#2a2a35" }} />

				{/* PROJECT section */}
				<div className="px-[18px] pt-[14px] pb-[6px]">
					<span
						className="text-[10px] font-medium uppercase"
						style={{ color: "#4a4a5a", letterSpacing: 1 }}
					>
						PROJECT
					</span>
				</div>
				{PROJECT_NAV.map((item) => (
					<NavItem
						key={item.id}
						item={item}
						active={section === item.id}
						onSelect={handleSelect}
					/>
				))}

				<div className="flex-1" />

				{/* GLOBAL section */}
				<div style={{ borderTop: "1px solid #2a2a35" }}>
					<div className="px-[18px] pt-[14px] pb-[6px]">
						<span
							className="text-[10px] font-medium uppercase"
							style={{ color: "#4a4a5a", letterSpacing: 1 }}
						>
							GLOBAL
						</span>
					</div>
					{GLOBAL_NAV.map((item) => (
						<NavItem
							key={item.id}
							item={item}
							active={section === item.id}
							onSelect={handleSelect}
						/>
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
			className="w-full flex items-center gap-[10px] py-2 text-xs transition-colors"
			style={{
				paddingLeft: 18,
				paddingRight: 18,
				background: active ? "#1f1f28" : "transparent",
				borderLeft: active ? "2px solid #7c6aff" : "2px solid transparent",
			}}
		>
			<span style={{ color: active ? "#7c6aff" : "#60607a", display: "flex", alignItems: "center" }}>
				{item.icon}
			</span>
			<span style={{ color: active ? "#f0f0f5" : "#8888a0", fontWeight: active ? 500 : 400 }}>
				{item.label}
			</span>
		</button>
	);
}
