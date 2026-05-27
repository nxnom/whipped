import { BUILTIN_SECRET_KEYS, type RuntimeProjectConfig, type RuntimeProjectSecret } from "@runtime-contract";
import { ClipboardPaste, Eye, EyeOff, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";
import { toast } from "@geckoui/geckoui";

// ─── helpers ─────────────────────────────────────────────────────────────────

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

// ─── shared primitives ────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
	background: "#0c0c0f",
	border: "1px solid #2a2a35",
	borderRadius: 6,
	padding: "9px 12px",
	color: "#c0c0d0",
	fontFamily: "JetBrains Mono, monospace",
	fontSize: 12,
	outline: "none",
	width: "100%",
};

function SectionDivider({ title }: { title: string }) {
	return (
		<div className="flex items-center gap-3">
			<span className="text-[15px] font-semibold shrink-0" style={{ color: "#f0f0f5" }}>
				{title}
			</span>
			<div className="flex-1" style={{ height: 1, background: "#1a1a1f" }} />
		</div>
	);
}

function MonoInput({
	value,
	onChange,
	placeholder,
	style,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	style?: React.CSSProperties;
}) {
	return (
		<input
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			style={{ ...inputStyle, ...style }}
		/>
	);
}

// ─── Worktree Setup ───────────────────────────────────────────────────────────

function LabelCol({ label, description }: { label: string; description?: string }) {
	return (
		<div className="flex flex-col gap-0.5 shrink-0" style={{ width: 160 }}>
			<span className="text-[13px] font-medium" style={{ color: "#c0c0d0" }}>
				{label}
			</span>
			{description && (
				<span className="text-[11px]" style={{ color: "#60607a" }}>
					{description}
				</span>
			)}
		</div>
	);
}

function FilesBox({
	workspaceId,
	filesToCopy,
	onChange,
}: {
	workspaceId: string;
	filesToCopy: string[];
	onChange: (files: string[]) => void;
}) {
	const [rootFiles, setRootFiles] = useState<string[] | null>(null);
	const [addInput, setAddInput] = useState("");
	const addInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		trpc.workspace.listRootFiles
			.query({ workspaceId })
			.then(({ files }) => setRootFiles(files))
			.catch(() => toast.error("Failed to list repo files"));
	}, [workspaceId]);

	const discoveredSet = new Set(rootFiles ?? []);
	const allFiles = [...new Set([...(rootFiles ?? []), ...filesToCopy])].sort();

	const toggle = (file: string, checked: boolean) => {
		onChange(checked ? [...new Set([...filesToCopy, file])] : filesToCopy.filter((f) => f !== file));
	};

	const addManual = () => {
		const val = addInput.trim();
		if (!val) return;
		onChange([...new Set([...filesToCopy, val])]);
		setAddInput("");
	};

	return (
		<div
			className="flex flex-col gap-1.5"
			style={{
				background: "#0c0c0f",
				border: "1px solid #2a2a35",
				borderRadius: 6,
				padding: "8px 12px",
				flex: 1,
			}}
		>
			{rootFiles === null && (
				<span className="text-[11px] py-1" style={{ color: "#4a4a5a" }}>
					Scanning...
				</span>
			)}

			{rootFiles !== null && allFiles.length === 0 && (
				<span className="text-[11px] py-1" style={{ color: "#4a4a5a" }}>
					No gitignored files found in repo root
				</span>
			)}

			{allFiles.map((file) => {
				const checked = filesToCopy.includes(file);
				const isManual = !discoveredSet.has(file);
				return (
					<label key={file} className="flex items-center gap-2 cursor-pointer group">
						<CustomCheckbox checked={checked} onChange={(v) => toggle(file, v)} />
						<span className="flex-1 text-[12px] font-mono" style={{ color: "#c0c0d0" }}>
							{file}
						</span>
						{isManual && (
							<button
								onClick={(e) => {
									e.preventDefault();
									onChange(filesToCopy.filter((f) => f !== file));
								}}
								className="opacity-0 group-hover:opacity-100 transition-opacity"
								style={{ color: "#60607a" }}
							>
								<X size={11} />
							</button>
						)}
					</label>
				);
			})}

			{/* Add file row */}
			<div className="flex items-center gap-2 pt-1">
				<div
					className="shrink-0 cursor-pointer"
					style={{
						width: 16,
						height: 16,
						border: "1px solid #2a2a35",
						borderRadius: 3,
					}}
					onClick={() => addInputRef.current?.focus()}
				/>
				<input
					ref={addInputRef}
					value={addInput}
					onChange={(e) => setAddInput(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && addManual()}
					placeholder="Add file path..."
					className="flex-1 bg-transparent text-[12px] font-mono focus:outline-none placeholder-[#60607a]"
					style={{ color: "#c0c0d0" }}
				/>
			</div>
		</div>
	);
}

function CustomCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
	return (
		<button
			type="button"
			onClick={() => onChange(!checked)}
			className="shrink-0 flex items-center justify-center transition-colors"
			style={{
				width: 16,
				height: 16,
				borderRadius: 3,
				background: checked ? "#7c6aff" : "transparent",
				border: checked ? "none" : "1px solid #2a2a35",
			}}
		>
			{checked && (
				<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
					<path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			)}
		</button>
	);
}

// ─── Secrets ──────────────────────────────────────────────────────────────────

function SecretRow({
	secret,
	isBuiltin,
	onUpdate,
	onRemove,
}: {
	secret: RuntimeProjectSecret;
	isBuiltin: boolean;
	onUpdate: (value: string) => void;
	onRemove: () => void;
}) {
	const [revealed, setRevealed] = useState(false);

	return (
		<div className="flex items-center gap-3">
			{/* Key */}
			<div
				className="shrink-0 flex items-center"
				style={{
					width: 200,
					background: "#0c0c0f",
					border: "1px solid #2a2a35",
					borderRadius: 6,
					padding: "9px 12px",
				}}
			>
				<span className="text-[12px] font-mono truncate" style={{ color: "#c0c0d0" }}>
					{secret.key}
				</span>
			</div>

			{/* Value */}
			<div
				className="flex-1 flex items-center gap-2"
				style={{
					background: "#0c0c0f",
					border: "1px solid #2a2a35",
					borderRadius: 6,
					padding: "9px 12px",
				}}
			>
				<input
					type={revealed ? "text" : "password"}
					value={secret.value}
					onChange={(e) => onUpdate(e.target.value)}
					placeholder="not set"
					className="flex-1 bg-transparent text-[12px] font-mono focus:outline-none min-w-0"
					style={{ color: revealed ? "#c0c0d0" : "#60607a" }}
				/>
				<button
					type="button"
					onClick={() => setRevealed((v) => !v)}
					style={{ color: "#60607a" }}
					className="shrink-0 hover:opacity-70 transition-opacity"
				>
					{revealed ? <EyeOff size={14} /> : <Eye size={14} />}
				</button>
			</div>

			{/* Badge or remove */}
			{isBuiltin ? (
				<div
					className="shrink-0"
					style={{
						background: "#3b82f615",
						borderRadius: 4,
						padding: "2px 7px",
					}}
				>
					<span className="text-[10px]" style={{ color: "#3b82f6" }}>
						default
					</span>
				</div>
			) : (
				<button
					onClick={onRemove}
					className="shrink-0 hover:opacity-70 transition-opacity"
					style={{ color: "#60607a" }}
				>
					<X size={14} />
				</button>
			)}
		</div>
	);
}

function NewSecretRow({ onAdd }: { onAdd: (key: string) => void }) {
	const [key, setKey] = useState("");
	const submit = () => {
		const k = key.trim();
		if (!k) return;
		onAdd(k);
		setKey("");
	};
	return (
		<div className="flex items-center gap-3">
			<input
				autoFocus
				value={key}
				onChange={(e) => setKey(e.target.value)}
				onKeyDown={(e) => e.key === "Enter" && submit()}
				placeholder="SECRET_KEY"
				style={{ ...inputStyle, width: 200, flexShrink: 0 }}
			/>
			<div
				className="flex-1"
				style={{
					background: "#0c0c0f",
					border: "1px solid #2a2a35",
					borderRadius: 6,
					padding: "9px 12px",
					color: "#4a4a5a",
					fontFamily: "JetBrains Mono, monospace",
					fontSize: 12,
				}}
			>
				value after save
			</div>
			<button onClick={submit} className="shrink-0 hover:opacity-70 transition-opacity" style={{ color: "#7c6aff" }}>
				<Plus size={14} />
			</button>
		</div>
	);
}

