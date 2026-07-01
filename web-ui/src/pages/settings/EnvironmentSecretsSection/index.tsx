import { BUILTIN_SECRET_KEYS, type RuntimeProjectConfig, type RuntimeProjectSecret } from "@runtime-contract";
import { ClipboardPaste, Plus } from "lucide-react";
import { useState } from "react";
import { parseEnvText } from "./helpers";
import { NewSecretRow } from "./NewSecretRow";
import { SecretRow } from "./SecretRow";
import { WorktreeSetupForm } from "./WorktreeSetupForm";

export function EnvironmentSecretsSection({
	workspaceId,
	config,
	saving,
	onUpdate,
	// biome-ignore lint/correctness/noUnusedFunctionParameters: required by caller interface
	onSave,
	onSaveSecrets,
}: {
	workspaceId: string;
	config: RuntimeProjectConfig;
	saving: boolean;
	onUpdate: (next: RuntimeProjectConfig) => void;
	onSave: () => void;
	onSaveSecrets: (secrets: RuntimeProjectSecret[]) => void;
}) {
	const [addingSecret, setAddingSecret] = useState(false);
	const [pasteOpen, setPasteOpen] = useState(false);
	const [envText, setEnvText] = useState("");

	const allSecrets: RuntimeProjectSecret[] = [
		...BUILTIN_SECRET_KEYS.map((key) => config.secrets?.find((s) => s.key === key) ?? { key, value: "" }),
		...(config.secrets ?? []).filter((s) => !(BUILTIN_SECRET_KEYS as readonly string[]).includes(s.key)),
	];

	const updateSecret = (key: string, value: string) => {
		onUpdate({ ...config, secrets: allSecrets.map((s) => (s.key === key ? { ...s, value } : s)) });
	};

	const removeSecret = (key: string) => {
		onUpdate({ ...config, secrets: allSecrets.filter((s) => s.key !== key) });
	};

	const addSecret = (key: string) => {
		if (allSecrets.some((s) => s.key === key)) return;
		onUpdate({ ...config, secrets: [...allSecrets, { key, value: "" }] });
		setAddingSecret(false);
	};

	const handleSaveAll = () => {
		onSaveSecrets(allSecrets);
	};

	const handlePasteApply = () => {
		const parsed = parseEnvText(envText);
		const merged = [...allSecrets];
		for (const { key, value } of parsed) {
			const idx = merged.findIndex((s) => s.key === key);
			if (idx !== -1) merged[idx] = { key, value };
			else merged.push({ key, value });
		}
		onSaveSecrets(merged);
		setEnvText("");
		setPasteOpen(false);
	};

	return (
		<div className="flex flex-col gap-7">
			{/* ── Worktree Setup ── */}
			<WorktreeSetupForm workspaceId={workspaceId} config={config} onUpdate={onUpdate} />

			{/* ── Secrets ── */}
			<div className="flex flex-col gap-4">
				{/* Secrets header */}
				<div className="flex items-center gap-2">
					<span className="text-[15px] font-semibold shrink-0 text-[#ededed]">Secrets</span>
					<div className="flex-1 h-px bg-[#111111]" />

					{/* Paste .env */}
					<button
						onClick={() => setPasteOpen((v) => !v)}
						className="flex items-center gap-1.5 hover:opacity-80 transition-opacity border border-[#2a2a2a] rounded-[5px] px-2.5 py-[5px] text-[#8a8f98]"
					>
						<ClipboardPaste size={12} />
						<span className="text-[11px]">Paste .env</span>
					</button>

					{/* Add Secret */}
					<button
						onClick={() => setAddingSecret(true)}
						className="flex items-center gap-1.5 hover:opacity-80 transition-opacity border border-[#ffffff] rounded-[5px] px-2.5 py-[5px] text-[#ffffff]"
					>
						<Plus size={12} />
						<span className="text-[11px] font-medium">Add Secret</span>
					</button>
				</div>

				{/* Paste .env expand */}
				{pasteOpen && (
					<div className="flex flex-col gap-2">
						<textarea
							value={envText}
							onChange={(e) => setEnvText(e.target.value)}
							placeholder={'GITHUB_TOKEN=ghp_xxx\nFIGMA_TOKEN="abc123"\n# comments ignored'}
							rows={5}
							className="w-full font-mono text-[12px] focus:outline-none resize-none bg-[#111111] border border-[#2a2a2a] rounded-md px-3 py-[9px] text-[#ededed]"
						/>
						<div className="flex justify-end gap-2">
							<button
								onClick={() => {
									setPasteOpen(false);
									setEnvText("");
								}}
								className="text-[12px] px-3 py-1.5 rounded-md hover:opacity-70 transition-opacity text-[#8a8f98] border border-[#2a2a2a]"
							>
								Cancel
							</button>
							<button
								onClick={handlePasteApply}
								disabled={!envText.trim()}
								className="text-[12px] font-medium px-3 py-1.5 rounded-md transition-opacity disabled:opacity-40 bg-[#ffffff] text-white"
							>
								Apply
							</button>
						</div>
					</div>
				)}

				{/* Secret rows */}
				{allSecrets.map((secret) => (
					<SecretRow
						key={secret.key}
						secret={secret}
						isBuiltin={(BUILTIN_SECRET_KEYS as readonly string[]).includes(secret.key)}
						onUpdate={(value) => updateSecret(secret.key, value)}
						onRemove={() => removeSecret(secret.key)}
					/>
				))}

				{/* New secret row */}
				{addingSecret && <NewSecretRow onAdd={addSecret} />}
			</div>

			{/* Single save */}
			<div className="flex justify-end">
				<button
					onClick={handleSaveAll}
					disabled={saving}
					className="text-sm font-medium px-4 py-2 rounded-lg transition-opacity disabled:opacity-50 bg-[#ffffff] text-white"
				>
					{saving ? "Saving..." : "Save"}
				</button>
			</div>
		</div>
	);
}
