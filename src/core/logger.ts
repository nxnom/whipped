import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import { KANBOM_HOME_DIR } from "../config/runtime-config.js";

const LOGS_DIR = join(KANBOM_HOME_DIR, "logs");

const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, fixed at process start

const streams: Parameters<typeof pino.multistream>[0] = [
	{
		stream: pino.transport({
			target: "pino-pretty",
			options: {
				colorize: true,
				translateTime: "HH:MM:ss",
				ignore: "pid,hostname",
				messageFormat: "{msg}",
				errorLikeObjectKeys: ["err"],
			},
		}),
	},
];

try {
	mkdirSync(LOGS_DIR, { recursive: true });
	streams.push({
		stream: pino.destination({
			dest: join(LOGS_DIR, `kanbom-${date}.log`),
			sync: false,
		}),
	});
} catch {
	// Log dir unavailable — stdout only
}

export const logger = pino(
	{
		level: "debug",
		base: null,
		timestamp: pino.stdTimeFunctions.isoTime,
		formatters: {
			level: (label) => ({ level: label }),
		},
	},
	pino.multistream(streams),
);
