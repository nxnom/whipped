import {
	ArrowLeft,
	Bell,
	BookOpen,
	Brain,
	Globe,
	Server,
	SlidersHorizontal,
	Slack,
	Terminal,
	Workflow,
} from "lucide-react";
import { classNames } from "@/utils/classNames";
import { useNavigate, useParams } from "react-router-dom";
import { useWorkspaceState } from "@/stores/board-store";
import { GlobalSettings } from "./GlobalSettings";
import { NotificationsSettings } from "./NotificationsSettings";
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
	{ id: "notifications", label: "Notifications", icon: <Bell size={15} /> },
	{ id: "tunnel", label: "Tunnel", icon: <Globe size={15} /> },
	{ id: "slack", label: "Slack", icon: <Slack size={15} /> },
];

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

	return (
		<div className="flex-1 overflow-hidden flex bg-whip-bg">
			{/* Sidebar */}
			<aside className="w-[220px] shrink-0 flex flex-col bg-whip-bg border-r border-[#2a2a2a]">
				{/* Header */}
				<button
					onClick={() => navigate(`/${encodeURIComponent(workspaceId)}/board`)}
					className="flex items-center gap-2 p-[18px] hover:opacity-80 transition-opacity text-left w-full"
				>
					<ArrowLeft size={16} className="text-[#5f6672]" />
					<span className="text-sm font-semibold text-[#ededed]">Settings</span>
				</button>
				<div className="h-px bg-[#2a2a2a]" />

				{/* PROJECT section */}
				<div className="px-[18px] pt-[14px] pb-[6px]">
					<span className="text-[10px] font-medium uppercase text-[#5f6672] tracking-[1px]">PROJECT</span>
				</div>
				{PROJECT_NAV.map((item) => (
					<NavItem key={item.id} item={item} active={section === item.id} onSelect={handleSelect} />
				))}

				<div className="flex-1" />

				{/* GLOBAL section */}
				<div className="border-t border-[#2a2a2a]">
					<div className="px-[18px] pt-[14px] pb-[6px]">
						<span className="text-[10px] font-medium uppercase text-[#5f6672] tracking-[1px]">GLOBAL</span>
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
				) : section === "notifications" ? (
					<NotificationsSettings />
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
				active ? "bg-[#161616] border-[#ffffff]" : "bg-transparent border-transparent",
			)}
		>
			<span className={classNames("flex items-center", active ? "text-[#ffffff]" : "text-[#5f6672]")}>{item.icon}</span>
			<span className={classNames(active ? "text-[#ededed] font-medium" : "text-[#8a8f98]")}>{item.label}</span>
		</button>
	);
}
