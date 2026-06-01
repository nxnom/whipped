import { loadGlobalConfig, updateGlobalConfig } from "../../config/runtime-config.js";
import {
	checkCloudflaredAuth,
	checkCloudflaredInstalled,
	createTunnel as createCloudflaredTunnel,
	openCloudflaredLogin,
	readTunnelConfig,
	routeDns,
	writeTunnelConfig,
} from "../../tunnel/cloudflare-setup.js";
import { tunnelManager } from "../../tunnel/cloudflare-tunnel.js";

export const checkCloudflared = async () => {
	const [install, authed] = await Promise.all([checkCloudflaredInstalled(), checkCloudflaredAuth()]);
	return { ...install, authed };
};

export const cloudflaredLogin = async (force: boolean) => openCloudflaredLogin(force);

export const createTunnel = async (domain: string) => {
	const config = await loadGlobalConfig();
	const name = config.tunnelName ?? "whipped";
	const { tunnelId } = await createCloudflaredTunnel(name);
	await writeTunnelConfig(tunnelId, name, domain);
	await routeDns(name, domain);
	await updateGlobalConfig({ tunnelId, tunnelDomain: domain });
	return { tunnelId };
};

export const getTunnelConfig = async () => {
	const [config, fileConfig] = await Promise.all([loadGlobalConfig(), readTunnelConfig()]);
	return {
		tunnelId: config.tunnelId ?? fileConfig?.tunnelId,
		domain: config.tunnelDomain ?? fileConfig?.domain,
		tunnelName: config.tunnelName ?? "whipped",
	};
};

export const getTunnelStatus = async () => tunnelManager.getState();

export const startTunnel = async () => {
	tunnelManager.start();
	return tunnelManager.getState();
};

export const stopTunnel = async () => {
	tunnelManager.stop();
	return tunnelManager.getState();
};

export const resetTunnel = async () => {
	tunnelManager.stop();
	await updateGlobalConfig({ tunnelId: undefined, tunnelDomain: undefined, autoStartTunnel: false });
	// Remove the cloudflared config file so the wizard starts clean
	const { unlink } = await import("node:fs/promises");
	const { homedir } = await import("node:os");
	const { join } = await import("node:path");
	try {
		await unlink(join(homedir(), ".cloudflared", "config.yml"));
	} catch {
		/* already gone */
	}
};
