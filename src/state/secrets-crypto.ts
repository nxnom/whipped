import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WHIPPED_HOME_DIR } from "../config/paths.js";
import { logger } from "../core/logger.js";

// File-based secret key. Auto-generated on first use, regenerated if found
// in an invalid state (wrong length, unreadable). Decrypt failures (key
// changed, ciphertext tampered with) return "" so the caller falls back
// to defaults; the user re-enters the secret via the UI to fix.
const KEY_PATH = join(WHIPPED_HOME_DIR, ".secret_key");

const KEY_LENGTH = 32; // AES-256
const NONCE_LENGTH = 12; // 96-bit GCM nonce
const TAG_LENGTH = 16; // 128-bit GCM auth tag
const PREFIX = "enc:v1:";

let cachedKey: Buffer | null = null;

function generateAndWriteKey(): Buffer {
	const key = randomBytes(KEY_LENGTH);
	mkdirSync(dirname(KEY_PATH), { recursive: true });
	writeFileSync(KEY_PATH, key.toString("base64"), { mode: 0o600 });
	// writeFileSync's mode is only applied on file creation; chmod again to
	// cover the case where the file existed but was corrupt.
	chmodSync(KEY_PATH, 0o600);
	logger.warn({ path: KEY_PATH }, "Generated new secret key — any previously-encrypted secrets are now unreadable");
	return key;
}

function loadOrGenerateKey(): Buffer {
	if (cachedKey) return cachedKey;

	if (existsSync(KEY_PATH)) {
		try {
			const raw = readFileSync(KEY_PATH, "utf-8").trim();
			const key = Buffer.from(raw, "base64");
			if (key.length === KEY_LENGTH) {
				cachedKey = key;
				return key;
			}
			logger.error(
				{ path: KEY_PATH, gotLength: key.length, expectedLength: KEY_LENGTH },
				"Secret key file has wrong length; regenerating",
			);
			unlinkSync(KEY_PATH);
		} catch (err) {
			logger.error({ err, path: KEY_PATH }, "Secret key file unreadable; regenerating");
			try {
				unlinkSync(KEY_PATH);
			} catch {
				// already gone or unlink failed — generateAndWriteKey will overwrite
			}
		}
	}

	cachedKey = generateAndWriteKey();
	return cachedKey;
}

// Call once at startup so the file read happens upfront and every subsequent
// encrypt/decrypt is a pure in-memory operation.
export function initSecretKey(): void {
	loadOrGenerateKey();
}

export function encrypt(plaintext: string): string {
	const key = loadOrGenerateKey();
	const nonce = randomBytes(NONCE_LENGTH);
	const cipher = createCipheriv("aes-256-gcm", key, nonce);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return PREFIX + Buffer.concat([nonce, ciphertext, tag]).toString("base64");
}

// Strict: every stored value is expected to be `enc:v1:<base64>`. On any
// decryption failure returns "" and logs.
export function decrypt(value: string): string {
	try {
		const key = loadOrGenerateKey();
		const combined = Buffer.from(value.slice(PREFIX.length), "base64");
		if (combined.length < NONCE_LENGTH + TAG_LENGTH) {
			throw new Error(`ciphertext too short (${combined.length} bytes)`);
		}
		const nonce = combined.subarray(0, NONCE_LENGTH);
		const tag = combined.subarray(combined.length - TAG_LENGTH);
		const ciphertext = combined.subarray(NONCE_LENGTH, combined.length - TAG_LENGTH);
		const decipher = createDecipheriv("aes-256-gcm", key, nonce);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
	} catch (err) {
		logger.error(
			{ err: (err as Error).message },
			"Failed to decrypt secret — returning empty. Update the value via the UI to re-encrypt with the current key.",
		);
		return "";
	}
}
