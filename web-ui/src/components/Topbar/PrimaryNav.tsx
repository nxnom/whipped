import { useLocation, useNavigate } from "react-router-dom";
import { classNames } from "@/utils/classNames";
import { NAV_ITEMS } from "./constants";

interface PrimaryNavProps {
	workspaceId: string;
	recurringCount?: number;
}

export function PrimaryNav({ workspaceId, recurringCount = 0 }: PrimaryNavProps) {
	const navigate = useNavigate();
	const location = useLocation();
	const activeSegment = location.pathname.split("/").filter(Boolean)[1] ?? "board";

	return (
		<nav className="flex items-center gap-1">
			{NAV_ITEMS.map((item) => {
				const isActive = activeSegment === item.segment;
				return (
					<button
						key={item.segment}
						onClick={() => navigate(`/${encodeURIComponent(workspaceId)}/${item.segment}`)}
						className={classNames(
							"flex items-center gap-1.5 px-2.5 py-[7px] rounded-md text-xs font-medium border transition-colors",
							isActive
								? "bg-whip-panel border-whip-border text-whip-text"
								: "bg-transparent border-transparent text-whip-muted hover:text-whip-text",
						)}
					>
						{item.label}
						{item.segment === "recurring-agents" && recurringCount > 0 && (
							<span className="text-[10px] font-mono font-semibold text-whip-muted">{recurringCount}</span>
						)}
					</button>
				);
			})}
		</nav>
	);
}
