import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { isPasswordSet, setPasswordHash } from "../auth/auth-store.js";
import { hashPassword } from "../auth/password.js";
import { MIN_PASSWORD_LENGTH } from "../core/validation/auth.js";
import { openDb } from "../state/db.js";

// Reads a line from stdin without echoing the typed characters.
function promptHidden(query: string): Promise<string> {
	return new Promise((resolve) => {
		let muted = false;
		const output = new Writable({
			write(chunk, _encoding, callback) {
				if (!muted) process.stdout.write(chunk);
				callback();
			},
		});
		const rl = createInterface({ input: process.stdin, output, terminal: true });
		rl.question(query, (answer) => {
			rl.close();
			process.stdout.write("\n");
			resolve(answer);
		});
		muted = true;
	});
}

export async function setPasswordCommand(): Promise<void> {
	openDb();
	const existed = await isPasswordSet();

	const password = await promptHidden(existed ? "New password: " : "Set a password: ");
	if (password.length < MIN_PASSWORD_LENGTH) {
		console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
		process.exit(1);
	}

	const confirm = await promptHidden("Confirm password: ");
	if (password !== confirm) {
		console.error("Passwords do not match.");
		process.exit(1);
	}

	await setPasswordHash(hashPassword(password));
	console.log(existed ? "Password updated." : "Password set. You can now log in to the web UI.");
}
