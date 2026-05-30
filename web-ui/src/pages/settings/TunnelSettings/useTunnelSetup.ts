import { toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import { type CreateTunnelInput, createTunnelSchema } from "@runtime-validation/slack";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRead, useWrite } from "@/runtime/api-client";

type UseTunnelSetupArgs = {
	domain: string;
	refetchConfig: () => Promise<unknown>;
	refetchTunnelConfig: () => Promise<unknown>;
};

export function useTunnelSetup({ domain, refetchConfig, refetchTunnelConfig }: UseTunnelSetupArgs) {
	const [showSetup, setShowSetup] = useState(false);
	const [loginUrl, setLoginUrl] = useState<string | null>(null);
	const [waitingForAuth, setWaitingForAuth] = useState(false);

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
