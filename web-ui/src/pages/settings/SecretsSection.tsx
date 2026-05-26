import { Textarea } from "@geckoui/geckoui";
import { BUILTIN_SECRET_KEYS, type RuntimeProjectSecret } from "@runtime-contract";
import { Eye, EyeOff, X } from "lucide-react";
import { useState } from "react";
import { SaveRow, SectionHeader } from "./_shared";

function parseEnvText(text: string): RuntimeProjectSecret[] {
	return text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#"))
		.flatMap((l) => {
			const noExport = l.replace(/^export\s+/, "");
			const eq = noExport.indexOf("=");
			if (eq === -1) return [];
			const key = noExport.slice(0, eq).trim();
			let value = noExport.slice(eq + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			return key ? [{ key, value }] : [];
		});
}

export function SecretsSection({
	secrets,
	onChange,
	onSave,
	saving,
}: {
	secrets: RuntimeProjectSecret[];
	onChange: (secrets: RuntimeProjectSecret[]) => void;
	onSave: (secrets: RuntimeProjectSecret[]) => void;
	saving: boolean;
}) {
	const [revealed, setRevealed] = useState<Set<string>>(new Set());
	const [envText, setEnvText] = useState("");

	const allSecrets: RuntimeProjectSecret[] = [
		...BUILTIN_SECRET_KEYS.map((key) => secrets.find((s) => s.key === key) ?? { key, value: "" }),
		...secrets.filter((s) => !(BUILTIN_SECRET_KEYS as readonly string[]).includes(s.key)),
	];

	const updateSecret = (key: string, value: string) => {
		onChange(allSecrets.map((s) => (s.key === key ? { ...s, value } : s)));
	};

	const removeSecret = (key: string) => {
		onChange(allSecrets.filter((s) => s.key !== key));
	};

	const toggleReveal = (key: string) => {
		setRevealed((prev) => {
			const next = new Set(prev);
			next.has(key) ? next.delete(key) : next.add(key);
			return next;
		});
	};

	const handleSave = () => {
		let toSave = allSecrets;
		if (envText.trim()) {
			const parsed = parseEnvText(envText);
			const merged = [...allSecrets];
			for (const { key, value } of parsed) {
				const idx = merged.findIndex((s) => s.key === key);
				if (idx !== -1) merged[idx] = { key, value };
				else merged.push({ key, value });
			}
			toSave = merged;
			setEnvText("");
		}
		onSave(toSave);
	};

	return (
		<>
			<SectionHeader
				title="Secrets"
				description="Tokens injected into every agent's system prompt. Stored locally only."
			/>

			{/* Secret rows */}
			<div className="border border-gray-800 rounded-xl overflow-hidden">
				{allSecrets.map((secret, i) => {
					const isBuiltin = (BUILTIN_SECRET_KEYS as readonly string[]).includes(secret.key);
					const isRevealed = revealed.has(secret.key);
					return (
						<div
							key={secret.key}
							className={`flex items-center gap-2 px-3 py-2 ${i < allSecrets.length - 1 ? "border-b border-gray-800" : ""}`}
						>
							<div className="flex items-center gap-1.5 w-40 shrink-0">
								<span className="text-xs font-mono text-gray-200 truncate">{secret.key}</span>
								{isBuiltin && (
									<span className="text-[9px] text-blue-400 border border-blue-500/30 px-1 py-px rounded shrink-0">
										default
									</span>
								)}
							</div>
							<div className="relative flex-1">
								<input
									type={isRevealed ? "text" : "password"}
									value={secret.value}
									onChange={(e) => updateSecret(secret.key, e.target.value)}
									placeholder="not set"
									className="w-full bg-transparent text-xs font-mono text-gray-300 placeholder-gray-600 focus:outline-none pr-6"
								/>
								<button
									type="button"
									onClick={() => toggleReveal(secret.key)}
									className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors"
								>
									{isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
								</button>
							</div>
							{!isBuiltin ? (
								<button
									onClick={() => removeSecret(secret.key)}
									className="text-gray-700 hover:text-red-400 transition-colors shrink-0"
								>
									<X size={12} />
								</button>
							) : (
								<div className="w-3 shrink-0" />
							)}
						</div>
					);
				})}
			</div>

			{/* Paste .env */}
			<div className="border-t border-gray-800 pt-4 space-y-2">
				<p className="text-xs text-gray-400">
					Paste <code className="text-gray-500">.env</code> — add or overwrite multiple secrets at once
				</p>
				<Textarea
					value={envText}
					onChange={(e) => setEnvText(e.target.value)}
					placeholder={'GITHUB_TOKEN=ghp_xxx\nFIGMA_TOKEN="abc123"\n# comments ignored'}
					rows={4}
					className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-xs font-mono text-gray-300 placeholder-gray-700 focus:outline-none focus:border-gray-600 resize-none"
				/>
			</div>

			<SaveRow saving={saving} onSave={handleSave} />
		</>
	);
}
