import { loadGlobalConfig, updateGlobalConfig } from "../../config/runtime-config.js";
import type { RuntimeGlobalConfig } from "../../core/api-contract.js";

export const getGlobalConfig = async () => loadGlobalConfig();

export const saveGlobalConfig = async (patch: Partial<RuntimeGlobalConfig>) => updateGlobalConfig(patch);
