import { ArrowLeft, Bot, GitBranch, Key, MessageSquare, Settings2, Terminal, Ticket, Zap } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { GlobalSettings } from "./GlobalSettings";
import { ProjectSettings } from "./ProjectSettings";
import {
	type GlobalSection,
	type ProjectSection,
	type SettingsSection,
} from "./_shared";

const PROJECT_NAV: Array<{ id: ProjectSection; label: string; icon: React.ReactNode }> = [
	{ id: "autonomous", label: "Autonomous", icon: <Zap size={14} /> },
	{ id: "workflows", label: "Workflows", icon: <Bot size={14} /> },
	{ id: "assistant", label: "Assistant", icon: <MessageSquare size={14} /> },
	{ id: "environment", label: "Environment", icon: <Terminal size={14} /> },
	{ id: "git", label: "Git", icon: <GitBranch size={14} /> },
	{ id: "secrets", label: "Secrets", icon: <Key size={14} /> },
	{ id: "jira", label: "Jira", icon: <Ticket size={14} /> },
];

const GLOBAL_NAV: Array<{ id: GlobalSection; label: string; icon: React.ReactNode }> = [
	{ id: "general", label: "General", icon: <Settings2 size={14} /> },
];

const PROJECT_SECTIONS = new Set<SettingsSection>([
	"autonomous",
	"workflows",
	"assistant",
	"environment",
	"secrets",
	"jira",
	"git",
]);

export function SettingsPage() {
	const navigate = useNavigate();
	const { workspaceId, section: sectionParam } = useParams<{ workspaceId: string; section: string }>();
	const section = (sectionParam as SettingsSection | undefined) ?? "autonomous";
	const isProject = PROJECT_SECTIONS.has(section);
	if (!workspaceId) return null;

	const handleSelect = (s: SettingsSection) => {
		navigate(`/${encodeURIComponent(workspaceId)}/settings/${s}`);
	};

	return (
		<div className="flex-1 overflow-hidden flex flex-col">
			{/* Header */}
			<div className="shrink-0 border-b border-gray-800 px-4 h-10 flex items-center gap-3">
				<button
					onClick={() => navigate(`/${encodeURIComponent(workspaceId)}/board`)}
					className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
				>
					<ArrowLeft size={14} />
					Board
				</button>
				<span className="text-gray-700 text-sm">/</span>
				<span className="text-sm text-gray-300">Settings</span>
				<span className="text-gray-700 text-sm">/</span>
				<span className="text-sm text-gray-400 capitalize">{section}</span>
			</div>

			<div className="flex-1 overflow-hidden flex">
				{/* Sidebar nav */}
				<nav className="w-44 shrink-0 border-r border-gray-800 py-4 overflow-y-auto">
					<NavGroup label="Project" items={PROJECT_NAV} activeId={section} onSelect={handleSelect} />
					<NavGroup label="Global" items={GLOBAL_NAV} activeId={section} onSelect={handleSelect} />
				</nav>

				{/* Content */}
				<div className="flex-1 overflow-hidden">
					{isProject ? (
						<ProjectSettings workspaceId={workspaceId} section={section as ProjectSection} />
					) : (
						<GlobalSettings section={section as GlobalSection} />
					)}
				</div>
			</div>
		</div>
	);
}

function NavGroup({
	label,
	items,
	activeId,
	onSelect,
}: {
	label: string;
	items: Array<{ id: SettingsSection; label: string; icon: React.ReactNode }>;
	activeId: SettingsSection;
	onSelect: (id: SettingsSection) => void;
}) {
	return (
		<div className="mb-4">
			<p className="px-4 pb-1 text-[10px] font-medium uppercase tracking-widest text-gray-600">{label}</p>
			{items.map((item) => (
				<button
					key={item.id}
					onClick={() => onSelect(item.id)}
					className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors
						${activeId === item.id ? "text-white bg-gray-800" : "text-gray-400 hover:text-gray-200 hover:bg-gray-900"}`}
				>
					{item.icon}
					{item.label}
				</button>
			))}
		</div>
	);
}
