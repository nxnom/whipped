import { toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import { type CreateTunnelInput, createTunnelSchema } from "@runtime-validation/slack";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRead, useWrite } from "@/runtime/api-client";

type UseTunnelSetupArgs = {
	domain: string;
};

export function useTunnelSetup({ domain }: UseTunnelSetupArgs) {
	const [showSetup, setShowSetup] = useState(false);
	const [loginUrl, setLoginUrl] = useState<string | null>(null);
	const [pendingAuth, setPendingAuth] = useState(false);

	// cloudflared install/auth status. Fetched on demand (Check installation /
	// login flow), so the read is lazy + manually triggered.
	const {
		data: cloudflaredStatus,
		fetching: checkingInstall,
		trigger: checkCloudflared,
	} = useRead((api) => api("slack/checkCloudflared").GET(), { enabled: false });

	const cloudflaredLogin = useWrite((api) => api("slack/cloudflaredLogin").POST());
	const createTunnel = useWrite((api) => api("slack/createTunnel").POST());
	const resetTunnel = useWrite((api) => api("slack/resetTunnel").POST());

	const methods = useForm({
		resolver: zodResolver(createTunnelSchema),
		values: { domain } satisfies CreateTunnelInput,
	});

	// The user started the browser login and cloudflared hasn't reported authed
	// yet. Derived so it flips back to false on its own once auth completes.
	const waitingForAuth = pendingAuth && !cloudflaredStatus?.authed;

	// While waiting for browser auth, poll cloudflared status every 2s until it
	// reports authenticated (preserves the original interval behavior).
	useEffect(() => {
		if (!waitingForAuth) return;
		const id = setInterval(() => {
			void checkCloudflared();
		}, 2000);
		return () => clearInterval(id);
	}, [waitingForAuth, checkCloudflared]);

	// Clear the intent flag + login URL and notify once authenticated (the toast
	// is a real side-effect, so it stays in an effect).
	useEffect(() => {
		if (pendingAuth && cloudflaredStatus?.authed) {
			setPendingAuth(false);
			setLoginUrl(null);
			toast.success("Authenticated with Cloudflare");
		}
	}, [pendingAuth, cloudflaredStatus?.authed]);

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
			setPendingAuth(true);
		} else {
			toast.error("Could not get login URL — run 'cloudflared tunnel login' in your terminal");
		}
	};

	const handleCreateTunnel = methods.handleSubmit(async (values) => {
		// Tunnel writes live under slack/* but mutate the global config, so invalidate
		// both segments to refresh the config + tunnelConfig reads.
		const res = await createTunnel.trigger({
			body: { domain: values.domain.trim() },
			invalidate: ["config", "config/*", "slack", "slack/*"],
		});
		if (res.error) {
			toast.error(res.error.message ?? "Failed to create tunnel");
			return;
		}
		toast.success("Tunnel created and config file written");
	});

	const handleReset = async () => {
		const res = await resetTunnel.trigger({ invalidate: ["config", "config/*", "slack", "slack/*"] });
		if (res.error) {
			toast.error("Failed to reset");
			return;
		}
		methods.reset({ domain: "" });
		setShowSetup(false);
		toast.success("Tunnel config cleared");
	};

	return {
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
	};
}
