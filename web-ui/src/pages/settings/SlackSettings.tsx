import { toast } from "@geckoui/geckoui";
import type { RuntimeGlobalConfig } from "@runtime-contract";
import { AlertCircle, Check, CheckCircle2, ChevronRight, ExternalLink, Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/runtime/trpc-client";

function SectionDivider({ title }: { title: string }) {
	return (
		<div className="flex items-center gap-3">
			<span className="text-[15px] font-semibold" style={{ color: "#f0f0f5" }}>{title}</span>
			<div className="flex-1" style={{ height: 1, background: "#1a1a1f" }} />
		</div>
	);
}

function SecretInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
	const [visible, setVisible] = useState(false);
	return (
		<div className="relative">
			<input
				type={visible ? "text" : "password"}
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				className="w-full font-mono text-[12px] focus:outline-none focus:border-[#7c6aff]"
				style={{ padding: "9px 36px 9px 12px", background: "#0c0c0f", border: "1px solid #2a2a35", borderRadius: 6, color: "#c0c0d0" }}
			/>
			<button type="button" onClick={() => setVisible((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-80 transition-opacity" style={{ color: "#c0c0d0" }}>
				{visible ? <EyeOff size={14} /> : <Eye size={14} />}
			</button>
		</div>
	);
}

function StepBadge({ n, done, active }: { n: number; done: boolean; active: boolean }) {
	return (
		<div
			className="shrink-0 flex items-center justify-center text-[11px] font-bold"
			style={{
				width: 24, height: 24, borderRadius: "50%",
				background: done ? "#1a3a1a" : active ? "#1a1a2e" : "#1a1a1f",
				border: `1px solid ${done ? "#2a6a2a" : active ? "#3a3aff60" : "#2a2a35"}`,
				color: done ? "#4ade80" : active ? "#7c6aff" : "#4a4a5a",
			}}
		>
			{done ? <Check size={12} /> : n}
		</div>
	);
}

function StepRow({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children?: React.ReactNode }) {
	return (
		<div className="flex gap-4">
			<div className="flex flex-col items-center gap-1">
				<StepBadge n={n} done={done} active={active} />
				{children && <div className="flex-1 w-px" style={{ background: "#2a2a35", minHeight: 8 }} />}
			</div>
			<div className="flex flex-col gap-3 flex-1 pb-6">
				<p className="text-[13px] font-medium leading-none pt-0.5" style={{ color: active || done ? "#f0f0f5" : "#4a4a5a" }}>{title}</p>
				{children}
			</div>
		</div>
	);
}

function Mono({ children }: { children: React.ReactNode }) {
	return <span className="font-mono text-[11px]" style={{ color: "#a0a0c0" }}>{children}</span>;
}

export function SlackSettings() {
	const [config, setConfig] = useState<RuntimeGlobalConfig | null>(null);
	const [appConfigToken, setAppConfigToken] = useState("");
	const [publicUrl, setPublicUrl] = useState("");

	const [creating, setCreating] = useState(false);
	const [resetting, setResetting] = useState(false);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [showHowItWorks, setShowHowItWorks] = useState(false);
	const [showSetup, setShowSetup] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);

	useEffect(() => {
		trpc.config.get.query().then((c) => {
			setConfig(c);
			if (c.slackAppConfigToken) setAppConfigToken(c.slackAppConfigToken);
			if (c.slackPublicUrl) setPublicUrl(c.slackPublicUrl);
		}).catch(() => {});
	}, []);

	const handleCreateApp = async () => {
		if (!appConfigToken.trim() || !publicUrl.trim()) return;
		setCreating(true);
		setCreateError(null);
		try {
			await trpc.slack.createApp.mutate({ appConfigToken: appConfigToken.trim(), publicUrl: publicUrl.trim() });
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
			const updated = await trpc.config.get.query();
			setConfig(updated);
			setAppConfigToken("");
			setPublicUrl("");
			setShowSetup(true);
			toast.success("Slack configuration cleared");
		} catch {
			toast.error("Failed to reset");
		} finally {
			setResetting(false);
		}
	};

	const handleInstall = () => {
		if (!config?.slackOauthAuthorizeUrl) return;
		window.open(config.slackOauthAuthorizeUrl, "_blank");
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

	if (!config) {
		return (
			<div className="flex-1 flex flex-col">
				<div className="shrink-0 flex flex-col gap-1 px-10 py-6" style={{ borderBottom: "1px solid #2a2a35" }}>
					<h1 className="text-xl font-semibold" style={{ color: "#f0f0f5" }}>Slack</h1>
				</div>
				<div className="flex items-center justify-center py-20 text-sm" style={{ color: "#60607a" }}>Loading...</div>
			</div>
		);
	}

	const appCreated = !!(config.slackClientId && config.slackSigningSecret);
	const botTokenSaved = !!config.slackBotToken;
	const fullyConfigured = appCreated && botTokenSaved;

	const step1Done = !!(appConfigToken && publicUrl);
	const step2Done = appCreated;
	const step3Done = botTokenSaved;

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<div className="shrink-0 flex flex-col gap-1 px-10 py-6" style={{ borderBottom: "1px solid #2a2a35" }}>
				<h1 className="text-xl font-semibold" style={{ color: "#f0f0f5" }}>Slack</h1>
				<p className="text-[13px]" style={{ color: "#60607a" }}>
					One channel per project, one message per ticket. Replies sync both ways.
				</p>
			</div>
			<div className="flex-1 overflow-y-auto px-10 py-6">
				<div className="flex flex-col gap-6">

					{/* Status banner */}
					{fullyConfigured && (
						<div className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ background: "#0f1f0f", border: "1px solid #2a4a2a" }}>
							<CheckCircle2 size={16} style={{ color: "#4ade80" }} />
							<span className="text-[13px]" style={{ color: "#4ade80" }}>Connected — Slack app is fully configured</span>
						</div>
					)}

					{/* Setup wizard */}
					<div className="flex flex-col gap-0">
						<div className="flex items-center gap-3">
							<span className="text-[15px] font-semibold" style={{ color: "#f0f0f5" }}>Setup</span>
							<div className="flex-1" style={{ height: 1, background: "#1a1a1f" }} />
							{fullyConfigured && (
								<button
									onClick={() => setShowSetup((v) => !v)}
									className="text-[11px] transition-opacity hover:opacity-80 shrink-0"
									style={{ color: "#4a4a5a" }}
								>
									{showSetup ? "Collapse" : "Reconfigure"}
								</button>
							)}
						</div>
						{fullyConfigured && !showSetup ? null : <div className="mt-5">
						{fullyConfigured && showSetup && (
							<div className="flex items-center gap-3 mb-5 pb-5" style={{ borderBottom: "1px solid #1a1a1f" }}>
								<button
									onClick={handleInstall}
									className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-80"
									style={{ background: "#1a1a2e", border: "1px solid #3a3aff60", color: "#7c6aff" }}
								>
									<ExternalLink size={13} />
									Reinstall to Workspace
								</button>
								<button
									onClick={handleReset}
									disabled={resetting}
									className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
									style={{ background: "#2a1a1a", border: "1px solid #4a1a1a", color: "#f87171" }}
								>
									{resetting ? <Loader2 size={13} className="animate-spin" /> : null}
									Reset & Start Over
								</button>
							</div>
						)}

							{/* Step 1: Config token + public URL */}
							<StepRow n={1} title="Get an App Configuration Token" done={step1Done} active={!step1Done}>
								<p className="text-[12px]" style={{ color: "#60607a" }}>
									Go to{" "}
									<a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "#7c6aff" }}>
										api.slack.com/apps <ExternalLink size={10} />
									</a>
									{" "}— scroll to the bottom of the page to find the <strong style={{ color: "#c0c0d0" }}>Your App Configuration Tokens</strong> section → click <strong style={{ color: "#c0c0d0" }}>Generate Token</strong> → select your workspace → copy the token.
								</p>
								<p className="text-[11px]" style={{ color: "#4a4a5a" }}>
									Note: this token expires after 12 hours, but you only need it once to create the app.
								</p>
								<div className="flex flex-col gap-2">
									<label className="text-[11px] font-medium" style={{ color: "#8888a0" }}>App Configuration Token</label>
									<SecretInput value={appConfigToken} placeholder="xoxe-..." onChange={setAppConfigToken} />
								</div>
								<div className="flex flex-col gap-2">
									<label className="text-[11px] font-medium" style={{ color: "#8888a0" }}>Public URL (your Cloudflare Tunnel domain)</label>
									<input
										value={publicUrl}
										onChange={(e) => setPublicUrl(e.target.value)}
										placeholder="https://slack.yourdomain.com"
										className="font-mono text-[12px] focus:outline-none focus:border-[#7c6aff]"
										style={{ padding: "9px 12px", background: "#0c0c0f", border: "1px solid #2a2a35", borderRadius: 6, color: "#c0c0d0" }}
									/>
									<p className="text-[11px]" style={{ color: "#4a4a5a" }}>
										Make sure your Cloudflare Tunnel is running (Settings → Tunnel) before creating the app.
									</p>
								</div>
							</StepRow>

							{/* Step 2: Create app */}
							<StepRow n={2} title="Create the Slack app" done={step2Done} active={step1Done && !step2Done}>
								{appCreated ? (
									<div className="flex items-center gap-2 text-[12px]" style={{ color: "#4ade80" }}>
										<Check size={13} />
										App created — ID: <Mono>{config.slackAppId}</Mono>
									</div>
								) : (
									<>
										<p className="text-[12px]" style={{ color: "#60607a" }}>
											We'll call the Slack API to create and configure the app automatically using your token and public URL.
										</p>
										{createError && (
											<div className="flex items-center gap-2 text-[12px]" style={{ color: "#ef4444" }}>
												<AlertCircle size={13} />
												{createError}
											</div>
										)}
										<button
											onClick={handleCreateApp}
											disabled={!step1Done || creating}
											className="self-start flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity disabled:opacity-40 hover:opacity-80"
											style={{ background: "#7c6aff", color: "#ffffff" }}
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
									<div className="flex items-center gap-2 text-[12px]" style={{ color: "#4ade80" }}>
										<Check size={13} />
										Bot token saved — workspace installation complete
									</div>
								) : (
									<>
										<p className="text-[12px]" style={{ color: "#60607a" }}>
											Click the button to open Slack's install page. After you click Allow, the bot token is captured automatically and saved here.
										</p>
										<p className="text-[12px]" style={{ color: "#60607a" }}>
											Make sure your Tailscale funnel is running before clicking — Slack needs to reach the callback URL.
										</p>
										<button
											onClick={handleInstall}
											disabled={!step2Done}
											className="self-start flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity disabled:opacity-40 hover:opacity-80"
											style={{ background: "#1a1a2e", border: "1px solid #3a3aff60", color: "#7c6aff" }}
										>
											<ExternalLink size={14} />
											Install to Workspace
										</button>
										{step2Done && (
											<p className="text-[11px]" style={{ color: "#4a4a5a" }}>
												After installing, this page will update automatically within a few seconds.
											</p>
										)}
									</>
								)}
							</StepRow>
						</div>}
					</div>

					{/* How it works */}
					<div className="flex flex-col gap-3">
						<button
							onClick={() => setShowHowItWorks((v) => !v)}
							className="self-start flex items-center gap-1.5 text-[11px] transition-opacity hover:opacity-80"
							style={{ color: "#4a4a5a" }}
						>
							<ChevronRight size={12} style={{ transform: showHowItWorks ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
							How it works
						</button>
						{showHowItWorks && (
							<div className="rounded-lg overflow-hidden text-[12px]" style={{ border: "1px solid #2a2a35" }}>
								{[
									["Ticket created", `New message in #oe-{project-name}`],
									["Agent adds activity", "Thread reply on the ticket message"],
									["Ticket changes status", "Thread reply: Status → In Progress / Done / Blocked"],
									["PR opened or merged", "Thread reply with PR link"],
									["You reply in thread", "Comment added to the ticket"],
									["You send /reopen in thread", "Ticket moved to Reopened column"],
								].map(([event, result], i, arr) => (
									<div
										key={event}
										className="flex items-center gap-4 px-4 py-3"
										style={{ background: i % 2 === 0 ? "#0c0c0f" : "#0f0f12", borderBottom: i < arr.length - 1 ? "1px solid #1a1a1f" : undefined }}
									>
										<span className="font-medium shrink-0" style={{ color: "#c0c0d0", width: 220 }}>{event}</span>
										<span style={{ color: "#60607a" }}>{result}</span>
									</div>
								))}
							</div>
						)}
					</div>

					{/* Manual token override */}
					{fullyConfigured && (
						<div className="flex flex-col gap-3">
							<button
								onClick={() => setShowAdvanced((v) => !v)}
								className="self-start flex items-center gap-1.5 text-[11px] transition-opacity hover:opacity-80"
								style={{ color: "#4a4a5a" }}
							>
								<ChevronRight size={12} style={{ transform: showAdvanced ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
								Advanced
							</button>
							{showAdvanced && (
								<div className="flex flex-col gap-3 pl-4" style={{ borderLeft: "1px solid #2a2a35" }}>
									<p className="text-[12px]" style={{ color: "#60607a" }}>Replace the bot token manually if needed.</p>
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
											className="px-4 py-2 rounded-lg text-[13px] font-medium shrink-0"
											style={{ background: "#7c6aff", color: "#ffffff" }}
										>
											Save
										</button>
									</div>
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
