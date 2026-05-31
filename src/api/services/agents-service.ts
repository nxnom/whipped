import { getAvailableAgents, getCursorModels, getOpencodeModels } from "../../agents/agent-registry.js";

export const listAvailableAgents = async () => getAvailableAgents();

// Both runtime agents return a {value,label} list; opencode emits bare model
// strings, so normalise those to the same shape.
export const listModels = async (agent: "opencode" | "cursor") =>
	agent === "opencode" ? getOpencodeModels().map((m) => ({ value: m, label: m })) : getCursorModels();
