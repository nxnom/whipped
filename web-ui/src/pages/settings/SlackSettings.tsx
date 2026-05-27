import { toast } from "@geckoui/geckoui";
import type { RuntimeGlobalConfig } from "@runtime-contract";
import { AlertCircle, Check, Copy, Eye, EyeOff, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/runtime/trpc-client";

function PageHeader() {
	return (
		<div className="shrink-0 flex flex-col gap-1 px-10 py-6" style={{ borderBottom: "1px solid #2a2a35" }}>
			<h1 className="text-xl font-semibold" style={{ color: "#f0f0f5" }}>
				Slack
			</h1>
			<p className="text-[13px]" style={{ color: "#60607a" }}>
				System-wide Slack integration — one channel per project, one message per ticket
			</p>
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
		<div className="relative flex-1">
			<input
				type={visible ? "text" : "password"}
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				className="w-full font-mono text-[12px] focus:outline-none focus:border-[#7c6aff]"
				style={{
					padding: "9px 36px 9px 12px",
					background: "#0c0c0f",
					border: "1px solid #2a2a35",
					borderRadius: 6,
					color: "#c0c0d0",
				}}
			/>
			<button
				type="button"
				onClick={() => setVisible((v) => !v)}
				className="absolute right-2 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-80 transition-opacity"
				style={{ color: "#c0c0d0" }}
			>
				{visible ? <EyeOff size={14} /> : <Eye size={14} />}
			</button>
		</div>
	);
}

function FieldRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center gap-4">
			<div className="flex-1 flex flex-col gap-0.5">
				<span className="text-[13px] font-medium" style={{ color: "#c0c0d0" }}>
					{label}
				</span>
				<span className="text-[11px]" style={{ color: "#60607a" }}>
					{description}
				</span>
			</div>
			{children}
		</div>
	);
}

function CodeBlock({ children }: { children: string }) {
	return (
		<code
			className="block text-[12px] px-3 py-2 rounded font-mono"
			style={{ background: "#0c0c0f", color: "#a0a0c0", border: "1px solid #2a2a35" }}
		>
			{children}
		</code>
	);
}

function isValidDomain(domain: string): boolean {
	const trimmed = domain.trim();
	if (!trimmed) return false;
	// basic domain validation — must have at least one dot and no spaces
	return /^[a-zA-Z0-9]([a-zA-Z0-9-_.]+)\.[a-zA-Z]{2,}$/.test(trimmed);
}

