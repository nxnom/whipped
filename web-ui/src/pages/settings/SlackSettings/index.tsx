import { RHFError, RHFInput, RHFInputGroup, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import { type CreateAppInput, createAppSchema } from "@runtime-validation/slack";
import { AlertCircle, Check, CheckCircle2, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { useRead, useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";
import { AdvancedCredentials } from "./AdvancedCredentials";
import { RHFSecretInput } from "./SecretToggle";
import { Mono, StepRow } from "./StepRow";

export function SlackSettings() {
	const navigate = useNavigate();
	const { workspaceId } = useParams<{ workspaceId: string }>();

	const [showAdvanced, setShowAdvanced] = useState(false);
	const [showSetup, setShowSetup] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [pendingInstall, setPendingInstall] = useState(false);

	const { data: config, trigger: refetchConfig } = useRead((api) => api("config").GET());
	const { data: tunnel } = useRead((api) => api("tunnel/tunnelConfig").GET());

	const saveConfig = useWrite((api) => api("config").PUT());
	const createApp = useWrite((api) => api("slack/createApp").POST());
	const resetApp = useWrite((api) => api("slack/resetApp").POST());

	// Initial form values come straight from the loaded config + tunnel domain
	// (RHF `values` keeps them in sync — no useEffect needed).
	const publicUrl = tunnel?.domain ? `https://${tunnel.domain}` : (config?.slackPublicUrl ?? "");
	const methods = useForm({
		resolver: zodResolver(createAppSchema),
		values: {
			appConfigToken: config?.slackAppConfigToken ?? "",
			publicUrl,
			botName: config?.slackBotName ?? "Whipped",
		} satisfies CreateAppInput,
	});

	// The user launched the OAuth flow and the bot token hasn't landed yet. Derived
	// so it flips back to false on its own once the polled config carries the token.
	const waitingForInstall = pendingInstall && !config?.slackBotToken;

	// While waiting for the OAuth install to complete, poll config every 2s so the
	// captured bot token shows up automatically (preserves the original interval).
	useEffect(() => {
		if (!waitingForInstall) return;
		const id = setInterval(() => {
			void refetchConfig();
		}, 2000);
		return () => clearInterval(id);
		// refetchConfig (a Spoosh trigger) is intentionally not a dep — its identity
		// changes each render; the captured trigger polls the same endpoint fine.
	}, [waitingForInstall]);

	// Clear the intent flag and notify once the polled config carries a bot token
	// (the toast is a real side-effect, so it stays in an effect).
	useEffect(() => {
		if (pendingInstall && config?.slackBotToken) {
			setPendingInstall(false);
			toast.success("Workspace installation complete");
		}
	}, [pendingInstall, config?.slackBotToken]);

	const handleCreateApp = methods.handleSubmit(async (values) => {
		setCreateError(null);
		const res = await createApp.trigger({
			body: {
				appConfigToken: values.appConfigToken.trim(),
				publicUrl: values.publicUrl.trim(),
				botName: values.botName.trim() || "Whipped",
			},
			// Slack app writes live under slack/* but mutate the global config, so
			// invalidate both segments to refresh the config read.
			invalidate: ["config", "config/*", "slack", "slack/*"],
		});
		if (res.error) {
			const msg = res.error.message ?? "Failed to create app";
			setCreateError(msg);
			toast.error(msg);
			return;
		}
		toast.success("Slack app created — now install it to your workspace");
	});

	const handleReset = async () => {
		const res = await resetApp.trigger({ invalidate: ["config", "config/*", "slack", "slack/*"] });
		if (res.error) {
			toast.error("Failed to reset");
			return;
		}
		methods.reset({ appConfigToken: "", botName: "", publicUrl: tunnel?.domain ? `https://${tunnel.domain}` : "" });
		setShowSetup(true);
		toast.success("Slack configuration cleared");
	};

	const handleInstall = () => {
		if (!config?.slackOauthAuthorizeUrl) return;
		window.open(config.slackOauthAuthorizeUrl, "_blank");
		setPendingInstall(true);
	};

	const handleSaveToken = async (botToken: string) => {
		if (!config) return;
		const res = await saveConfig.trigger({ body: { ...config, slackBotToken: botToken || undefined } });
		if (res.error) {
			toast.error("Failed to save");
			return;
		}
		toast.success("Saved");
	};

	const handleToggleEnabled = async () => {
		if (!config) return;
		const res = await saveConfig.trigger({ body: { ...config, slackEnabled: !config.slackEnabled } });
		if (res.error) {
			toast.error("Failed to save");
			return;
		}
	};

	if (!config) {
		return (
			<div className="flex-1 flex flex-col">
				<div className="shrink-0 flex flex-col gap-1 px-10 py-6 border-b border-[#2a2a2a]">
					<h1 className="text-xl font-semibold text-[#ededed]">Slack</h1>
				</div>
				<div className="flex items-center justify-center py-20 text-sm text-[#5f6672]">Loading...</div>
			</div>
		);
	}

	const appCreated = !!(config.slackClientId && config.slackSigningSecret);
	const botTokenSaved = !!config.slackBotToken;
	const fullyConfigured = appCreated && botTokenSaved;

	const appConfigToken = methods.watch("appConfigToken");
	const step1Done = !!(appConfigToken.trim() && publicUrl);
	const step2Done = appCreated;
	const step3Done = botTokenSaved;

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<div className="shrink-0 flex flex-col gap-1 px-10 py-6 border-b border-[#2a2a2a]">
				<h1 className="text-xl font-semibold text-[#ededed]">Slack</h1>
				<p className="text-[13px] text-[#5f6672]">
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
							<span className="text-[15px] font-semibold text-[#ededed]">Slack</span>
							<div className="flex-1 h-px bg-[#111111]" />
						</div>
						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-0.5">
								<span className="text-[13px] font-medium text-[#ededed]">Enable Slack integration</span>
								<span className="text-[11px] text-[#5f6672]">
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
									config.slackEnabled ? "bg-[#ffffff]" : "bg-[#2a2a2a]",
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
					<FormProvider {...methods}>
						<form onSubmit={handleCreateApp} className="flex flex-col gap-0">
							<div className="flex items-center gap-3">
								<span className="text-[15px] font-semibold text-[#ededed]">Setup</span>
								<div className="flex-1 h-px bg-[#111111]" />
								{fullyConfigured && (
									<button
										type="button"
										onClick={() => setShowSetup((v) => !v)}
										className="text-[11px] transition-opacity hover:opacity-80 shrink-0 text-[#5f6672]"
									>
										{showSetup ? "Collapse" : "Reconfigure"}
									</button>
								)}
							</div>
							{fullyConfigured && !showSetup ? null : (
								<div className="mt-5">
									{fullyConfigured && showSetup && (
										<div className="flex items-center gap-3 mb-5 pb-5 border-b border-[#111111]">
											<button
												type="button"
												onClick={handleInstall}
												className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-80 bg-[#1a1a2e] border border-[#3a3aff60] text-[#ffffff]"
											>
												<ExternalLink size={13} />
												Reinstall to Workspace
											</button>
											<button
												type="button"
												onClick={handleReset}
												disabled={resetApp.loading}
												className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-80 disabled:opacity-50 bg-[#2a1a1a] border border-[#4a1a1a] text-[#f87171]"
											>
												{resetApp.loading ? <Loader2 size={13} className="animate-spin" /> : null}
												Reset & Start Over
											</button>
										</div>
									)}

									{/* Step 1: Config token + public URL */}
									<StepRow n={1} title="Get an App Configuration Token" done={step1Done} active={!step1Done}>
										<p className="text-[12px] text-[#5f6672]">
											Go to{" "}
											<a
												href="https://api.slack.com/apps"
												target="_blank"
												rel="noreferrer"
												className="inline-flex items-center gap-0.5 hover:opacity-80 text-[#ffffff]"
											>
												api.slack.com/apps <ExternalLink size={10} />
											</a>{" "}
											— scroll to the bottom of the page to find the{" "}
											<strong className="text-[#ededed]">Your App Configuration Tokens</strong> section → click{" "}
											<strong className="text-[#ededed]">Generate Token</strong> → select your workspace → copy the
											token.
										</p>
										<p className="text-[11px] text-[#5f6672]">
											Note: this token expires after 12 hours, but you only need it once to create the app.
										</p>
										<RHFInputGroup
											label="Bot name"
											labelClassName="text-[11px] font-medium text-[#8a8f98]"
											className="flex flex-col gap-2"
										>
											<RHFInput
												name="botName"
												placeholder="Whipped"
												inputClassName="font-mono text-[12px] focus:outline-none focus:border-[#ffffff] px-3 py-[9px] bg-[#111111] border border-[#2a2a2a] rounded-md text-[#ededed]"
											/>
											<p className="text-[11px] text-[#5f6672]">
												Shown in Slack as the bot's display name — use something like "OE Office" or "OE Home" to
												identify the device.
											</p>
										</RHFInputGroup>
										<div className="flex flex-col gap-2">
											<label className="text-[11px] font-medium text-[#8a8f98]">App Configuration Token</label>
											<RHFSecretInput name="appConfigToken" placeholder="xoxe-..." />
											<RHFError name="appConfigToken" className="text-[11px] text-[#ff3b4d]" />
										</div>
										<div className="flex flex-col gap-2">
											<label className="text-[11px] font-medium text-[#8a8f98]">
												Public URL (Cloudflare Tunnel domain)
											</label>
											{publicUrl ? (
												<div className="flex items-center gap-2 px-3 py-2 rounded font-mono text-[12px] bg-[#111111] border border-[#2a2a2a] text-[#4ade80]">
													<Check size={12} />
													{publicUrl}
												</div>
											) : (
												<div className="flex items-center gap-2 px-3 py-2 rounded text-[12px] bg-[#111111] border border-[#4a2a1a] text-[#f87171]">
													No tunnel domain configured —{" "}
													<button
														type="button"
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
												App created — <Mono>{config.slackBotName ?? "Whipped"}</Mono> ({config.slackAppId})
											</div>
										) : (
											<>
												<p className="text-[12px] text-[#5f6672]">
													We'll call the Slack API to create and configure the app automatically using your token and
													public URL.
												</p>
												{createError && (
													<div className="flex items-center gap-2 text-[12px] text-[#ff3b4d]">
														<AlertCircle size={13} />
														{createError}
													</div>
												)}
												<button
													type="submit"
													disabled={!step1Done || createApp.loading}
													className="self-start flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity disabled:opacity-40 hover:opacity-80 bg-[#ffffff] text-white"
												>
													{createApp.loading ? (
														<Loader2 size={14} className="animate-spin" />
													) : (
														<ChevronRight size={14} />
													)}
													{createApp.loading ? "Creating…" : "Create Slack App"}
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
												<p className="text-[12px] text-[#5f6672]">
													Click the button to open Slack's install page. After you click Allow, the bot token is
													captured automatically and saved here.
												</p>
												<p className="text-[12px] text-[#5f6672]">
													Make sure your Cloudflare Tunnel is running (Settings → Tunnel) before clicking — Slack needs
													to reach the callback URL.
												</p>
												<button
													type="button"
													onClick={handleInstall}
													disabled={!step2Done}
													className="self-start flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity disabled:opacity-40 hover:opacity-80 bg-[#1a1a2e] border border-[#3a3aff60] text-[#ffffff]"
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
						</form>
					</FormProvider>

					{/* Manual token override */}
					{fullyConfigured && (
						<div className="flex flex-col gap-3">
							<button
								onClick={() => setShowAdvanced((v) => !v)}
								className="self-start flex items-center gap-1.5 text-[11px] transition-opacity hover:opacity-80 text-[#5f6672]"
							>
								<ChevronRight
									size={12}
									className={classNames("transition-transform duration-150", showAdvanced ? "rotate-90" : "rotate-0")}
								/>
								Advanced
							</button>
							{showAdvanced && (
								<AdvancedCredentials config={config} onSaveToken={handleSaveToken} savingToken={saveConfig.loading} />
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