// ─── Root component ───────────────────────────────────────────────────────────

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

	const setup = config.worktreeSetup ?? { filesToCopy: [], installCommand: "" };

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
			<div className="flex flex-col gap-4">
				<SectionDivider title="Worktree Setup" />

				{/* Install Command */}
				<div className="flex items-center gap-4">
					<LabelCol label="Install Command" />
					<MonoInput
						value={setup.installCommand}
						onChange={(v) => onUpdate({ ...config, worktreeSetup: { ...setup, installCommand: v } })}
						placeholder="pnpm install --frozen-lockfile"
						style={{ flex: 1 }}
					/>
				</div>

				{/* Start Command */}
				<div className="flex items-center gap-4">
					<LabelCol label="Start Command" />
					<MonoInput
						value={config.startCommand ?? ""}
						onChange={(v) => onUpdate({ ...config, startCommand: v })}
						placeholder="pnpm dev"
						style={{ flex: 1 }}
					/>
				</div>

				{/* Files to Copy */}
				<div className="flex gap-4">
					<LabelCol label="Files to Copy" description="Copied into worktrees" />
					<FilesBox
						workspaceId={workspaceId}
						filesToCopy={setup.filesToCopy}
						onChange={(files) => onUpdate({ ...config, worktreeSetup: { ...setup, filesToCopy: files } })}
					/>
				</div>
			</div>

			{/* ── Secrets ── */}
			<div className="flex flex-col gap-4">
				{/* Secrets header */}
				<div className="flex items-center gap-2">
					<span className="text-[15px] font-semibold shrink-0" style={{ color: "#f0f0f5" }}>
						Secrets
					</span>
					<div className="flex-1" style={{ height: 1, background: "#1a1a1f" }} />

					{/* Paste .env */}
					<button
						onClick={() => setPasteOpen((v) => !v)}
						className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
						style={{
							border: "1px solid #2a2a35",
							borderRadius: 5,
							padding: "5px 10px",
							background: "transparent",
							color: "#8888a0",
						}}
					>
						<ClipboardPaste size={12} />
						<span className="text-[11px]">Paste .env</span>
					</button>

					{/* Add Secret */}
					<button
						onClick={() => setAddingSecret(true)}
						className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
						style={{
							border: "1px solid #7c6aff",
							borderRadius: 5,
							padding: "5px 10px",
							background: "transparent",
							color: "#7c6aff",
						}}
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
							className="font-mono text-[12px] focus:outline-none resize-none"
							style={{
								background: "#0c0c0f",
								border: "1px solid #2a2a35",
								borderRadius: 6,
								padding: "9px 12px",
								color: "#c0c0d0",
								width: "100%",
							}}
						/>
						<div className="flex justify-end gap-2">
							<button
								onClick={() => {
									setPasteOpen(false);
									setEnvText("");
								}}
								className="text-[12px] px-3 py-1.5 rounded-md hover:opacity-70 transition-opacity"
								style={{ color: "#8888a0", border: "1px solid #2a2a35" }}
							>
								Cancel
							</button>
							<button
								onClick={handlePasteApply}
								disabled={!envText.trim()}
								className="text-[12px] font-medium px-3 py-1.5 rounded-md transition-opacity disabled:opacity-40"
								style={{ background: "#7c6aff", color: "#ffffff" }}
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
					className="text-sm font-medium px-4 py-2 rounded-lg transition-opacity disabled:opacity-50"
					style={{ background: "#7c6aff", color: "#ffffff" }}
				>
					{saving ? "Saving..." : "Save"}
				</button>
			</div>
		</div>
	);
}
