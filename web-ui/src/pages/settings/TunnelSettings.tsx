import { toast } from "@geckoui/geckoui";
import type { RuntimeGlobalConfig } from "@runtime-contract";
import { Loader2, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/runtime/trpc-client";

function CodeBlock({ children }: { children: string }) {
	return (
		<code
			className="block px-3 py-2 rounded font-mono text-[11px]"
			style={{ background: "#0c0c0f", border: "1px solid #2a2a35", color: "#a0a0c0" }}
		>
			{children}
		</code>
	);
}

function Mono({ children }: { children: React.ReactNode }) {
	return <span className="font-mono text-[11px]" style={{ color: "#a0a0c0" }}>{children}</span>;
}

function SetupStep({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
	return (
		<div className="flex gap-4">
			<div
				className="shrink-0 flex items-center justify-center text-[11px] font-bold mt-0.5"
				style={{ width: 22, height: 22, borderRadius: "50%", background: "#1a1a2e", border: "1px solid #3a3aff40", color: "#7c6aff" }}
			>
				{number}
			</div>
			<div className="flex flex-col gap-2 flex-1">
				<p className="text-[13px] font-medium" style={{ color: "#c0c0d0" }}>{title}</p>
				{children}
			</div>
		</div>
	);
}

function SectionDivider({ title }: { title: string }) {
	return (
		<div className="flex items-center gap-3">
			<span className="text-[15px] font-semibold" style={{ color: "#f0f0f5" }}>
				{title}
			</span>
			<div className="flex-1" style={{ height: 1, background: "#1a1a1f" }} />
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

	const refetch = () => {
		trpc.slack.tunnelStatus.query().then(setState).catch(() => {});
	};

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
		<div
			className="flex items-center gap-3 px-4 py-3 rounded-lg"
			style={{ background: "#0c0c0f", border: "1px solid #2a2a35" }}
		>
			<div className="flex items-center gap-2 flex-1 min-w-0">
				{status === "starting" ? (
					<Loader2 size={8} className="animate-spin shrink-0" style={{ color: style.dot }} />
				) : (
					<div className="shrink-0" style={{ width: 8, height: 8, borderRadius: "50%", background: style.dot }} />
				)}
				<span className="text-[13px]" style={{ color: style.text }}>{style.label}</span>
				{state?.error && (
					<span className="text-[11px] font-mono truncate" style={{ color: "#60607a" }}>
						— {state.error}
					</span>
				)}
			</div>
			<button
				onClick={isRunning ? handleStop : handleStart}
				disabled={acting}
				className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium transition-opacity disabled:opacity-50 hover:opacity-80 shrink-0"
				style={{
					background: isRunning ? "#2a1a1a" : "#1a2a1a",
					border: `1px solid ${isRunning ? "#4a1a1a" : "#1a4a1a"}`,
					color: isRunning ? "#f87171" : "#4ade80",
				}}
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

	useEffect(() => {
		trpc.config.get.query().then(setConfig).catch(() => {});
	}, []);

	const handleSave = async (next: RuntimeGlobalConfig) => {
		setSaving(true);
		try {
			const updated = await trpc.config.save.mutate(next);
			setConfig(updated);
			toast.success("Settings saved");
		} catch {
			toast.error("Failed to save settings");
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

	const toggle = async () => {
		const next = { ...config, autoStartTunnel: !config.autoStartTunnel };
		setConfig(next);
		await handleSave(next);
	};

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<div className="shrink-0 flex flex-col gap-1 px-10 py-6" style={{ borderBottom: "1px solid #2a2a35" }}>
				<h1 className="text-xl font-semibold" style={{ color: "#f0f0f5" }}>Tunnel</h1>
				<p className="text-[13px]" style={{ color: "#60607a" }}>
					Expose your local server publicly via Cloudflare Tunnel for incoming webhooks (Slack, GitHub, etc.)
				</p>
			</div>
			<div className="flex-1 overflow-y-auto px-10 py-6">
				<div className="flex flex-col gap-6">

					{/* Auto-start toggle */}
					<div className="flex flex-col gap-4">
						<SectionDivider title="Cloudflare Tunnel" />
						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-0.5">
								<span className="text-[13px] font-medium" style={{ color: "#c0c0d0" }}>Auto-start tunnel</span>
								<span className="text-[11px]" style={{ color: "#60607a" }}>
									Start the tunnel automatically when the server starts
								</span>
							</div>
							<button
								role="switch"
								aria-checked={config.autoStartTunnel}
								onClick={toggle}
								disabled={saving}
								className="relative shrink-0 transition-colors disabled:opacity-50"
								style={{
									width: 36,
									height: 20,
									borderRadius: 10,
									background: config.autoStartTunnel ? "#7c6aff" : "#2a2a35",
								}}
							>
								<span
									className="absolute top-[3px] transition-transform"
									style={{
										width: 14,
										height: 14,
										borderRadius: "50%",
										background: "#ffffff",
										left: 3,
										transform: config.autoStartTunnel ? "translateX(16px)" : "translateX(0)",
									}}
								/>
							</button>
						</div>
						<TunnelControl />
					</div>

					{/* Setup guide */}
					<div className="flex flex-col gap-5">
						<SectionDivider title="First-time Setup" />

						<div className="flex flex-col gap-5 text-[12px]" style={{ color: "#60607a" }}>

							<SetupStep number={1} title="Install cloudflared">
								<CodeBlock>brew install cloudflared</CodeBlock>
							</SetupStep>

							<SetupStep number={2} title="Authenticate with Cloudflare">
								<CodeBlock>cloudflared tunnel login</CodeBlock>
								<p>Opens a browser — select your Cloudflare account and authorise. Writes a cert to <Mono>~/.cloudflared/cert.pem</Mono>.</p>
							</SetupStep>

							<SetupStep number={3} title="Create a named tunnel">
								<CodeBlock>cloudflared tunnel create overemployed</CodeBlock>
								<p>Prints a tunnel ID — note it down. Writes credentials to <Mono>~/.cloudflared/{"<tunnel-id>"}.json</Mono>.</p>
							</SetupStep>

							<SetupStep number={4} title="Route your subdomain to the tunnel">
								<CodeBlock>cloudflared tunnel route dns overemployed your-subdomain.yourdomain.com</CodeBlock>
								<p>If that fails, add a CNAME manually in your DNS provider:</p>
								<pre
									className="px-3 py-2 rounded font-mono text-[11px] leading-relaxed"
									style={{ background: "#0c0c0f", border: "1px solid #2a2a35", color: "#8888a0" }}
								>
{`Type:    CNAME
Name:    your-subdomain
Content: <tunnel-id>.cfargotunnel.com
Proxy:   Proxied (orange cloud ON)`}
								</pre>
							</SetupStep>

							<SetupStep number={5} title="Create the config file">
								<p>Create <Mono>~/.cloudflared/config.yml</Mono>:</p>
								<pre
									className="px-3 py-2 rounded font-mono text-[11px] leading-relaxed"
									style={{ background: "#0c0c0f", border: "1px solid #2a2a35", color: "#8888a0" }}
								>
{`tunnel: <tunnel-id>
credentials-file: /Users/<username>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: your-subdomain.yourdomain.com
    service: http://127.0.0.1:50008
  - service: http_status:404`}
								</pre>
							</SetupStep>

							<SetupStep number={6} title="Enable auto-start (recommended)">
								<p>Toggle <span style={{ color: "#c0c0d0", fontWeight: 500 }}>Auto-start tunnel</span> above — the tunnel will start automatically every time the server starts. No need to run anything separately.</p>
							</SetupStep>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
