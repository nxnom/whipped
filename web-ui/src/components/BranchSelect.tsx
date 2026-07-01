import { Select, SelectOption } from "@geckoui/geckoui";
import { GitBranch } from "lucide-react";

interface BranchSelectProps {
	branches: string[];
	value: string;
	onChange: (branch: string) => void;
	placeholder?: string;
}

export function BranchSelect({ branches, value, onChange, placeholder = "Select branch" }: BranchSelectProps) {
	return (
		<Select
			value={value}
			onChange={(v) => onChange(v as string)}
			placeholder={placeholder}
			filterable
			prefix={<GitBranch size={13} className="text-[#8a8f98]" />}
		>
			{branches.map((b) => (
				<SelectOption key={b} value={b} label={b} />
			))}
		</Select>
	);
}
