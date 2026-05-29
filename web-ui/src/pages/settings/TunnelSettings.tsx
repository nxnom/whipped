import { RHFError, RHFInput, RHFInputGroup, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import { type CreateTunnelInput, createTunnelSchema } from "@runtime-validation/slack";
import {
	Check,
	CheckCircle2,
	ChevronRight,
	Copy,
	ExternalLink,
	Loader2,
	Play,
	RefreshCw,
	Square,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useRead, useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";

function Mono({ children }: { children: React.ReactNode }) {
	return <span className="font-mono text-[11px] text-[#a0a0c0]">{children}</span>;
}

// biome-ignore lint/correctness/noUnusedVariables: planned UI component
function CodeBlock({ children }: { children: string }) {
	return (
		<code className="block px-3 py-2 rounded font-mono text-[11px] bg-[#0c0c0f] border border-[#2a2a35] text-[#a0a0c0]">
			{children}
		</code>
	);
}

// biome-ignore lint/correctness/noUnusedVariables: planned UI component
function CopyBlock({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = async () => {
		await navigator.clipboard.writeText(value);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};
	return (
		<div className="flex items-center gap-2 px-3 py-2 rounded font-mono text-[11px] bg-[#0c0c0f] border border-[#2a2a35] text-[#a0a0c0]">
			<span className="flex-1 truncate">{value}</span>
			<button onClick={handleCopy} className="shrink-0 opacity-40 hover:opacity-80 transition-opacity text-[#c0c0d0]">
				{copied ? <Check size={12} /> : <Copy size={12} />}
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

type TunnelStatus = "stopped" | "starting" | "running" | "error";

const STATUS_STYLES: Record<TunnelStatus, { dot: string; text: string; label: string }> = {
	stopped: { dot: "#60607a", text: "#60607a", label: "Tunnel stopped" },
	starting: { dot: "#facc15", text: "#facc15", label: "Tunnel starting…" },
	running: { dot: "#4ade80", text: "#4ade80", label: "Tunnel running" },
	error: { dot: "#ef4444", text: "#ef4444", label: "Tunnel error" },
};

function TunnelControl() {
	const { data: state, trigger: refreshStatus } = useRead((api) => api("slack/tunnelStatus").GET());

	const startTunnel = useWrite((api) => api("slack/startTunnel").POST());
	const stopTunnel = useWrite((api) => api("slack/stopTunnel").POST());

	// Poll the tunnel status every 3s (preserves the original setInterval cadence).
	useEffect(() => {
		const id = setInterval(() => {
			void refreshStatus();
		}, 3000);
		return () => clearInterval(id);
	}, [refreshStatus]);

	// startTunnel/stopTunnel return the new status; refetch to pick it up.
	const handleStart = async () => {
		const res = await startTunnel.trigger({});
		if (res.data) await refreshStatus();
	};
	const handleStop = async () => {
		const res = await stopTunnel.trigger({});
		if (res.data) await refreshStatus();
	};

	const status = (state?.status ?? "stopped") as TunnelStatus;
	const style = STATUS_STYLES[status];
	const isRunning = status === "running" || status === "starting";
	const acting = startTunnel.loading || stopTunnel.loading;

	return (
		<div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#0c0c0f] border border-[#2a2a35]">
			<div className="flex items-center gap-2 flex-1 min-w-0">
				{status === "starting" ? (
					<Loader2 size={8} className="animate-spin shrink-0" style={{ color: style.dot }} />
				) : (
					<div className="shrink-0 w-2 h-2 rounded-full" style={{ background: style.dot }} />
				)}
				<span className="text-[13px]" style={{ color: style.text }}>
					{style.label}
				</span>
				{state?.error && <span className="text-[11px] font-mono truncate text-[#60607a]">— {state.error}</span>}
			</div>
			<button
				onClick={isRunning ? handleStop : handleStart}
				disabled={acting}
				className={classNames(
					"flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium transition-opacity disabled:opacity-50 hover:opacity-80 shrink-0",
					isRunning
						? "bg-[#2a1a1a] border border-[#4a1a1a] text-[#f87171]"
						: "bg-[#1a2a1a] border border-[#1a4a1a] text-[#4ade80]",
				)}
			>
				{isRunning ? <Square size={11} /> : <Play size={11} />}
				{isRunning ? "Stop" : "Start"}
			</button>
		</div>
	);
}

export function TunnelSettings() {
	const [showSetup, setShowSetup] = useState(false);
	const [loginUrl, setLoginUrl] = useState<string | null>(null);
	const [waitingForAuth, setWaitingForAuth] = useState(false);

	const { data: config, trigger: refetchConfig } = useRead((api) => api("config").GET());
	const { data: tunnelConfig, trigger: refetchTunnelConfig } = useRead((api) => api("slack/tunnelConfig").GET());

	// cloudflared install/auth status. Fetched on demand (Check installation /
	// login flow), so the read is lazy + manually triggered.
	const {
		data: cloudflaredStatus,
		fetching: checkingInstall,
		trigger: checkCloudflared,
	} = useRead((api) => api("slack/checkCloudflared").GET(), { enabled: false });

	const saveConfig = useWrite((api) => api("config").PUT());
	const cloudflaredLogin = useWrite((api) => api("slack/cloudflaredLogin").POST());
	const createTunnel = useWrite((api) => api("slack/createTunnel").POST());
	const resetTunnel = useWrite((api) => api("slack/resetTunnel").POST());

	const methods = useForm({
		resolver: zodResolver(createTunnelSchema),
		values: { domain: tunnelConfig?.domain ?? "" } satisfies CreateTunnelInput,
	});

	const isConfigured = !!(tunnelConfig?.tunnelId && tunnelConfig?.domain);

	// While waiting for browser auth, poll cloudflared status every 2s until it
	// reports authenticated (preserves the original interval behavior).
	useEffect(() => {
		if (!waitingForAuth) return;
		const id = setInterval(() => {
			void checkCloudflared();
		}, 2000);
		return () => clearInterval(id);
	}, [waitingForAuth, checkCloudflared]);

	// Stop polling for auth once cloudflared reports authenticated.
	useEffect(() => {
		if (waitingForAuth && cloudflaredStatus?.authed) {
			setWaitingForAuth(false);
			setLoginUrl(null);
			toast.success("Authenticated with Cloudflare");
		}
	}, [waitingForAuth, cloudflaredStatus?.authed]);

	const handleLogin = async (force = false) => {
		setLoginUrl(null);
		const res = await cloudflaredLogin.trigger({ body: { force } });
		if (res.error) {
			toast.error("Failed to start login");
			return;
		}
		const result = res.data;
		if (result.alreadyLoggedIn) {
			toast.success("Already authenticated with Cloudflare");
			checkCloudflared();
		} else if (result.loginUrl) {
			setLoginUrl(result.loginUrl);
			setWaitingForAuth(true);
		} else {
			toast.error("Could not get login URL — run 'cloudflared tunnel login' in your terminal");
		}
	};

	const handleCreateTunnel = methods.handleSubmit(async (values) => {
		const res = await createTunnel.trigger({ body: { domain: values.domain.trim() } });
		if (res.error) {
			toast.error(res.error.message ?? "Failed to create tunnel");
			return;
		}
		await refetchTunnelConfig();
		toast.success("Tunnel created and config file written");
	});

	const handleReset = async () => {
		const res = await resetTunnel.trigger({});
		if (res.error) {
			toast.error("Failed to reset");
			return;
		}
		await Promise.all([refetchConfig(), refetchTunnelConfig()]);
		methods.reset({ domain: "" });
		setShowSetup(false);
		toast.success("Tunnel config cleared");
	};

	const toggle = async () => {
		if (!config) return;
		const res = await saveConfig.trigger({ body: { ...config, autoStartTunnel: !config.autoStartTunnel } });
		if (res.error) {
			toast.error("Failed to save");
			return;
		}
		await refetchConfig();
	};

	if (!config) {
		return (
			<div className="flex-1 flex flex-col">
				<div className="shrink-0 flex flex-col gap-1 px-10 py-6 border-b border-[#2a2a35]">
					<h1 className="text-xl font-semibold text-[#f0f0f5]">Tunnel</h1>
				</div>
				<div className="flex items-center justify-center py-20 text-sm text-[#60607a]">Loading...</div>
			</div>
		);
	}

	const step1Done = cloudflaredStatus?.installed === true;
	const step2Done = cloudflaredStatus?.authed === true;
	const step3Done = !!(tunnelConfig?.tunnelId && tunnelConfig?.domain);

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<div className="shrink-0 flex flex-col gap-1 px-10 py-6 border-b border-[#2a2a35]">
				<h1 className="text-xl font-semibold text-[#f0f0f5]">Tunnel</h1>
				<p className="text-[13px] text-[#60607a]">
					Expose your local server publicly via Cloudflare Tunnel for incoming webhooks
				</p>
			</div>
			<div className="flex-1 overflow-y-auto px-10 py-6">
				<div className="flex flex-col gap-6">
					{/* Status banner */}
					{isConfigured && (
						<div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#0f1f0f] border border-[#2a4a2a]">
							<CheckCircle2 size={16} className="text-[#4ade80]" />
							<div className="flex-1 flex flex-col gap-0.5">
								<span className="text-[13px] text-[#4ade80]">Tunnel configured</span>
								<span className="text-[11px] font-mono text-[#2a6a2a]">{tunnelConfig?.domain}</span>
							</div>
						</div>
					)}

					{/* Tunnel control */}
					<div className="flex flex-col gap-4">
						<div className="flex items-center gap-3">
							<span className="text-[15px] font-semibold text-[#f0f0f5]">Cloudflare Tunnel</span>
							<div className="flex-1 h-px bg-[#1a1a1f]" />
						</div>
						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-0.5">
								<span className="text-[13px] font-medium text-[#c0c0d0]">Auto-start tunnel</span>
								<span className="text-[11px] text-[#60607a]">Start automatically when the server starts</span>
							</div>
							<button
								role="switch"
								aria-checked={config.autoStartTunnel}
								onClick={toggle}
								disabled={saveConfig.loading}
								className={classNames(
									"relative shrink-0 transition-colors disabled:opacity-50 w-9 h-5 rounded-[10px]",
									config.autoStartTunnel ? "bg-[#7c6aff]" : "bg-[#2a2a35]",
								)}
							>
								<span
									className={classNames(
										"absolute top-[3px] left-[3px] w-3.5 h-3.5 rounded-full bg-white transition-transform",
										config.autoStartTunnel ? "translate-x-4" : "translate-x-0",
									)}
								/>
							</button>
						</div>
						<TunnelControl />
					</div>

					{/* Setup wizard */}
					<FormProvider {...methods}>
						<form onSubmit={handleCreateTunnel} className="flex flex-col gap-0">
							<div className="flex items-center gap-3">
								<span className="text-[15px] font-semibold text-[#f0f0f5]">Setup</span>
								<div className="flex-1 h-px bg-[#1a1a1f]" />
								{isConfigured && (
									<button
										type="button"
										onClick={() => setShowSetup((v) => !v)}
										className="text-[11px] transition-opacity hover:opacity-80 shrink-0 text-[#4a4a5a]"
									>
										{showSetup ? "Collapse" : "Reconfigure"}
									</button>
								)}
							</div>

							{(!isConfigured || showSetup) && (
								<div className="mt-5">
									{isConfigured && showSetup && (
										<div className="flex items-center gap-3 mb-5 pb-5 border-b border-[#1a1a1f]">
											<button
												type="submit"
												disabled={createTunnel.loading}
												className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40 bg-[#1a1a2e] border border-[#3a3aff60] text-[#7c6aff]"
											>
												{createTunnel.loading ? (
													<Loader2 size={13} className="animate-spin" />
												) : (
													<RefreshCw size={13} />
												)}
												Recreate Tunnel
											</button>
											<button
												type="button"
												onClick={handleReset}
												disabled={resetTunnel.loading}
												className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40 bg-[#1a1a1a] border border-[#4a1a1a] text-[#f87171]"
											>
												{resetTunnel.loading ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
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
											className="self-start flex items-center gap-1.5 text-[12px] hover:opacity-80 transition-opacity text-[#7c6aff]"
										>
											<ExternalLink size={12} />
											Download cloudflared from Cloudflare
										</a>
										<div className="flex items-center gap-2">
											<button
												type="button"
												onClick={() => checkCloudflared()}
												disabled={checkingInstall}
												className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium transition-opacity hover:opacity-80 disabled:opacity-50 bg-[#1a1a2e] border border-[#3a3aff40] text-[#7c6aff]"
											>
												{checkingInstall ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
												Check installation
											</button>
											{cloudflaredStatus && (
												<span
													className={classNames(
														"flex items-center gap-1 text-[12px]",
														cloudflaredStatus.installed ? "text-[#4ade80]" : "text-[#ef4444]",
													)}
												>
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
												<Check size={13} className="text-[#4ade80]" />
												<span className="text-[#4ade80]">
													Already authenticated — <Mono>~/.cloudflared/cert.pem</Mono> found
												</span>
												<button
													type="button"
													onClick={() => handleLogin(true)}
													disabled={cloudflaredLogin.loading}
													className="ml-2 text-[11px] opacity-40 hover:opacity-70 transition-opacity disabled:opacity-20 text-[#7c6aff]"
												>
													{cloudflaredLogin.loading ? "Opening…" : "Re-authenticate"}
												</button>
											</div>
										) : (
											<>
												<p className="text-[12px] text-[#60607a]">
													Opens a browser window to log in to your Cloudflare account. Only needed once.
												</p>
												<button
													type="button"
													onClick={() => handleLogin(false)}
													disabled={cloudflaredLogin.loading || !step1Done}
													className="self-start flex items-center gap-2 px-3 py-1.5 rounded text-[12px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40 bg-[#1a1a2e] border border-[#3a3aff40] text-[#7c6aff]"
												>
													{cloudflaredLogin.loading ? (
														<Loader2 size={12} className="animate-spin" />
													) : (
														<ExternalLink size={12} />
													)}
													{cloudflaredLogin.loading ? "Waiting for login URL…" : "Login to Cloudflare"}
												</button>
												{loginUrl && (
													<div className="flex flex-col gap-1.5">
														{waitingForAuth && (
															<div className="flex items-center gap-2 text-[12px] text-[#facc15]">
																<Loader2 size={12} className="animate-spin" />
																Waiting for authentication in browser…
															</div>
														)}
														<p className="text-[11px] text-[#60607a]">If the browser didn't open, click below:</p>
														<a
															href={loginUrl}
															target="_blank"
															rel="noreferrer"
															className="flex items-center gap-1.5 text-[11px] font-mono hover:opacity-80 transition-opacity truncate text-[#7c6aff]"
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
												<div className="flex items-center gap-2 text-[12px] text-[#4ade80]">
													<Check size={13} />
													Tunnel ID: <Mono>{tunnelConfig?.tunnelId}</Mono>
												</div>
												<div className="text-[12px] text-[#60607a]">
													Config written to <Mono>~/.cloudflared/config.yml</Mono>
												</div>
											</div>
										) : (
											<>
												<p className="text-[12px] text-[#60607a]">
													Enter your public domain, then click Create — we'll run{" "}
													<Mono>cloudflared tunnel create whipped</Mono> and write{" "}
													<Mono>~/.cloudflared/config.yml</Mono> automatically.
												</p>
												<RHFInputGroup
													label="Your public domain"
													labelClassName="text-[11px] font-medium text-[#8888a0]"
													className="flex flex-col gap-1.5"
												>
													<RHFInput
														name="domain"
														placeholder="e.g. slack.yourdomain.com"
														inputClassName="font-mono text-[12px] focus:outline-none focus:border-[#7c6aff] px-3 py-2 bg-[#0c0c0f] border border-[#2a2a35] rounded-md text-[#c0c0d0]"
													/>
												</RHFInputGroup>
												<RHFError name="domain" className="text-[11px] text-[#ef4444]" />
												<button
													type="submit"
													disabled={createTunnel.loading || !step2Done}
													className="self-start flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40 bg-[#7c6aff] text-white"
												>
													{createTunnel.loading ? (
														<Loader2 size={14} className="animate-spin" />
													) : (
														<ChevronRight size={14} />
													)}
													{createTunnel.loading ? "Creating…" : "Create Tunnel"}
												</button>
											</>
										)}
									</StepRow>

									{/* Step 4: DNS */}
									<StepRow n={4} title="DNS record" done={step3Done} active={step3Done}>
										{step3Done && (
											<div className="flex flex-col gap-1.5">
												<div className="flex items-center gap-2 text-[12px] text-[#4ade80]">
													<Check size={13} />
													Auto-created via <Mono>cloudflared tunnel route dns</Mono>
												</div>
												<p className="text-[11px] text-[#4a4a5a]">
													CNAME <Mono>{tunnelConfig?.domain}</Mono> →{" "}
													<Mono>{tunnelConfig?.tunnelId}.cfargotunnel.com</Mono>
												</p>
											</div>
										)}
									</StepRow>

									{/* Step 5: Auto-start */}
									<StepRow n={5} title="Enable auto-start" done={config.autoStartTunnel} active={step3Done}>
										<p className="text-[12px] text-[#60607a]">
											Toggle <span className="text-[#c0c0d0] font-medium">Auto-start tunnel</span> above — the tunnel
											starts automatically on every server start. No separate terminal needed.
										</p>
									</StepRow>
								</div>
							)}
						</form>
					</FormProvider>
				</div>
			</div>
		</div>
	);
}
