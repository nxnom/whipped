import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGlobalConfig } from "../config/runtime-config.js";
import type { NotificationSoundEvent } from "../core/api-contract.js";
import { logger } from "../core/logger.js";

// Original WAV chimes that ship with Whipped. The build copies src/notifications/sounds
// to dist/sounds, so this resolves to src/notifications/sounds in dev and dist/sounds
// in the bundle (both sit next to the module's flattened import.meta.url).
const SOUNDS_DIR = join(dirname(fileURLToPath(import.meta.url)), "sounds");

const SOUND_FILES: Record<NotificationSoundEvent, string> = {
	readyForReview: "ready-for-review.wav",
	prComment: "pr-comment.wav",
	done: "done.wav",
	reopened: "reopened.wav",
	blocked: "blocked.wav",
	runError: "run-error.wav",
};

// Fire-and-forget: plays a short sound on the daemon host when `event` is enabled
// in global config. Never throws and never blocks the caller — failures (missing
// player, unsupported platform) are swallowed at debug level.
export async function playNotificationSound(event: NotificationSoundEvent): Promise<void> {
	try {
		const { notificationSounds } = await loadGlobalConfig();
		if (!notificationSounds.enabled || !notificationSounds[event]) return;
		playOnHost(join(SOUNDS_DIR, SOUND_FILES[event]));
	} catch (err) {
		logger.debug({ err }, `[sound] could not play notification sound for ${event}`);
	}
}

function playOnHost(file: string): void {
	const [command, args] =
		process.platform === "darwin"
			? (["afplay", [file]] as const)
			: process.platform === "linux"
				? (["paplay", [file]] as const)
				: [null, null];
	if (!command) return; // unsupported platform — best-effort no-op

	const child = spawn(command, [...args], { stdio: "ignore", detached: true });
	child.on("error", () => {}); // player binary missing — ignore
	child.unref();
}
