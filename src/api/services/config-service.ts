import { loadGlobalConfig, updateGlobalConfig } from "../../config/runtime-config.js";
import type { RuntimeGlobalConfig } from "../../core/api-contract.js";

// Auth credentials are managed only via the /api/auth routes and the CLI — never
// readable or writable through the general config endpoint.
function stripAuthFields(config: RuntimeGlobalConfig): RuntimeGlobalConfig {
	const { authPasswordHash: _hash, authSessionSecret: _secret, ...rest } = config;
	return rest as RuntimeGlobalConfig;
}

export const getGlobalConfig = async () => stripAuthFields(await loadGlobalConfig());

export const saveGlobalConfig = async (patch: Partial<RuntimeGlobalConfig>) => {
	const { authPasswordHash: _hash, authSessionSecret: _secret, ...safe } = patch;
	return stripAuthFields(await updateGlobalConfig(safe));
};
