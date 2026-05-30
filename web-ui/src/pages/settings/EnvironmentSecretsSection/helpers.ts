import type { RuntimeProjectSecret } from "@runtime-contract";

export function parseEnvText(text: string): RuntimeProjectSecret[] {
	return text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#"))
		.flatMap((l) => {
			const noExport = l.replace(/^export\s+/, "");
			const eq = noExport.indexOf("=");
			if (eq === -1) return [];
			const key = noExport.slice(0, eq).trim();
			let value = noExport.slice(eq + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			return key ? [{ key, value }] : [];
		});
}
