import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt cost parameters. 128 * N * r ≈ 16 MB of memory at these values, well
// under Node's 32 MB default maxmem (raised here anyway to be explicit).
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEM = 64 * 1024 * 1024;

// Self-describing format so verifyPassword can re-derive with the exact params
// the hash was created with: scrypt$N$r$p$<salt-hex>$<hash-hex>
export function hashPassword(plain: string): string {
	const salt = randomBytes(16);
	const hash = scryptSync(plain, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAX_MEM });
	return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
	const parts = stored.split("$");
	if (parts.length !== 6 || parts[0] !== "scrypt") return false;
	const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
	if (!nStr || !rStr || !pStr || !saltHex || !hashHex) return false;
	const salt = Buffer.from(saltHex, "hex");
	const expected = Buffer.from(hashHex, "hex");
	const actual = scryptSync(plain, salt, expected.length, {
		N: Number(nStr),
		r: Number(rStr),
		p: Number(pStr),
		maxmem: MAX_MEM,
	});
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}
