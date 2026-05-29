import { getAvailableAgents, getCursorModels, getOpencodeModels } from "../../agents/agent-registry.js";

export const listAvailableAgents = async () => getAvailableAgents();

export const listOpencodeModels = async () => getOpencodeModels();

export const listCursorModels = async () => getCursorModels();
