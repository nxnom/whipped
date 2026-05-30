import { toast } from "@geckoui/geckoui";
import { CheckCircle2 } from "lucide-react";
import { useRead, useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";
import { TunnelControl } from "./TunnelControl";
import { TunnelSetup } from "./TunnelSetup";

export function TunnelSettings() {
	const { data: config, trigger: refetchConfig } = useRead((api) => api("config").GET());
	const { data: tunnelConfig, trigger: refetchTunnelConfig } = useRead((api) => api("slack/tunnelConfig").GET());

	const saveConfig = useWrite((api) => api("config").PUT());

	const isConfigured = !!(tunnelConfig?.tunnelId && tunnelConfig?.domain);

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
					<TunnelSetup
						config={config}
						tunnelConfig={tunnelConfig}
						isConfigured={isConfigured}
						refetchConfig={refetchConfig}
						refetchTunnelConfig={refetchTunnelConfig}
					/>
				</div>
			</div>
		</div>
	);
}
