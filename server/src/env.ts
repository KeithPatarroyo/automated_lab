import "dotenv/config";

export const PORT = Number(process.env.PORT ?? 3001);
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

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
