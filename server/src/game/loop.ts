import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@lab/shared";
import { entitiesOverlap, TICK_RATE_HZ } from "@lab/shared";
import { players, allPlayerStates } from "./state.js";
import { resolveMove } from "./collision.js";
import { mapMeta, TILE_WIDTH, TILE_HEIGHT } from "../data/mapMeta.js";
import { agentNpcStates, agentStates, stepAllAgentsMovement } from "../agents/runtime.js";
import { AGENT_PERSONAS } from "../agents/personas.js";

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;

// Flavor NPCs (workshop_tech, kitchen_cook, ...) never move, so their blocking
// positions are computed once at boot. Agent-driven NPCs (lab_scientist,
// theoretical_scientist - see agents/personas.ts) are excluded here since they move at
// runtime; their current position is read live from agentStates below instead.
const npcPixelPositions = mapMeta.npcs
  .filter((npc) => !(npc.npcId in AGENT_PERSONAS))
  .map((npc) => ({ x: npc.x * TILE_WIDTH, y: npc.y * TILE_HEIGHT }));

export function startGameLoop(io: IoServer): () => void {
  const tickMs = 1000 / TICK_RATE_HZ;
  const dt = tickMs / 1000;
  let tick = 0;

  const interval = setInterval(() => {
    tick++;
    for (const player of players.values()) {
      const { dx, dy } = player.input;
      if (dx === 0 && dy === 0) continue;

      const isEntityBlocked = (x: number, y: number): boolean => {
        for (const other of players.values()) {
          if (other.id === player.id) continue;
          if (entitiesOverlap(x, y, other.x, other.y)) return true;
        }
        if (npcPixelPositions.some((npc) => entitiesOverlap(x, y, npc.x, npc.y))) return true;
        return Object.values(agentStates).some((agent) => entitiesOverlap(x, y, agent.x, agent.y));
      };

      const { x, y } = resolveMove(player.x, player.y, dx, dy, dt, isEntityBlocked);
      player.x = x;
      player.y = y;
    }
    stepAllAgentsMovement(dt);
    io.emit("state_sync", { tick, players: allPlayerStates(), agents: agentNpcStates() });
  }, tickMs);

  return () => clearInterval(interval);
}
