import { toast } from "@geckoui/geckoui";
import type { RuntimeGlobalConfig } from "@runtime-contract";
import { AlertCircle, Check, CheckCircle2, ChevronRight, ExternalLink, Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { trpc } from "@/runtime/trpc-client";
import { classNames } from "@/utils/classNames";

function SecretInput({
	value,
	placeholder,
	onChange,
}: {
	value: string;
	placeholder: string;
	onChange: (v: string) => void;
}) {
	const [visible, setVisible] = useState(false);
	return (
		<div className="relative">
			<input
				type={visible ? "text" : "password"}
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				className="w-full font-mono text-[12px] focus:outline-none focus:border-[#7c6aff] pl-3 pr-9 py-[9px] bg-[#0c0c0f] border border-[#2a2a35] rounded-md text-[#c0c0d0]"
			/>
			<button
				type="button"
				onClick={() => setVisible((v) => !v)}
				className="absolute right-2 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-80 transition-opacity text-[#c0c0d0]"
			>
				{visible ? <EyeOff size={14} /> : <Eye size={14} />}
			</button>
		</div>
	);
}

function StepBadge({ n, done, active }: { n: number; done: boolean; active: boolean }) {
	return (
		<div
			className={classNames(
				"shrink-0 flex items-center justify-center text-[11px] font-bold w-6 h-6 rounded-full border",
				done
					? "bg-[#1a3a1a] border-[#2a6a2a] text-[#4ade80]"
					: active
						? "bg-[#1a1a2e] border-[#3a3aff60] text-[#7c6aff]"
						: "bg-[#1a1a1f] border-[#2a2a35] text-[#4a4a5a]",
			)}
		>
			{done ? <Check size={12} /> : n}
		</div>
	);
}

function StepRow({
	n,
	title,
	done,
	active,
	children,
}: {
	n: number;
	title: string;
	done: boolean;
	active: boolean;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex gap-4">
			<div className="flex flex-col items-center gap-1">
				<StepBadge n={n} done={done} active={active} />
				{children && <div className="flex-1 w-px bg-[#2a2a35] min-h-2" />}
			</div>
			<div className="flex flex-col gap-3 flex-1 pb-6">
				<p
					className={classNames(
						"text-[13px] font-medium leading-none pt-0.5",
						active || done ? "text-[#f0f0f5]" : "text-[#4a4a5a]",
					)}
				>
					{title}
				</p>
				{children}
			</div>
		</div>
	);
}

function Mono({ children }: { children: React.ReactNode }) {
	return <span className="font-mono text-[11px] text-[#a0a0c0]">{children}</span>;
}

function AdvancedCredentials({
	config,
	setConfig,
	handleSaveToken,
}: {
	config: RuntimeGlobalConfig;
	setConfig: (c: RuntimeGlobalConfig) => void;
	handleSaveToken: () => void;
}) {
	const [signingSecret, setSigningSecret] = useState("");
	const [saving, setSaving] = useState(false);

	const handleSaveSigningSecret = async () => {
		if (!signingSecret.trim()) return;
		setSaving(true);
		try {
			await trpc.slack.updateSigningSecret.mutate({ signingSecret: signingSecret.trim() });
			setSigningSecret("");
			toast.success("Signing secret updated");
		} catch {
			toast.error("Failed to update signing secret");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="flex flex-col gap-4 pl-4 border-l border-[#2a2a35]">
			<div className="flex flex-col gap-2">
				<p className="text-[12px] text-[#60607a]">Replace the bot token manually if needed.</p>
				<div className="flex gap-3 items-center">
					<div className="flex-1">
						<SecretInput
							value={config.slackBotToken ?? ""}
							placeholder="xoxb-..."
							onChange={(v) => setConfig({ ...config, slackBotToken: v || undefined })}
						/>
					</div>
					<button
						onClick={handleSaveToken}
						className="px-4 py-2 rounded-lg text-[13px] font-medium shrink-0 bg-[#7c6aff] text-white"
					>
						Save
					</button>
				</div>
			</div>
			<div className="flex flex-col gap-2">
				<p className="text-[12px] text-[#60607a]">
					Update signing secret if webhooks return signature mismatch. Find it at{" "}
					<a
						href={`https://api.slack.com/apps/${config.slackAppId ?? ""}/general`}
						target="_blank"
						rel="noreferrer"
						className="underline text-[#7c6aff]"
					>
						api.slack.com/apps → App Credentials → Signing Secret
					</a>
					.
				</p>
				<div className="flex gap-3 items-center">
					<div className="flex-1">
						<SecretInput value={signingSecret} placeholder="Paste new signing secret..." onChange={setSigningSecret} />
					</div>
					<button
						onClick={handleSaveSigningSecret}
						disabled={!signingSecret.trim() || saving}
						className="px-4 py-2 rounded-lg text-[13px] font-medium shrink-0 disabled:opacity-40 bg-[#7c6aff] text-white"
					>
						{saving ? "Saving…" : "Save"}
					</button>
				</div>
			</div>
		</div>
	);
}

export function SlackSettings() {
	const navigate = useNavigate();
	const { workspaceId } = useParams<{ workspaceId: string }>();
	const [config, setConfig] = useState<RuntimeGlobalConfig | null>(null);
	const [appConfigToken, setAppConfigToken] = useState("");
	const [publicUrl, setPublicUrl] = useState("");
	const [botName, setBotName] = useState("Overemployed");

	const [creating, setCreating] = useState(false);
	const [resetting, setResetting] = useState(false);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [showSetup, setShowSetup] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [waitingForInstall, setWaitingForInstall] = useState(false);

	useEffect(() => {
		Promise.all([trpc.config.get.query(), trpc.slack.tunnelConfig.query()])
			.then(([c, tunnel]) => {
				setConfig(c);
				if (c.slackAppConfigToken) setAppConfigToken(c.slackAppConfigToken);
				if (c.slackBotName) setBotName(c.slackBotName);
				const url = tunnel.domain ? `https://${tunnel.domain}` : (c.slackPublicUrl ?? "");
				setPublicUrl(url);
			})
			.catch(() => {});
	}, []);

	const handleCreateApp = async () => {
		if (!appConfigToken.trim() || !publicUrl.trim()) return;
		setCreating(true);
		setCreateError(null);
		try {
			await trpc.slack.createApp.mutate({
				appConfigToken: appConfigToken.trim(),
				publicUrl: publicUrl.trim(),
				botName: botName.trim() || "Overemployed",
			});
			const updated = await trpc.config.get.query();
			setConfig(updated);
			toast.success("Slack app created — now install it to your workspace");
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Failed to create app";
			setCreateError(msg);
			toast.error(msg);
		} finally {
			setCreating(false);
		}
	};

	const handleReset = async () => {
		setResetting(true);
		try {
			await trpc.slack.resetApp.mutate();
			const [updated, tunnel] = await Promise.all([trpc.config.get.query(), trpc.slack.tunnelConfig.query()]);
			setConfig(updated);
			setAppConfigToken("");
			setBotName("");
			setPublicUrl(tunnel.domain ? `https://${tunnel.domain}` : "");
			setShowSetup(true);
			toast.success("Slack configuration cleared");
		} catch {
			toast.error("Failed to reset");
		} finally {
			setResetting(false);
		}
	};

	useEffect(() => {
		if (!waitingForInstall) return;
		const id = setInterval(async () => {
			const updated = await trpc.config.get.query().catch(() => null);
			if (updated?.slackBotToken) {
				setConfig(updated);
				setWaitingForInstall(false);
				toast.success("Workspace installation complete");
			}
		}, 2000);
		return () => clearInterval(id);
	}, [waitingForInstall]);

	const handleInstall = () => {
		if (!config?.slackOauthAuthorizeUrl) return;
		window.open(config.slackOauthAuthorizeUrl, "_blank");
		setWaitingForInstall(true);
	};

	const handleSaveToken = async () => {
		if (!config) return;
		try {
			const updated = await trpc.config.save.mutate({ ...config, slackBotToken: config.slackBotToken });
			setConfig(updated);
			toast.success("Saved");
		} catch {
			toast.error("Failed to save");
		}
	};

	const handleToggleEnabled = async () => {
		if (!config) return;
		const next = { ...config, slackEnabled: !config.slackEnabled };
		try {
			const updated = await trpc.config.save.mutate(next);
			setConfig(updated);
		} catch {
			toast.error("Failed to save");
		}
	};

	if (!config) {
		return (
			<div className="flex-1 flex flex-col">
				<div className="shrink-0 flex flex-col gap-1 px-10 py-6 border-b border-[#2a2a35]">
					<h1 className="text-xl font-semibold text-[#f0f0f5]">Slack</h1>
				</div>
				<div className="flex items-center justify-center py-20 text-sm text-[#60607a]">Loading...</div>
			</div>
		);
	}

	const appCreated = !!(config.slackClientId && config.slackSigningSecret);
	const botTokenSaved = !!config.slackBotToken;
	const fullyConfigured = appCreated && botTokenSaved;

	const step1Done = !!(appConfigToken.trim() && publicUrl);
	const step2Done = appCreated;
	const step3Done = botTokenSaved;

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<div className="shrink-0 flex flex-col gap-1 px-10 py-6 border-b border-[#2a2a35]">
				<h1 className="text-xl font-semibold text-[#f0f0f5]">Slack</h1>
				<p className="text-[13px] text-[#60607a]">
					One channel per project, one message per ticket. Replies sync both ways.
				</p>
			</div>
			<div className="flex-1 overflow-y-auto px-10 py-6">
				<div className="flex flex-col gap-6">
					{/* Status banner */}
					{fullyConfigured && (
						<div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#0f1f0f] border border-[#2a4a2a]">
							<CheckCircle2 size={16} className="text-[#4ade80]" />
							<span className="text-[13px] text-[#4ade80]">Connected — Slack app is fully configured</span>
						</div>
					)}

					{/* Slack integration section */}
					<div className="flex flex-col gap-4">
						<div className="flex items-center gap-3">
							<span className="text-[15px] font-semibold text-[#f0f0f5]">Slack</span>
							<div className="flex-1 h-px bg-[#1a1a1f]" />
						</div>
						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-0.5">
								<span className="text-[13px] font-medium text-[#c0c0d0]">Enable Slack integration</span>
								<span className="text-[11px] text-[#60607a]">
									{config.slackEnabled
										? "Active — notifications and replies are syncing."
										: "Paused — no messages will be sent or received."}
								</span>
							</div>
							<button
								role="switch"
								aria-checked={config.slackEnabled}
								onClick={handleToggleEnabled}
								className={classNames(
									"relative shrink-0 transition-colors w-9 h-5 rounded-[10px]",
									config.slackEnabled ? "bg-[#7c6aff]" : "bg-[#2a2a35]",
								)}
							>
								<span
									className={classNames(
										"absolute top-[3px] left-[3px] w-3.5 h-3.5 rounded-full bg-white transition-transform",
										config.slackEnabled ? "translate-x-4" : "translate-x-0",
									)}
								/>
							</button>
						</div>
					</div>

					{/* Setup wizard */}
					<div className="flex flex-col gap-0">
						<div className="flex items-center gap-3">
							<span className="text-[15px] font-semibold text-[#f0f0f5]">Setup</span>
							<div className="flex-1 h-px bg-[#1a1a1f]" />
							{fullyConfigured && (
								<button
									onClick={() => setShowSetup((v) => !v)}
									className="text-[11px] transition-opacity hover:opacity-80 shrink-0 text-[#4a4a5a]"
								>
									{showSetup ? "Collapse" : "Reconfigure"}
								</button>
							)}
						</div>
						{fullyConfigured && !showSetup ? null : (
							<div className="mt-5">
								{fullyConfigured && showSetup && (
									<div className="flex items-center gap-3 mb-5 pb-5 border-b border-[#1a1a1f]">
										<button
											onClick={handleInstall}
											className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-80 bg-[#1a1a2e] border border-[#3a3aff60] text-[#7c6aff]"
										>
											<ExternalLink size={13} />
											Reinstall to Workspace
										</button>
										<button
											onClick={handleReset}
											disabled={resetting}
											className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-80 disabled:opacity-50 bg-[#2a1a1a] border border-[#4a1a1a] text-[#f87171]"
										>
											{resetting ? <Loader2 size={13} className="animate-spin" /> : null}
											Reset & Start Over
										</button>
									</div>
								)}

								{/* Step 1: Config token + public URL */}
								<StepRow n={1} title="Get an App Configuration Token" done={step1Done} active={!step1Done}>
									<p className="text-[12px] text-[#60607a]">
										Go to{" "}
										<a
											href="https://api.slack.com/apps"
											target="_blank"
											rel="noreferrer"
											className="inline-flex items-center gap-0.5 hover:opacity-80 text-[#7c6aff]"
										>
											api.slack.com/apps <ExternalLink size={10} />
										</a>{" "}
										— scroll to the bottom of the page to find the{" "}
										<strong className="text-[#c0c0d0]">Your App Configuration Tokens</strong> section → click{" "}
										<strong className="text-[#c0c0d0]">Generate Token</strong> → select your workspace → copy the token.
									</p>
									<p className="text-[11px] text-[#4a4a5a]">
										Note: this token expires after 12 hours, but you only need it once to create the app.
									</p>
									<div className="flex flex-col gap-2">
										<label className="text-[11px] font-medium text-[#8888a0]">Bot name</label>
										<input
											value={botName}
											onChange={(e) => setBotName(e.target.value)}
											placeholder="Overemployed"
											className="font-mono text-[12px] focus:outline-none focus:border-[#7c6aff] px-3 py-[9px] bg-[#0c0c0f] border border-[#2a2a35] rounded-md text-[#c0c0d0]"
										/>
										<p className="text-[11px] text-[#4a4a5a]">
											Shown in Slack as the bot's display name — use something like "OE Office" or "OE Home" to identify
											the device.
										</p>
									</div>
									<div className="flex flex-col gap-2">
										<label className="text-[11px] font-medium text-[#8888a0]">App Configuration Token</label>
										<SecretInput value={appConfigToken} placeholder="xoxe-..." onChange={setAppConfigToken} />
									</div>
									<div className="flex flex-col gap-2">
										<label className="text-[11px] font-medium text-[#8888a0]">
											Public URL (Cloudflare Tunnel domain)
										</label>
										{publicUrl ? (
											<div className="flex items-center gap-2 px-3 py-2 rounded font-mono text-[12px] bg-[#0c0c0f] border border-[#2a2a35] text-[#4ade80]">
												<Check size={12} />
												{publicUrl}
											</div>
										) : (
											<div className="flex items-center gap-2 px-3 py-2 rounded text-[12px] bg-[#0c0c0f] border border-[#4a2a1a] text-[#f87171]">
												No tunnel domain configured —{" "}
												<button
													onClick={() => navigate(`/${workspaceId}/settings/tunnel`)}
													className="underline hover:opacity-80 transition-opacity text-[#facc15]"
												>
													set up Tunnel first
												</button>
											</div>
										)}
									</div>
								</StepRow>

								{/* Step 2: Create app */}
								<StepRow n={2} title="Create the Slack app" done={step2Done} active={step1Done && !step2Done}>
									{appCreated ? (
										<div className="flex items-center gap-2 text-[12px] text-[#4ade80]">
											<Check size={13} />
											App created — <Mono>{config.slackBotName ?? "Overemployed"}</Mono> ({config.slackAppId})
										</div>
									) : (
										<>
											<p className="text-[12px] text-[#60607a]">
												We'll call the Slack API to create and configure the app automatically using your token and
												public URL.
											</p>
											{createError && (
												<div className="flex items-center gap-2 text-[12px] text-[#ef4444]">
													<AlertCircle size={13} />
													{createError}
												</div>
											)}
											<button
												onClick={handleCreateApp}
												disabled={!step1Done || creating}
												className="self-start flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity disabled:opacity-40 hover:opacity-80 bg-[#7c6aff] text-white"
											>
												{creating ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
												{creating ? "Creating…" : "Create Slack App"}
											</button>
										</>
									)}
								</StepRow>

								{/* Step 3: Install to workspace */}
								<StepRow n={3} title="Install to your workspace" done={step3Done} active={step2Done && !step3Done}>
									{botTokenSaved ? (
										<div className="flex items-center gap-2 text-[12px] text-[#4ade80]">
											<Check size={13} />
											Bot token saved — workspace installation complete
										</div>
									) : (
										<>
											<p className="text-[12px] text-[#60607a]">
												Click the button to open Slack's install page. After you click Allow, the bot token is captured
												automatically and saved here.
											</p>
											<p className="text-[12px] text-[#60607a]">
												Make sure your Cloudflare Tunnel is running (Settings → Tunnel) before clicking — Slack needs to
												reach the callback URL.
											</p>
											<button
												onClick={handleInstall}
												disabled={!step2Done}
												className="self-start flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity disabled:opacity-40 hover:opacity-80 bg-[#1a1a2e] border border-[#3a3aff60] text-[#7c6aff]"
											>
												<ExternalLink size={14} />
												Install to Workspace
											</button>
											{waitingForInstall && (
												<div className="flex items-center gap-2 text-[12px] text-[#facc15]">
													<Loader2 size={12} className="animate-spin" />
													Waiting for Slack to redirect back…
												</div>
											)}
										</>
									)}
								</StepRow>
							</div>
						)}
					</div>

					{/* Manual token override */}
					{fullyConfigured && (
						<div className="flex flex-col gap-3">
							<button
								onClick={() => setShowAdvanced((v) => !v)}
								className="self-start flex items-center gap-1.5 text-[11px] transition-opacity hover:opacity-80 text-[#4a4a5a]"
							>
								<ChevronRight
									size={12}
									className={classNames("transition-transform duration-150", showAdvanced ? "rotate-90" : "rotate-0")}
								/>
								Advanced
							</button>
							{showAdvanced && (
								<AdvancedCredentials config={config} setConfig={setConfig} handleSaveToken={handleSaveToken} />
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
