import { homedir } from "node:os";
import { join } from "node:path";

// Path constants live here (and not in runtime-config.ts) so that low-level
// modules like the logger and the SQLite db wrapper can import them without
// pulling in the rest of runtime-config, which would create a load cycle.
export const WHIPPED_HOME_DIR = join(homedir(), ".whipped");
