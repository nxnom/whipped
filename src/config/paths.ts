import { homedir } from "node:os";
import { join } from "node:path";

// Path constants live here (and not in runtime-config.ts) so that low-level
// modules like the logger and the SQLite db wrapper can import them without
// pulling in the rest of runtime-config, which would create a load cycle.
//
// WHIPPED_HOME_DIR is the single root for ALL persistent state — the SQLite db,
// daemon.pid (single-instance lock), attachments, terminal buffers, secret key,
// and logs. Override it to run a second, fully-isolated instance (own db + lock):
//   WHIPPED_HOME_DIR=~/.whipped-projectB whipped --port 50009
// Resolved once at import, so it must be set in the environment before launch.
export const WHIPPED_HOME_DIR = process.env.WHIPPED_HOME_DIR ?? join(homedir(), ".whipped");
