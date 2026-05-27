import { toast } from "@geckoui/geckoui";
import type { RuntimeGlobalConfig } from "@runtime-contract";
import { Check, CheckCircle2, ChevronRight, Copy, ExternalLink, Loader2, Play, RefreshCw, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/runtime/trpc-client";

function Mono({ children }: { children: React.ReactNode }) {
	return <span className="font-mono text-[11px]" style={{ color: "#a0a0c0" }}>{children}</span>;
}

function CodeBlock({ children }: { children: string }) {
	return (
		<code className="block px-3 py-2 rounded font-mono text-[11px]" style={{ background: "#0c0c0f", border: "1px solid #2a2a35", color: "#a0a0c0" }}>
			{children}
		</code>
	);
}

function CopyBlock({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = async () => {
		await navigator.clipboard.writeText(value);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};
	return (
		<div className="flex items-center gap-2 px-3 py-2 rounded font-mono text-[11px]" style={{ background: "#0c0c0f", border: "1px solid #2a2a35", color: "#a0a0c0" }}>
			<span className="flex-1 truncate">{value}</span>
			<button onClick={handleCopy} className="shrink-0 opacity-40 hover:opacity-80 transition-opacity" style={{ color: "#c0c0d0" }}>
				{copied ? <Check size={12} /> : <Copy size={12} />}
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

type TunnelStatus = "stopped" | "starting" | "running" | "error";

const STATUS_STYLES: Record<TunnelStatus, { dot: string; text: string; label: string }> = {
	stopped:  { dot: "#60607a", text: "#60607a", label: "Tunnel stopped" },
	starting: { dot: "#facc15", text: "#facc15", label: "Tunnel starting…" },
	running:  { dot: "#4ade80", text: "#4ade80", label: "Tunnel running" },
	error:    { dot: "#ef4444", text: "#ef4444", label: "Tunnel error" },
};

function TunnelControl() {
	const [state, setState] = useState<{ status: TunnelStatus; error?: string } | null>(null);
	const [acting, setActing] = useState(false);

	const refetch = () => { trpc.slack.tunnelStatus.query().then(setState).catch(() => {}); };

	useEffect(() => {
		refetch();
		const id = setInterval(refetch, 3000);
		return () => clearInterval(id);
	}, []);

	const handleStart = async () => {
		setActing(true);
		try { setState(await trpc.slack.startTunnel.mutate()); } finally { setActing(false); }
	};
	const handleStop = async () => {
		setActing(true);
		try { setState(await trpc.slack.stopTunnel.mutate()); } finally { setActing(false); }
	};

	const status = (state?.status ?? "stopped") as TunnelStatus;
	const style = STATUS_STYLES[status];
	const isRunning = status === "running" || status === "starting";

	return (
		<div className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ background: "#0c0c0f", border: "1px solid #2a2a35" }}>
			<div className="flex items-center gap-2 flex-1 min-w-0">
				{status === "starting"
					? <Loader2 size={8} className="animate-spin shrink-0" style={{ color: style.dot }} />
					: <div className="shrink-0" style={{ width: 8, height: 8, borderRadius: "50%", background: style.dot }} />
				}
				<span className="text-[13px]" style={{ color: style.text }}>{style.label}</span>
				{state?.error && <span className="text-[11px] font-mono truncate" style={{ color: "#60607a" }}>— {state.error}</span>}
			</div>
			<button
				onClick={isRunning ? handleStop : handleStart}
				disabled={acting}
				className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium transition-opacity disabled:opacity-50 hover:opacity-80 shrink-0"
				style={{ background: isRunning ? "#2a1a1a" : "#1a2a1a", border: `1px solid ${isRunning ? "#4a1a1a" : "#1a4a1a"}`, color: isRunning ? "#f87171" : "#4ade80" }}
			>
				{isRunning ? <Square size={11} /> : <Play size={11} />}
				{isRunning ? "Stop" : "Start"}
			</button>
		</div>
	);
}

export function TunnelSettings() {
	const [config, setConfig] = useState<RuntimeGlobalConfig | null>(null);
	const [saving, setSaving] = useState(false);
	const [showSetup, setShowSetup] = useState(false);

	// Setup wizard state
	const [cloudflaredStatus, setCloudflaredStatus] = useState<{ installed: boolean; version?: string; authed?: boolean } | null>(null);
	const [checkingInstall, setCheckingInstall] = useState(false);
	const [loggingIn, setLoggingIn] = useState(false);
	const [loginUrl, setLoginUrl] = useState<string | null>(null);
	const [waitingForAuth, setWaitingForAuth] = useState(false);
	const [domain, setDomain] = useState("");
	const [creatingTunnel, setCreatingTunnel] = useState(false);
	const [tunnelConfig, setTunnelConfig] = useState<{ tunnelId?: string; domain?: string; tunnelName: string } | null>(null);
	const [resetting, setResetting] = useState(false);

	useEffect(() => {
		trpc.config.get.query().then(setConfig).catch(() => {});
		trpc.slack.tunnelConfig.query().then(setTunnelConfig).catch(() => {});
	}, []);

	useEffect(() => {
		if (tunnelConfig?.domain) setDomain(tunnelConfig.domain);
	}, [tunnelConfig]);

	const isConfigured = !!(tunnelConfig?.tunnelId && tunnelConfig?.domain);

	useEffect(() => {
		if (!waitingForAuth) return;
		const id = setInterval(async () => {
			const result = await trpc.slack.checkCloudflared.query().catch(() => null);
			if (result?.authed) {
				setCloudflaredStatus(result);
				setWaitingForAuth(false);
				setLoginUrl(null);
				toast.success("Authenticated with Cloudflare");
			}
		}, 2000);
		return () => clearInterval(id);
	}, [waitingForAuth]);

	const checkInstall = async () => {
		setCheckingInstall(true);
		try {
			const result = await trpc.slack.checkCloudflared.query();
			setCloudflaredStatus(result);
		} finally {
			setCheckingInstall(false);
		}
	};

	const handleLogin = async (force = false) => {
		setLoggingIn(true);
		setLoginUrl(null);
		try {
			const result = await trpc.slack.cloudflaredLogin.mutate({ force });
			if (result.alreadyLoggedIn) {
				toast.success("Already authenticated with Cloudflare");
				setCloudflaredStatus((prev) => prev ? { ...prev, authed: true } : { installed: true, authed: true });
			} else if (result.loginUrl) {
				setLoginUrl(result.loginUrl);
				setCloudflaredStatus((prev) => prev ? { ...prev, authed: false } : null);
				setWaitingForAuth(true);
			} else {
				toast.error("Could not get login URL — run 'cloudflared tunnel login' in your terminal");
			}
		} catch {
			toast.error("Failed to start login");
		} finally {
			setLoggingIn(false);
		}
	};

	const handleCreateTunnel = async () => {
		if (!domain.trim()) return;
		setCreatingTunnel(true);
		try {
			await trpc.slack.createTunnel.mutate({ domain: domain.trim() });
			const updated = await trpc.slack.tunnelConfig.query();
			setTunnelConfig(updated);
			toast.success("Tunnel created and config file written");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to create tunnel");
		} finally {
			setCreatingTunnel(false);
		}
	};

	const handleReset = async () => {
		setResetting(true);
		try {
			await trpc.slack.resetTunnel.mutate();
			const updated = await trpc.config.get.query();
			setConfig(updated);
			setTunnelConfig(null);
			setDomain("");
			setCloudflaredStatus(null);
			setShowSetup(false);
			toast.success("Tunnel config cleared");
		} catch {
			toast.error("Failed to reset");
		} finally {
			setResetting(false);
		}
	};

	const toggle = async () => {
		if (!config) return;
		setSaving(true);
		try {
			const next = { ...config, autoStartTunnel: !config.autoStartTunnel };
			const updated = await trpc.config.save.mutate(next);
			setConfig(updated);
		} catch {
			toast.error("Failed to save");
		} finally {
			setSaving(false);
		}
	};

	if (!config) {
		return (
			<div className="flex-1 flex flex-col">
				<div className="shrink-0 flex flex-col gap-1 px-10 py-6" style={{ borderBottom: "1px solid #2a2a35" }}>
					<h1 className="text-xl font-semibold" style={{ color: "#f0f0f5" }}>Tunnel</h1>
				</div>
				<div className="flex items-center justify-center py-20 text-sm" style={{ color: "#60607a" }}>Loading...</div>
			</div>
		);
	}

	const step1Done = cloudflaredStatus?.installed === true;
	const step2Done = cloudflaredStatus?.authed === true;
	const step3Done = !!(tunnelConfig?.tunnelId && tunnelConfig?.domain);

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<div className="shrink-0 flex flex-col gap-1 px-10 py-6" style={{ borderBottom: "1px solid #2a2a35" }}>
				<h1 className="text-xl font-semibold" style={{ color: "#f0f0f5" }}>Tunnel</h1>
				<p className="text-[13px]" style={{ color: "#60607a" }}>
					Expose your local server publicly via Cloudflare Tunnel for incoming webhooks
				</p>
			</div>
			<div className="flex-1 overflow-y-auto px-10 py-6">
				<div className="flex flex-col gap-6">

					{/* Status banner */}
					{isConfigured && (
						<div className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ background: "#0f1f0f", border: "1px solid #2a4a2a" }}>
							<CheckCircle2 size={16} style={{ color: "#4ade80" }} />
							<div className="flex-1 flex flex-col gap-0.5">
								<span className="text-[13px]" style={{ color: "#4ade80" }}>Tunnel configured</span>
								<span className="text-[11px] font-mono" style={{ color: "#2a6a2a" }}>{tunnelConfig?.domain}</span>
							</div>
						</div>
					)}

					{/* Tunnel control */}
					<div className="flex flex-col gap-4">
						<div className="flex items-center gap-3">
							<span className="text-[15px] font-semibold" style={{ color: "#f0f0f5" }}>Cloudflare Tunnel</span>
							<div className="flex-1" style={{ height: 1, background: "#1a1a1f" }} />
						</div>
						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-0.5">
								<span className="text-[13px] font-medium" style={{ color: "#c0c0d0" }}>Auto-start tunnel</span>
								<span className="text-[11px]" style={{ color: "#60607a" }}>Start automatically when the server starts</span>
							</div>
							<button
								role="switch"
								aria-checked={config.autoStartTunnel}
								onClick={toggle}
								disabled={saving}
								className="relative shrink-0 transition-colors disabled:opacity-50"
								style={{ width: 36, height: 20, borderRadius: 10, background: config.autoStartTunnel ? "#7c6aff" : "#2a2a35" }}
							>
								<span className="absolute top-[3px] transition-transform" style={{ width: 14, height: 14, borderRadius: "50%", background: "#ffffff", left: 3, transform: config.autoStartTunnel ? "translateX(16px)" : "translateX(0)" }} />
							</button>
						</div>
						<TunnelControl />
					</div>

					{/* Setup wizard */}
					<div className="flex flex-col gap-0">
						<div className="flex items-center gap-3">
							<span className="text-[15px] font-semibold" style={{ color: "#f0f0f5" }}>Setup</span>
							<div className="flex-1" style={{ height: 1, background: "#1a1a1f" }} />
							{isConfigured && (
								<button onClick={() => setShowSetup((v) => !v)} className="text-[11px] transition-opacity hover:opacity-80 shrink-0" style={{ color: "#4a4a5a" }}>
									{showSetup ? "Collapse" : "Reconfigure"}
								</button>
							)}
						</div>

						{(!isConfigured || showSetup) && (
							<div className="mt-5">
								{isConfigured && showSetup && (
									<div className="flex items-center gap-3 mb-5 pb-5" style={{ borderBottom: "1px solid #1a1a1f" }}>
										<button
											onClick={handleCreateTunnel}
											disabled={!domain.trim() || creatingTunnel}
											className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
											style={{ background: "#1a1a2e", border: "1px solid #3a3aff60", color: "#7c6aff" }}
										>
											{creatingTunnel ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
											Recreate Tunnel
										</button>
										<button
											onClick={handleReset}
											disabled={resetting}
											className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
											style={{ background: "#1a1a1a", border: "1px solid #4a1a1a", color: "#f87171" }}
										>
											{resetting ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
											Reset & Start Over
										</button>
									</div>
								)}

								{/* Step 1: Install */}
								<StepRow n={1} title="Install cloudflared" done={step1Done} active={!step1Done}>
									<a
										href="https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/"
										target="_blank"
										rel="noreferrer"
										className="self-start flex items-center gap-1.5 text-[12px] hover:opacity-80 transition-opacity"
										style={{ color: "#7c6aff" }}
									>
										<ExternalLink size={12} />
										Download cloudflared from Cloudflare
									</a>
									<div className="flex items-center gap-2">
										<button
											onClick={checkInstall}
											disabled={checkingInstall}
											className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
											style={{ background: "#1a1a2e", border: "1px solid #3a3aff40", color: "#7c6aff" }}
										>
											{checkingInstall ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
											Check installation
										</button>
										{cloudflaredStatus && (
											<span className="flex items-center gap-1 text-[12px]" style={{ color: cloudflaredStatus.installed ? "#4ade80" : "#ef4444" }}>
												{cloudflaredStatus.installed ? <Check size={12} /> : <X size={12} />}
												{cloudflaredStatus.installed ? `Installed — ${cloudflaredStatus.version}` : "Not found"}
											</span>
										)}
									</div>
								</StepRow>

								{/* Step 2: Login */}
								<StepRow n={2} title="Authenticate with Cloudflare" done={step2Done} active={step1Done}>
									{step2Done ? (
										<div className="flex items-center gap-2 text-[12px]">
											<Check size={13} style={{ color: "#4ade80" }} />
											<span style={{ color: "#4ade80" }}>Already authenticated — <Mono>~/.cloudflared/cert.pem</Mono> found</span>
											<button
												onClick={() => handleLogin(true)}
												disabled={loggingIn}
												className="ml-2 text-[11px] opacity-40 hover:opacity-70 transition-opacity disabled:opacity-20"
												style={{ color: "#7c6aff" }}
											>
												{loggingIn ? "Opening…" : "Re-authenticate"}
											</button>
										</div>
									) : (
										<>
											<p className="text-[12px]" style={{ color: "#60607a" }}>
												Opens a browser window to log in to your Cloudflare account. Only needed once.
											</p>
											<button
												onClick={() => handleLogin(false)}
												disabled={loggingIn || !step1Done}
												className="self-start flex items-center gap-2 px-3 py-1.5 rounded text-[12px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
												style={{ background: "#1a1a2e", border: "1px solid #3a3aff40", color: "#7c6aff" }}
											>
												{loggingIn ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
												{loggingIn ? "Waiting for login URL…" : "Login to Cloudflare"}
											</button>
											{loginUrl && (
												<div className="flex flex-col gap-1.5">
													{waitingForAuth && (
														<div className="flex items-center gap-2 text-[12px]" style={{ color: "#facc15" }}>
															<Loader2 size={12} className="animate-spin" />
															Waiting for authentication in browser…
														</div>
													)}
													<p className="text-[11px]" style={{ color: "#60607a" }}>If the browser didn't open, click below:</p>
													<a
														href={loginUrl}
														target="_blank"
														rel="noreferrer"
														className="flex items-center gap-1.5 text-[11px] font-mono hover:opacity-80 transition-opacity truncate"
														style={{ color: "#7c6aff" }}
													>
														<ExternalLink size={10} />
														{loginUrl}
													</a>
												</div>
											)}
										</>
									)}
								</StepRow>

								{/* Step 3: Create tunnel */}
								<StepRow n={3} title="Create tunnel & config file" done={step3Done} active={step2Done}>
									{step3Done ? (
										<div className="flex flex-col gap-2">
											<div className="flex items-center gap-2 text-[12px]" style={{ color: "#4ade80" }}>
												<Check size={13} />
												Tunnel ID: <Mono>{tunnelConfig?.tunnelId}</Mono>
											</div>
											<div className="text-[12px]" style={{ color: "#60607a" }}>
												Config written to <Mono>~/.cloudflared/config.yml</Mono>
											</div>
										</div>
									) : (
										<>
											<p className="text-[12px]" style={{ color: "#60607a" }}>
												Enter your public domain, then click Create — we'll run <Mono>cloudflared tunnel create overemployed</Mono> and write <Mono>~/.cloudflared/config.yml</Mono> automatically.
											</p>
											<div className="flex flex-col gap-1.5">
												<label className="text-[11px] font-medium" style={{ color: "#8888a0" }}>Your public domain</label>
												<input
													value={domain}
													onChange={(e) => setDomain(e.target.value)}
													placeholder="e.g. slack.yourdomain.com"
													className="font-mono text-[12px] focus:outline-none focus:border-[#7c6aff]"
													style={{ padding: "8px 12px", background: "#0c0c0f", border: "1px solid #2a2a35", borderRadius: 6, color: "#c0c0d0" }}
												/>
											</div>
											<button
												onClick={handleCreateTunnel}
												disabled={!domain.trim() || creatingTunnel || !step2Done}
												className="self-start flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
												style={{ background: "#7c6aff", color: "#ffffff" }}
											>
												{creatingTunnel ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
												{creatingTunnel ? "Creating…" : "Create Tunnel"}
											</button>
										</>
									)}
								</StepRow>

								{/* Step 4: DNS */}
								<StepRow n={4} title="DNS record" done={step3Done} active={step3Done}>
									{step3Done && (
										<div className="flex flex-col gap-1.5">
											<div className="flex items-center gap-2 text-[12px]" style={{ color: "#4ade80" }}>
												<Check size={13} />
												Auto-created via <Mono>cloudflared tunnel route dns</Mono>
											</div>
											<p className="text-[11px]" style={{ color: "#4a4a5a" }}>
												CNAME <Mono>{tunnelConfig?.domain}</Mono> → <Mono>{tunnelConfig?.tunnelId}.cfargotunnel.com</Mono>
											</p>
										</div>
									)}
								</StepRow>

								{/* Step 5: Auto-start */}
								<StepRow n={5} title="Enable auto-start" done={config.autoStartTunnel} active={step3Done}>
									<p className="text-[12px]" style={{ color: "#60607a" }}>
										Toggle <span style={{ color: "#c0c0d0", fontWeight: 500 }}>Auto-start tunnel</span> above — the tunnel starts automatically on every server start. No separate terminal needed.
									</p>
								</StepRow>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
