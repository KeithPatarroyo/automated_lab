import "dotenv/config";

export const PORT = Number(process.env.PORT ?? 3001);
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
export const KEITH_PASSWORD = process.env.KEITH_PASSWORD ?? "";
export const ANNA_PASSWORD = process.env.ANNA_PASSWORD ?? "";

/** "live" (default): agents make real decisions via Gemini, costing tokens continuously.
 * "replay": agents replay a previously-recorded session from the database at zero token
 * cost - no background decision loop runs at all - while human chat (npc_chat_*) still
 * calls Gemini normally. See server/src/replay/replayEngine.ts. */
export const SIMULATION_MODE: "live" | "replay" = process.env.SIMULATION_MODE === "replay" ? "replay" : "live";

/** Pins replay mode to a specific recorded window (an ISO-8601 instant plus a duration
 * in hours) instead of auto-selecting "the latest recorded session" (see
 * replay/replayEngine.ts's latestSession). Both must be set together; if either is
 * missing/invalid, replay falls back to the latest-session default. */
export const REPLAY_WINDOW_START = process.env.REPLAY_WINDOW_START ?? "";
export const REPLAY_WINDOW_HOURS = Number(process.env.REPLAY_WINDOW_HOURS ?? "");

/** Which map/database this server instance serves - lets several independent "labs"
 * run as separate processes of the exact same codebase (see README's "Multiple labs"
 * section), each pointed at its own map file (client/public/assets/map/<MAP_FILE>) and
 * its own SQLite file (server/data/<DB_FILE>). Defaults resolve to exactly today's
 * single-lab paths, so an existing deployment/local .env needs no changes to keep
 * being "lab 1". */
export const MAP_FILE = process.env.MAP_FILE ?? "lab.json";
export const DB_FILE = process.env.DB_FILE ?? "lab.sqlite";

/** Two of the Metrics dashboard's fixed labels (see socket/handlers.ts's
 * productivity_open) - overridable per lab so each lab can show a different fixed
 * snapshot, same pattern as MAP_FILE/DB_FILE above. Defaults match Lab 1's original
 * values, so an existing deployment/local .env needs no changes. */
export const PRODUCTIVITY_SCORE_LABEL = process.env.PRODUCTIVITY_SCORE_LABEL ?? "3% more productive than last week";
export const SIMULATION_MATCH_LABEL = process.env.SIMULATION_MATCH_LABEL ?? "Matching to 85%";

if (!GEMINI_API_KEY) {
  console.warn(
    "[env] GEMINI_API_KEY is not set - the computer terminal will respond with an error until it is configured in server/.env",
  );
}
if (!KEITH_PASSWORD || !ANNA_PASSWORD) {
  console.warn(
    "[env] KEITH_PASSWORD/ANNA_PASSWORD is not set - logging in as Keith or Anna will be refused until both are configured in server/.env",
  );
}
