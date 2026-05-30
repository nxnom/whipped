export type TunnelStatus = "stopped" | "starting" | "running" | "error";

export type TunnelConfigData = {
	tunnelId?: string;
	domain?: string;
};

export type GlobalConfigData = {
	autoStartTunnel: boolean;
};
