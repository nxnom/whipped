import { Button } from "@geckoui/geckoui";

export type ProjectSection = "general-automation" | "workflows" | "environment" | "instructions" | "memory";
export type GlobalSection = "runtime" | "notifications" | "tunnel" | "slack";
export type SettingsSection = ProjectSection | GlobalSection;

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<label className="text-xs text-whip-muted block mb-1">{label}</label>
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
