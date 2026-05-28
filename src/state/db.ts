import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { WHIPPED_HOME_DIR } from "../config/paths.js";
import { logger } from "../core/logger.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

const DEFAULT_DB_PATH = join(WHIPPED_HOME_DIR, "whipped.db");

let cachedDb: Database.Database | null = null;

export function openDb(): Database.Database {
	if (cachedDb) return cachedDb;

	const dbPath = process.env.WHIPPED_DB_PATH ?? DEFAULT_DB_PATH;
	mkdirSync(dirname(dbPath), { recursive: true });

	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");
	db.pragma("foreign_keys = ON");
	db.pragma("busy_timeout = 5000");

	runMigrations(db);

	cachedDb = db;
	return db;
}

export function getDb(): Database.Database {
	if (!cachedDb) {
		throw new Error("Database not initialised. Call openDb() at startup before getDb().");
	}
	return cachedDb;
}

export function closeDb(): void {
	if (cachedDb) {
		cachedDb.close();
		cachedDb = null;
	}
}

function runMigrations(db: Database.Database): void {
	const currentVersion = db.pragma("user_version", { simple: true }) as number;

	const files = readdirSync(MIGRATIONS_DIR)
		.filter((f) => /^\d+_.+\.sql$/.test(f))
		.sort();

	for (const file of files) {
		const version = Number.parseInt(file.split("_")[0] ?? "0", 10);
		if (!Number.isFinite(version) || version <= currentVersion) continue;

		const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
		logger.info({ file, version }, "Running migration");

		const tx = db.transaction(() => {
			db.exec(sql);
			db.pragma(`user_version = ${version}`);
		});

		try {
			tx();
		} catch (err) {
			logger.error({ err, file }, "Migration failed; rolled back");
			throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
		}
	}
}
