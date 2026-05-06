import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import { KANBOM_HOME_DIR } from "../config/runtime-config.js";

const LOGS_DIR = join(KANBOM_HOME_DIR, "logs");
mkdirSync(LOGS_DIR, { recursive: true });

const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, fixed at process start

export const logger = pino(
	{
		level: "debug",
		base: null,
		timestamp: pino.stdTimeFunctions.isoTime,
		formatters: {
			level: (label) => ({ level: label }),
		},
	},
	pino.multistream([
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
		{
			stream: pino.destination({
				dest: join(LOGS_DIR, `kanbom-${date}.log`),
				sync: false,
			}),
		},
	]),
);
