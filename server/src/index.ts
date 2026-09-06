import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@lab/shared";
import { CLIENT_ORIGIN, PORT } from "./env.js";
import { registerSocketHandlers } from "./socket/handlers.js";
import { startGameLoop } from "./game/loop.js";
import { shutdownAgentRuntime, startAgentRuntime } from "./agents/runtime.js";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get("/", (_req, res) =>
  res
    .type("text/plain")
    .send("Automated Lab realtime server.\nThis is the game backend, not a page to browse - open the client instead.\nGET /health for a JSON status check."),
);
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

io.on("connection", (socket) => registerSocketHandlers(io, socket));

const stopGameLoop = startGameLoop(io);
const stopAgentRuntime = startAgentRuntime(io);

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

// Persist the agents' final position/streak and close the database cleanly on a normal
// shutdown (Ctrl+C, `tsx watch` restart on file change, etc.) rather than only ever
// relying on the periodic snapshot - a clean exit shouldn't lose anything.
function shutdown(): void {
  stopGameLoop();
  stopAgentRuntime();
  shutdownAgentRuntime();
  httpServer.close(() => process.exit(0));
  // Force-exit if sockets/connections keep the process alive past a couple seconds.
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
