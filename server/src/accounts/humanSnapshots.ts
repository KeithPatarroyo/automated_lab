import type { HumanSnapshot } from "../db/index.js";
import { db } from "../db/singleton.js";
import { players } from "../game/state.js";

// Same cadence as the agents' own position snapshot (see agents/runtime.ts's
// SNAPSHOT_INTERVAL_MS) - last-known-position only, not a movement history.
const SNAPSHOT_INTERVAL_MS = 10_000;

export function loadHumanSpawn(accountKey: string): HumanSnapshot | undefined {
  return db.loadHumanSnapshot(accountKey);
}

/** Saves the given account's current position/facing, if a socket is currently
 * connected as that account. No-op otherwise (e.g. called from disconnect after the
 * player was already looked up, or from the periodic sweep for an account nobody is
 * using right now). */
export function saveHumanSnapshot(accountKey: string): void {
  for (const player of players.values()) {
    if (player.accountKey !== accountKey) continue;
    db.saveHumanSnapshot({ accountKey, x: player.x, y: player.y, dir: player.dir });
    return;
  }
}

export function saveAllHumanSnapshots(): void {
  for (const player of players.values()) {
    if (!player.accountKey) continue;
    db.saveHumanSnapshot({ accountKey: player.accountKey, x: player.x, y: player.y, dir: player.dir });
  }
}

/** Call once at server startup; returns a stop function for shutdown. */
export function startHumanSnapshotSaving(): () => void {
  const interval = setInterval(saveAllHumanSnapshots, SNAPSHOT_INTERVAL_MS);
  return () => clearInterval(interval);
}
