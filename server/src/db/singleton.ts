import { openDb, type Db } from "./index.js";

/** The one shared database connection for the whole process - agent runtime and human
 * account persistence both write through this, rather than each opening their own
 * handle to the same file. Call `db.close()` once, during server shutdown, after every
 * subsystem has flushed its final state (see server/src/index.ts). */
export const db: Db = openDb();
