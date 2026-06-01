import { Check, Copy, ExternalLink, FolderOpen, Monitor, Puzzle, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { classNames } from "@/utils/classNames";
import { useRead, useWrite } from "@/runtime/api-client";
import { toast } from "@geckoui/geckoui";

function CopyField({ label, value }: { label: string; value: string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = async () => {
		await navigator.clipboard.writeText(value);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};
	return (
		<div>
			<p className="text-[11px] font-semibold text-[#8888a0] uppercase tracking-[0.5px] mb-1.5">{label}</p>
			<div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#0c0c0f] border border-[#2a2a35]">
				<span className="flex-1 font-mono text-[12px] text-[#c4baff] truncate">{value}</span>
				<button
					onClick={handleCopy}
					className="shrink-0 flex items-center gap-1 text-[11px] text-[#4a4a5a] hover:text-[#8888a0] transition-colors"
				>
					{copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
		</div>
	);
}

function StepBadge({ n, done }: { n: number; done: boolean }) {
	return (
		<div
			className={classNames(
				"shrink-0 flex items-center justify-center text-[11px] font-bold w-6 h-6 rounded-full border",
				done ? "bg-[#1a3a1a] border-[#2a6a2a] text-[#4ade80]" : "bg-[#1a1a2e] border-[#7c6aff60] text-[#7c6aff]",
			)}
		>
			{done ? <Check size={12} /> : n}
		</div>
	);
}

function Step({
	n,
	title,
	done,
	last,
	children,
}: {
	n: number;
	title: string;
	done: boolean;
	last?: boolean;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex gap-4">
			<div className="flex flex-col items-center gap-0">
				<StepBadge n={n} done={done} />
				{!last && children && <div className="flex-1 w-px bg-[#2a2a35] min-h-4 mt-1" />}
			</div>
			<div className="flex flex-col gap-3 flex-1 pb-6">
				<p className="text-[13px] font-medium text-[#f0f0f5] leading-none pt-0.5">{title}</p>
				{children}
			</div>
		</div>
	);
}

function InlineCode({ children }: { children: string }) {
	return (
		<code className="font-mono text-[11px] text-[#c4baff] bg-[#7c6aff15] border border-[#7c6aff25] rounded px-1.5 py-0.5">
			{children}
		</code>
	);
}

export function ExtensionSettings() {
	const [port, setPort] = useState<number | null>(null);

	const { data: tunnelConfig } = useRead((api) => api("tunnel/tunnelConfig").GET());
	const { data: tunnelStatusData } = useRead((api) => api("tunnel/tunnelStatus").GET());
	const { data: extensionPathData } = useRead((api) => api("fs/extension-path").GET());
	const { trigger: openPath } = useWrite((api) => api("fs/open").POST());

	const tunnelDomain = tunnelConfig?.domain ?? null;
	const tunnelStatus = tunnelStatusData?.status ?? "stopped";
	const extensionPath = extensionPathData?.path ?? null;

	useEffect(() => {
		setPort(Number(window.location.port) || 50007);
	}, []);

	const localUrl = `http://localhost:${port ?? 50007}`;
	const tunnelUrl = tunnelDomain && tunnelStatus === "running" ? `https://${tunnelDomain}` : null;
	const serverUrl = tunnelUrl ?? localUrl;

	const openExtensionFolder = () => {
		if (!extensionPath) return;
		openPath({ body: { path: extensionPath } }).then((res) => {
			if (res.error) toast.error("Could not open folder");
		});
	};

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			{/* Header */}
			<div className="shrink-0 flex flex-col gap-1 px-10 py-6 border-b border-[#2a2a35]">
				<h1 className="text-xl font-semibold text-[#f0f0f5]">Browser Extension</h1>
				<p className="text-[13px] text-[#60607a]">
					Annotate any live page and send visual comments directly to your kanban cards
				</p>
			</div>

			<div className="flex-1 overflow-y-auto px-10 py-6">
				<div className="max-w-2xl flex flex-col gap-8">
					{/* Server URL section */}
					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-2">
							<span className="text-[15px] font-semibold text-[#f0f0f5]">Server URL</span>
							<div className="flex-1 h-px bg-[#1a1a1f]" />
						</div>
						<p className="text-[13px] text-[#8888a0] leading-relaxed">
							This is what you paste into the extension popup. Use the tunnel URL if you want to annotate from a mobile
							device on another network.
						</p>
						<CopyField label="Local (same machine)" value={localUrl} />
						{tunnelUrl ? (
							<CopyField label="Tunnel (mobile / remote)" value={tunnelUrl} />
						) : (
							<div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[#141418] border border-[#2a2a35]">
								<Smartphone size={13} className="text-[#4a4a5a] shrink-0" />
								<span className="text-[12px] text-[#4a4a5a]">
									No tunnel running — set one up in{" "}
									<button
										onClick={(e) => {
											e.preventDefault();
											window.history.pushState({}, "", window.location.pathname.replace(/\/[^/]+$/, "/tunnel"));
											window.dispatchEvent(new PopStateEvent("popstate"));
										}}
										className="text-[#7c6aff] hover:underline cursor-pointer"
									>
										Tunnel settings
									</button>{" "}
									to annotate from mobile
								</span>
							</div>
						)}
					</div>

					{/* Install steps */}
					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-2">
							<span className="text-[15px] font-semibold text-[#f0f0f5]">Setup</span>
							<div className="flex-1 h-px bg-[#1a1a1f]" />
						</div>
						<div className="flex flex-col">
							<Step n={1} title="Open Chrome extension manager" done={false}>
								<div className="flex flex-col gap-2">
									<p className="text-[12px] text-[#8888a0] leading-relaxed">
										Go to <InlineCode>chrome://extensions</InlineCode> in Chrome (or Edge). Enable{" "}
										<strong className="text-[#c0c0d0]">Developer mode</strong> using the toggle in the top-right.
									</p>
									<a
										href="chrome://extensions"
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1.5 text-[12px] text-[#7c6aff] hover:text-[#a78bfa] w-fit"
									>
										<ExternalLink size={11} />
										Open chrome://extensions
									</a>
								</div>
							</Step>

							<Step n={2} title="Load the extension folder" done={false}>
								<div className="flex flex-col gap-2">
									<p className="text-[12px] text-[#8888a0] leading-relaxed">
										Click <strong className="text-[#c0c0d0]">Load unpacked</strong> and select the{" "}
										<InlineCode>extension/</InlineCode> folder. Use the button below to open it directly.
									</p>
									{extensionPath ? (
										<div className="flex items-center gap-2">
											<div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0c0c0f] border border-[#2a2a35] min-w-0">
												<FolderOpen size={12} className="text-[#7c6aff] shrink-0" />
												<span className="font-mono text-[11px] text-[#8888a0] truncate" title={extensionPath}>
													{extensionPath}
												</span>
											</div>
											<button
												onClick={openExtensionFolder}
												className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium bg-[#7c6aff] text-white hover:bg-[#6a57f0] transition-colors"
											>
												<FolderOpen size={12} />
												Open
											</button>
										</div>
									) : (
										<div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#141418] border border-[#2a2a35]">
											<FolderOpen size={12} className="text-[#4a4a5a] shrink-0" />
											<span className="text-[12px] text-[#4a4a5a]">Locating extension folder…</span>
										</div>
									)}
								</div>
							</Step>

							<Step n={3} title="Configure the extension" done={false}>
								<div className="flex flex-col gap-2">
									<p className="text-[12px] text-[#8888a0] leading-relaxed">
										Click the <Puzzle size={11} className="inline mx-0.5 text-[#8888a0]" /> extensions icon in Chrome,
										pin <strong className="text-[#c0c0d0]">Whipped Annotate</strong>, then open its popup. Paste the
										server URL, pick a project and card, and click{" "}
										<strong className="text-[#c0c0d0]">Start Annotating</strong>.
									</p>
									<CopyField label="Paste this into the extension" value={serverUrl} />
								</div>
							</Step>

							<Step n={4} title="Annotate" done={false} last>
								<div className="flex flex-col gap-2">
									<p className="text-[12px] text-[#8888a0] leading-relaxed">
										Navigate to any page. The <strong className="text-[#c0c0d0]">💬 Annotate</strong> button appears in
										the corner. Click it to enter annotation mode, then click any element to leave a comment. It will
										appear on the card's <strong className="text-[#c0c0d0]">Comments</strong> tab with the element
										selector and React source file (if available).
									</p>
									<div className="flex items-start gap-3">
										<div className="flex flex-col items-center gap-1.5 px-4 py-3 rounded-lg bg-[#141418] border border-[#2a2a35] flex-1">
											<Monitor size={16} className="text-[#7c6aff]" />
											<span className="text-[11px] text-[#8888a0] text-center">Desktop — use local URL</span>
										</div>
										<div className="flex flex-col items-center gap-1.5 px-4 py-3 rounded-lg bg-[#141418] border border-[#2a2a35] flex-1">
											<Smartphone size={16} className={tunnelUrl ? "text-[#7c6aff]" : "text-[#4a4a5a]"} />
											<span
												className={classNames(
													"text-[11px] text-center",
													tunnelUrl ? "text-[#8888a0]" : "text-[#4a4a5a]",
												)}
											>
												{tunnelUrl ? "Mobile — use tunnel URL" : "Mobile — requires tunnel"}
											</span>
										</div>
									</div>
								</div>
							</Step>
						</div>
					</div>

					{/* How it works */}
					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-2">
							<span className="text-[15px] font-semibold text-[#f0f0f5]">How it works</span>
							<div className="flex-1 h-px bg-[#1a1a1f]" />
						</div>
						<div className="grid grid-cols-3 gap-3">
							{[
								{
									icon: "🎯",
									title: "Click any element",
									desc: "Hover to highlight, click to select. Captures CSS selector and React component info.",
								},
								{
									icon: "✍️",
									title: "Write a comment",
									desc: "Describe the change. Source file and line number are captured automatically from React dev mode.",
								},
								{
									icon: "📋",
									title: "Lands on the card",
									desc: "Comment appears in the Comments tab with a Visual badge, element selector, and source location.",
								},
							].map(({ icon, title, desc }) => (
								<div
									key={title}
									className="flex flex-col gap-2 px-4 py-3 rounded-lg bg-[#141418] border border-[#2a2a35]"
								>
									<span className="text-xl">{icon}</span>
									<p className="text-[12px] font-medium text-[#c0c0d0]">{title}</p>
									<p className="text-[11px] text-[#60607a] leading-relaxed">{desc}</p>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
