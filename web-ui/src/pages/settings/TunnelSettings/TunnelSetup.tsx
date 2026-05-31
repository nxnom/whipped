import { RHFError, RHFInput, RHFInputGroup } from "@geckoui/geckoui";
import { Check, ChevronRight, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { FormProvider } from "react-hook-form";
import { classNames } from "@/utils/classNames";
import { Mono, StepRow } from "./components";
import type { GlobalConfigData, TunnelConfigData } from "./types";
import { useTunnelSetup } from "./useTunnelSetup";

type TunnelSetupProps = {
	config: GlobalConfigData;
	tunnelConfig: TunnelConfigData | undefined;
	isConfigured: boolean;
};

export function TunnelSetup({ config, tunnelConfig, isConfigured }: TunnelSetupProps) {
	const {
		methods,
		showSetup,
		setShowSetup,
		loginUrl,
		waitingForAuth,
		cloudflaredStatus,
		checkingInstall,
		checkCloudflared,
		cloudflaredLogin,
		createTunnel,
		resetTunnel,
		handleLogin,
		handleCreateTunnel,
		handleReset,
	} = useTunnelSetup({ domain: tunnelConfig?.domain ?? "" });

	const step1Done = cloudflaredStatus?.installed === true;
	const step2Done = cloudflaredStatus?.authed === true;
	const step3Done = !!(tunnelConfig?.tunnelId && tunnelConfig?.domain);

	return (
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
									{createTunnel.loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
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
										<Mono>cloudflared tunnel create whipped</Mono> and write <Mono>~/.cloudflared/config.yml</Mono>{" "}
										automatically.
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
										{createTunnel.loading ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
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
										CNAME <Mono>{tunnelConfig?.domain}</Mono> → <Mono>{tunnelConfig?.tunnelId}.cfargotunnel.com</Mono>
									</p>
								</div>
							)}
						</StepRow>

						{/* Step 5: Auto-start */}
						<StepRow n={5} title="Enable auto-start" done={config.autoStartTunnel} active={step3Done}>
							<p className="text-[12px] text-[#60607a]">
								Toggle <span className="text-[#c0c0d0] font-medium">Auto-start tunnel</span> above — the tunnel starts
								automatically on every server start. No separate terminal needed.
							</p>
						</StepRow>
					</div>
				)}
			</form>
		</FormProvider>
	);
}
