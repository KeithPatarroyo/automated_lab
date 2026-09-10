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
