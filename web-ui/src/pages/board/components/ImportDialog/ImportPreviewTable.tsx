import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { classNames } from "@/utils/classNames";
import type { ParsedImportRow } from "./types";

const HEADER = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[#5f6672]";
const CELL = "px-3 py-2 align-top text-[#c8c8d4]";

export function ImportPreviewTable({ rows }: { rows: ParsedImportRow[] }) {
	return (
		<div className="overflow-auto rounded-lg border border-[#2a2a2a]">
			<table className="w-full border-collapse text-xs">
				<thead className="sticky top-0 bg-[#16161c]">
					<tr className="border-b border-[#2a2a2a]">
						<th className={HEADER}>#</th>
						<th className={HEADER}>Title</th>
						<th className={HEADER}>Type</th>
						<th className={HEADER}>Workflow</th>
						<th className={HEADER}>Priority</th>
						<th className={HEADER}>Deps</th>
						<th className={HEADER}>Status</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => {
						const invalid = row.errors.length > 0;
						return (
							<tr
								key={row.index}
								className={classNames(
									"border-b border-[#21212a] last:border-0",
									invalid ? "bg-[#ff3b4d]/5" : "hover:bg-[#1a1a22]",
								)}
							>
								<td className={classNames(CELL, "text-[#5f6672]")}>{row.index + 1}</td>
								<td className={classNames(CELL, "max-w-[280px]")}>
									<span className="line-clamp-2">{row.title}</span>
								</td>
								<td className={CELL}>{row.type}</td>
								<td className={CELL}>
									<span className="flex items-center gap-1.5">
										{row.resolvedWorkflowName}
										{row.defaulted && (
											<span
												title="No matching workflow — using the default"
												className="flex items-center gap-0.5 rounded bg-[#eab308]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#eab308]"
											>
												<AlertTriangle size={9} />
												default
											</span>
										)}
									</span>
								</td>
								<td className={CELL}>{row.priority || "—"}</td>
								<td className={classNames(CELL, "max-w-[160px]")}>
									{row.deps.length > 0 ? <span className="line-clamp-2">{row.deps.join(", ")}</span> : "—"}
								</td>
								<td className={CELL}>
									{invalid ? (
										<span className="flex items-start gap-1 text-[#ff3b4d]">
											<XCircle size={12} className="mt-0.5 shrink-0" />
											<span>{row.errors.join("; ")}</span>
										</span>
									) : (
										<CheckCircle2 size={13} className="text-[#22c55e]" />
									)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
