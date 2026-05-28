import { Button } from "@geckoui/geckoui";

export type ProjectSection = "general-automation" | "workflows" | "environment" | "instructions" | "integrations";
export type GlobalSection = "runtime" | "tunnel" | "slack" | "extension";
export type SettingsSection = ProjectSection | GlobalSection;

export function SectionHeader({ title, description }: { title: string; description: string }) {
	return (
		<div>
			<h2 className="text-base font-semibold text-gray-100">{title}</h2>
			<p className="text-sm text-gray-500 mt-1">{description}</p>
		</div>
	);
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<label className="text-xs text-gray-400 block mb-1">{label}</label>
			{children}
		</div>
	);
}

export function SaveRow({ saving, onSave }: { saving: boolean; onSave: () => void }) {
	return (
		<div className="flex justify-end pt-2">
			<Button onClick={onSave} disabled={saving}>
				{saving ? "Saving..." : "Save"}
			</Button>
		</div>
	);
}