function ManifestDialog({ onClose }: { onClose: () => void }) {
	const [domain, setDomain] = useState("");
	const [copied, setCopied] = useState(false);
	const [touched, setTouched] = useState(false);

	const domainError = touched && !isValidDomain(domain)
		? domain.trim() === "" ? "Domain is required" : "Enter a valid domain (e.g. slack.yourdomain.com)"
		: null;

	const manifest = JSON.stringify(
		{
			display_information: {
				name: "Overemployed",
				description: "AI agent task notifications",
				background_color: "#1a1a2e",
			},
			features: {
				bot_user: { display_name: "Overemployed", always_online: true },
				slash_commands: [
					{
						command: "/reopen",
						url: `https://${domain || "your-domain.com"}/api/slack/commands`,
						description: "Reopen a task from its thread",
						should_escape: false,
					},
				],
			},
			oauth_config: {
				scopes: {
					bot: [
						"channels:manage",
						"channels:join",
						"channels:read",
						"channels:history",
						"chat:write",
						"chat:write.public",
						"groups:write",
						"groups:read",
						"groups:history",
						"commands",
					],
				},
			},
			settings: {
				event_subscriptions: {
					request_url: `https://${domain || "your-domain.com"}/api/slack/events`,
					bot_events: ["message.channels", "message.groups"],
				},
				interactivity: { is_enabled: false },
				org_deploy_enabled: false,
				socket_mode_enabled: false,
				token_rotation_enabled: false,
			},
		},
		null,
		2,
	);

	const handleCopy = async () => {
		setTouched(true);
		if (!isValidDomain(domain)) return;
		await navigator.clipboard.writeText(manifest);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center"
			style={{ background: "rgba(0,0,0,0.7)" }}
			onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
		>
			<div
				className="flex flex-col overflow-hidden"
				style={{
					width: 620,
					maxHeight: "85vh",
					background: "#141418",
					border: "1px solid #2a2a35",
					borderRadius: 12,
					boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
				}}
			>
				{/* Header */}
				<div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid #2a2a35" }}>
					<div>
						<p className="text-[15px] font-semibold" style={{ color: "#f0f0f5" }}>
							Slack App Manifest
						</p>
						<p className="text-[12px] mt-0.5" style={{ color: "#60607a" }}>
							Paste this JSON when creating the app at api.slack.com/apps
						</p>
					</div>
					<button onClick={onClose} className="text-[20px] leading-none opacity-40 hover:opacity-80 transition-opacity" style={{ color: "#f0f0f5" }}>
						×
					</button>
				</div>

				{/* Domain input */}
				<div className="px-6 py-4 flex flex-col gap-2" style={{ borderBottom: "1px solid #1a1a1f" }}>
					<label className="text-[12px] font-medium" style={{ color: "#c0c0d0" }}>
						Your public domain <span style={{ color: "#60607a", fontWeight: 400 }}>(where the backend is reachable)</span>
					</label>
					<input
						value={domain}
						onChange={(e) => { setDomain(e.target.value); setTouched(false); }}
						onBlur={() => setTouched(true)}
						placeholder="e.g. slack.yourdomain.com"
						className="font-mono text-[12px] focus:outline-none"
						style={{
							padding: "8px 12px",
							background: "#0c0c0f",
							border: `1px solid ${domainError ? "#ef4444" : "#2a2a35"}`,
							borderRadius: 6,
							color: "#c0c0d0",
						}}
					/>
					{domainError && (
						<div className="flex items-center gap-1.5 text-[11px]" style={{ color: "#ef4444" }}>
							<AlertCircle size={11} />
							{domainError}
						</div>
					)}
				</div>

				{/* Manifest preview */}
				<div className="flex-1 overflow-y-auto px-6 py-4">
					<pre
						className="text-[11px] font-mono leading-relaxed"
						style={{ color: "#8888a0", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
					>
						{manifest}
					</pre>
				</div>

				{/* Footer */}
				<div className="px-6 py-4 flex items-center gap-3" style={{ borderTop: "1px solid #2a2a35" }}>
					<button
						onClick={handleCopy}
						className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
						style={{ background: copied ? "#1a3a1a" : "#7c6aff", color: copied ? "#4ade80" : "#ffffff" }}
					>
						{copied ? <Check size={14} /> : <Copy size={14} />}
						{copied ? "Copied!" : "Copy JSON"}
					</button>
					<a
						href="https://api.slack.com/apps"
						target="_blank"
						rel="noreferrer"
						className="flex items-center gap-1.5 text-[12px] transition-opacity hover:opacity-80"
						style={{ color: "#7c6aff" }}
					>
						Open api.slack.com/apps
						<ExternalLink size={12} />
					</a>
					<div className="flex-1" />
					<button
						onClick={onClose}
						className="px-4 py-2 rounded-lg text-[13px] transition-colors hover:opacity-80"
						style={{ background: "#1a1a1f", color: "#8888a0", border: "1px solid #2a2a35" }}
					>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
	return (
		<div className="flex gap-4">
			<div
				className="shrink-0 flex items-center justify-center text-[11px] font-bold mt-0.5"
				style={{
					width: 22,
					height: 22,
					borderRadius: "50%",
					background: "#1a1a2e",
					border: "1px solid #3a3aff40",
					color: "#7c6aff",
				}}
			>
				{number}
			</div>
			<div className="flex flex-col gap-2 flex-1">
				<p className="text-[13px] font-medium" style={{ color: "#c0c0d0" }}>
					{title}
				</p>
				{children}
			</div>
		</div>
	);
}

export function SlackSettings() {
	const [config, setConfig] = useState<RuntimeGlobalConfig | null>(null);
	const [saving, setSaving] = useState(false);
	const [showManifest, setShowManifest] = useState(false);

	useEffect(() => {
		trpc.config.get.query().then(setConfig).catch(() => {});
	}, []);

	const handleSave = async () => {
		if (!config) return;
		setSaving(true);
		try {
			const updated = await trpc.config.save.mutate(config);
			setConfig(updated);
			toast.success("Slack settings saved");
		} catch {
			toast.error("Failed to save settings");
		} finally {
			setSaving(false);
		}
	};

	if (!config) {
		return (
			<div className="flex-1 flex flex-col">
				<PageHeader />
				<div className="flex items-center justify-center py-20 text-sm" style={{ color: "#60607a" }}>
					Loading...
				</div>
			</div>
		);
	}

	const isConfigured = !!(config.slackBotToken && config.slackSigningSecret);

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<PageHeader />
			<div className="flex-1 overflow-y-auto px-10 py-6">
				<div className="flex flex-col gap-8">

					{/* Status */}
					<div
						className="flex items-center gap-3 px-4 py-3 rounded-lg"
						style={{ background: isConfigured ? "#0f1f0f" : "#1a1a0f", border: `1px solid ${isConfigured ? "#2a4a2a" : "#3a3a1a"}` }}
					>
						<div
							className="shrink-0"
							style={{ width: 8, height: 8, borderRadius: "50%", background: isConfigured ? "#4ade80" : "#facc15" }}
						/>
						<span className="text-[13px]" style={{ color: isConfigured ? "#4ade80" : "#facc15" }}>
							{isConfigured ? "Connected — bot token and signing secret configured" : "Not configured — follow the setup guide below then paste your credentials"}
						</span>
					</div>

					{/* Credentials */}
					<div className="flex flex-col gap-4">
						<SectionDivider title="Credentials" />
						<FieldRow label="Bot Token" description='OAuth & Permissions → "Bot User OAuth Token" (xoxb-...)'>
							<div style={{ width: 340 }}>
								<SecretInput
									value={config.slackBotToken ?? ""}
									placeholder="xoxb-..."
									onChange={(v) => setConfig({ ...config, slackBotToken: v || undefined })}
								/>
							</div>
						</FieldRow>
						<FieldRow label="Signing Secret" description='Basic Information → "Signing Secret"'>
							<div style={{ width: 340 }}>
								<SecretInput
									value={config.slackSigningSecret ?? ""}
									placeholder="Enter signing secret"
									onChange={(v) => setConfig({ ...config, slackSigningSecret: v || undefined })}
								/>
							</div>
						</FieldRow>
						<div className="flex justify-end">
							<button
								onClick={handleSave}
								disabled={saving}
								className="text-sm font-medium px-4 py-2 rounded-lg transition-opacity disabled:opacity-50"
								style={{ background: "#7c6aff", color: "#ffffff" }}
							>
								{saving ? "Saving..." : "Save"}
							</button>
						</div>
					</div>

					{/* Setup Guide */}
					<div className="flex flex-col gap-5">
						<SectionDivider title="Setup Guide" />

						{/* Part 1: Cloudflare Tunnel */}
						<div className="flex flex-col gap-1">
							<p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#4a4a5a" }}>
								Part 1 — Expose your server with Cloudflare Tunnel
							</p>
							<p className="text-[12px]" style={{ color: "#60607a" }}>
								Slack needs a public URL to send events to. Do this once — the subdomain is permanent.
							</p>
						</div>

						<div className="flex flex-col gap-5 pl-1">
							<Step number={1} title="Install cloudflared">
								<CodeBlock>brew install cloudflared</CodeBlock>
							</Step>

							<Step number={2} title="Authenticate with Cloudflare">
								<CodeBlock>cloudflared tunnel login</CodeBlock>
								<p className="text-[12px]" style={{ color: "#60607a" }}>
									Opens a browser window — select your Cloudflare account and authorise. Writes a certificate to <span className="font-mono text-[11px]">~/.cloudflared/cert.pem</span>.
								</p>
							</Step>

							<Step number={3} title="Create a named tunnel">
								<CodeBlock>cloudflared tunnel create overemployed</CodeBlock>
								<p className="text-[12px]" style={{ color: "#60607a" }}>
									Prints a tunnel ID — note it down. Writes credentials to <span className="font-mono text-[11px]">~/.cloudflared/{"<tunnel-id>"}.json</span>.
								</p>
							</Step>

							<Step number={4} title="Route your subdomain to the tunnel">
								<CodeBlock>cloudflared tunnel route dns overemployed your-subdomain.yourdomain.com</CodeBlock>
								<p className="text-[12px]" style={{ color: "#60607a" }}>
									If this fails, add a CNAME manually in your DNS provider:
								</p>
								<div
									className="text-[11px] font-mono leading-relaxed px-3 py-2 rounded"
									style={{ background: "#0c0c0f", border: "1px solid #2a2a35", color: "#8888a0" }}
								>
									<div>Type: CNAME</div>
									<div>Name: your-subdomain</div>
									<div>Content: {"<tunnel-id>"}.cfargotunnel.com</div>
									<div>Proxy: Proxied (orange cloud ON)</div>
								</div>
							</Step>

							<Step number={5} title="Create the tunnel config file">
								<p className="text-[12px]" style={{ color: "#60607a" }}>
									Create <span className="font-mono text-[11px]">~/.cloudflared/config.yml</span>:
								</p>
								<pre
									className="text-[11px] font-mono leading-relaxed px-3 py-2 rounded"
									style={{ background: "#0c0c0f", border: "1px solid #2a2a35", color: "#8888a0" }}
								>
{`tunnel: <tunnel-id>
credentials-file: /Users/<username>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: your-subdomain.yourdomain.com
    service: http://127.0.0.1:50008
  - service: http_status:404`}
								</pre>
							</Step>

							<Step number={6} title="Run the tunnel (every time you start the app)">
								<CodeBlock>cloudflared tunnel run overemployed</CodeBlock>
								<p className="text-[12px]" style={{ color: "#60607a" }}>
									Run this in a separate terminal alongside the app. When you see <span className="font-mono text-[11px]">INF Registered tunnel connection</span> your URL is live.
								</p>
							</Step>
						</div>

						{/* Part 2: Slack App */}
						<div className="flex flex-col gap-1 mt-2">
							<p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#4a4a5a" }}>
								Part 2 — Create the Slack app
							</p>
							<p className="text-[12px]" style={{ color: "#60607a" }}>
								One-time setup in your Slack workspace.
							</p>
						</div>

						<div className="flex flex-col gap-5 pl-1">
							<Step number={7} title="Create the app from manifest">
								<p className="text-[12px]" style={{ color: "#60607a" }}>
									Go to <span className="font-mono text-[11px]" style={{ color: "#7c6aff" }}>api.slack.com/apps</span> → Create New App → From a manifest → select your workspace → choose the <strong style={{ color: "#c0c0d0" }}>JSON</strong> tab.
								</p>
								<p className="text-[12px]" style={{ color: "#60607a" }}>
									Use the button below — enter your public domain and copy the generated JSON.
								</p>
								<button
									onClick={() => setShowManifest(true)}
									className="self-start flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium transition-opacity hover:opacity-80"
									style={{ background: "#1a1a2e", border: "1px solid #3a3aff40", color: "#7c6aff" }}
								>
									<Copy size={13} />
									Copy App Manifest
								</button>
							</Step>

							<Step number={8} title="Install to your workspace">
								<p className="text-[12px]" style={{ color: "#60607a" }}>
									In the Slack app page: <strong style={{ color: "#c0c0d0" }}>Install App</strong> → Install to workspace → Allow.
								</p>
							</Step>

							<Step number={9} title="Copy your credentials">
								<div className="flex flex-col gap-1 text-[12px]" style={{ color: "#60607a" }}>
									<p>• <strong style={{ color: "#c0c0d0" }}>Bot Token:</strong> OAuth & Permissions → Bot User OAuth Token (<span className="font-mono text-[11px]">xoxb-...</span>)</p>
									<p>• <strong style={{ color: "#c0c0d0" }}>Signing Secret:</strong> Basic Information → Signing Secret</p>
									<p>Paste both into the Credentials fields above and save.</p>
								</div>
							</Step>
						</div>

						{/* How it works */}
						<div className="flex flex-col gap-1 mt-2">
							<p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "#4a4a5a" }}>
								How it works
							</p>
						</div>
						<div
							className="rounded-lg overflow-hidden text-[12px]"
							style={{ border: "1px solid #2a2a35" }}
						>
							{[
								["Ticket created", `New message posted to #oe-{project-name}`],
								["Agent adds activity", "Reply in the ticket's thread"],
								["Ticket changes status", "Reply: Status → In Progress / Done / Blocked"],
								["PR opened or merged", "Reply in thread with PR link"],
								["You reply in thread", "Comment added to the ticket"],
								["You send /reopen in thread", "Ticket moved to Reopened column"],
							].map(([event, result], i) => (
								<div
									key={event}
									className="flex items-center gap-4 px-4 py-3"
									style={{ background: i % 2 === 0 ? "#0c0c0f" : "#0f0f12", borderBottom: i < 5 ? "1px solid #1a1a1f" : undefined }}
								>
									<span className="font-medium shrink-0" style={{ color: "#c0c0d0", width: 220 }}>{event}</span>
									<span style={{ color: "#60607a" }}>{result}</span>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>

			{showManifest && <ManifestDialog onClose={() => setShowManifest(false)} />}
		</div>
	);
}
