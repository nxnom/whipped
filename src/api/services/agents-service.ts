import { getAvailableAgents, getCursorModels, getMimoModels, getOpencodeModels } from "../../agents/agent-registry.js";

export const listAvailableAgents = async () => getAvailableAgents();

// All runtime agents return a {value,label} list; opencode and mimo emit bare
// model strings, so normalise those to the same shape.
export const listModels = async (agent: "opencode" | "cursor" | "mimo") => {
	if (agent === "cursor") return getCursorModels();
	const models = agent === "mimo" ? getMimoModels() : getOpencodeModels();
	return models.map((m) => ({ value: m, label: m }));
};
