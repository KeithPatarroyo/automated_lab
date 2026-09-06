import type { Server, Socket } from "socket.io";
import { nanoid } from "nanoid";
import type { ClientToServerEvents, ServerToClientEvents } from "@lab/shared";
import { INTERACT_RANGE_TILES } from "@lab/shared";
import { mapMeta, randomSpawn, TILE_WIDTH, TILE_HEIGHT } from "../data/mapMeta.js";
import { getNpcLines } from "../data/npcDialogue.js";
import {
  addPlayer,
  allPlayerStates,
  chatLog,
  players,
  pushChatMessage,
  publicPlayerState,
  removePlayer,
  setInput,
} from "../game/state.js";
import { askFast, GeminiClientError, type TerminalTurn } from "../ai/geminiClient.js";
import { agentLogTail, agentNpcStates, agentStates, memoryStore } from "../agents/runtime.js";
import { getPersona } from "../agents/personas.js";
import { buildTerminalSystemPrompt, buildTerminalVisualization } from "../science/terminalVisualization.js";

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const INTERACT_RANGE_PX = INTERACT_RANGE_TILES * TILE_WIDTH;

interface ComputerSession {
  socketId: string;
  computerId: string;
  history: TerminalTurn[];
}

const computerSessions = new Map<string, ComputerSession>();

interface NpcChatSession {
  socketId: string;
  npcId: string;
  history: TerminalTurn[];
}

const npcChatSessions = new Map<string, NpcChatSession>();

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function registerSocketHandlers(io: IoServer, socket: IoSocket): void {
  socket.on("join", ({ username }) => {
    const clean = username.trim().slice(0, 24) || "Player";
    const { x, y } = randomSpawn();
    const player = addPlayer(socket.id, clean, x, y);

    socket.emit("join_ack", {
      playerId: socket.id,
      players: allPlayerStates(),
      mapMeta,
      chatLogTail: chatLog.slice(-50),
      agents: agentNpcStates(),
      agentLogTail: agentLogTail(50),
    });
    socket.broadcast.emit("player_joined", { player: publicPlayerState(player) });
  });

  socket.on("move", ({ seq, dx, dy }) => {
    setInput(socket.id, seq, dx, dy);
  });

  socket.on("chat_message", ({ text }) => {
    const player = players.get(socket.id);
    if (!player) return;
    const trimmed = text.trim().slice(0, 500);
    if (!trimmed) return;
    const msg = {
      id: nanoid(),
      playerId: socket.id,
      username: player.username,
      text: trimmed,
      ts: Date.now(),
    };
    pushChatMessage(msg);
    io.emit("chat_message", msg);
  });

  socket.on("npc_interact", ({ npcId }) => {
    const player = players.get(socket.id);
    if (!player) return;
    const npc = mapMeta.npcs.find((n) => n.npcId === npcId);
    if (!npc) return;
    const npcPx = npc.x * TILE_WIDTH;
    const npcPy = npc.y * TILE_HEIGHT;
    if (distance(player.x, player.y, npcPx, npcPy) > INTERACT_RANGE_PX) return;
    const lines = getNpcLines(npcId);
    if (!lines) return;
    socket.emit("npc_dialogue", { npcId, lines });
  });

  socket.on("computer_open", ({ computerId }) => {
    const player = players.get(socket.id);
    if (!player) return;
    const computer = mapMeta.computers.find((c) => c.computerId === computerId);
    if (!computer) return;
    const cx = computer.x * TILE_WIDTH;
    const cy = computer.y * TILE_HEIGHT;
    if (distance(player.x, player.y, cx, cy) > INTERACT_RANGE_PX) return;

    const sessionId = nanoid();
    computerSessions.set(sessionId, { socketId: socket.id, computerId, history: [] });
    const visualization = buildTerminalVisualization(computerId === "lab_terminal" ? "experimental" : "theoretical");
    socket.emit("computer_opened", { computerId, sessionId, visualization });
  });

  socket.on("computer_message", async ({ sessionId, text }) => {
    const session = computerSessions.get(sessionId);
    if (!session || session.socketId !== socket.id) return;
    const trimmed = text.trim().slice(0, 2000);
    if (!trimmed) return;

    const perspective = session.computerId === "lab_terminal" ? "experimental" : "theoretical";
    const groundingAgentId = session.computerId === "lab_terminal" ? "lab_scientist" : "theoretical_scientist";
    const visualization = buildTerminalVisualization(perspective);

    session.history.push({ role: "user", text: trimmed });
    try {
      const systemPrompt = buildTerminalSystemPrompt(session.computerId, memoryStore.recent(groundingAgentId, 6), visualization);
      const reply = await askFast(session.history, systemPrompt);
      session.history.push({ role: "assistant", text: reply });
      socket.emit("computer_response", { sessionId, text: reply, visualization });
    } catch (err) {
      const message = err instanceof GeminiClientError ? err.message : "The terminal is unavailable right now.";
      socket.emit("computer_error", { sessionId, message });
    }
  });

  socket.on("computer_close", ({ sessionId }) => {
    computerSessions.delete(sessionId);
  });

  socket.on("npc_chat_open", ({ npcId }) => {
    const player = players.get(socket.id);
    if (!player) return;
    const persona = getPersona(npcId);
    const agent = agentStates[npcId];
    if (!persona || !agent) return;
    if (distance(player.x, player.y, agent.x, agent.y) > INTERACT_RANGE_PX) return;

    const sessionId = nanoid();
    npcChatSessions.set(sessionId, { socketId: socket.id, npcId, history: [] });
    socket.emit("npc_chat_opened", { npcId, sessionId });
  });

  socket.on("npc_chat_message", async ({ sessionId, text }) => {
    const session = npcChatSessions.get(sessionId);
    if (!session || session.socketId !== socket.id) return;
    const trimmed = text.trim().slice(0, 2000);
    if (!trimmed) return;
    const persona = getPersona(session.npcId);
    if (!persona) return;

    session.history.push({ role: "user", text: trimmed });
    try {
      const recentMemory = memoryStore
        .recent(session.npcId, 6)
        .map((m) => `[${m.kind}] ${m.text}`)
        .join("\n");
      const grounding =
        `Recent activity/memory:\n${recentMemory || "(nothing yet)"}\n\n` +
        "A human researcher has walked up and is talking to you right now. Stay in character, keep replies " +
        "conversational and under ~120 words unless they ask for more detail.";
      const reply = await askFast(session.history, `${persona.systemPrompt}\n\n${grounding}`);
      session.history.push({ role: "assistant", text: reply });
      memoryStore.record(session.npcId, "chat", `A visitor asked: "${trimmed}" - I said: "${reply}"`);
      socket.emit("npc_chat_response", { sessionId, text: reply });
    } catch (err) {
      const message = err instanceof GeminiClientError ? err.message : "This character is unavailable right now.";
      socket.emit("npc_chat_error", { sessionId, message });
    }
  });

  socket.on("npc_chat_close", ({ sessionId }) => {
    npcChatSessions.delete(sessionId);
  });

  socket.on("disconnect", () => {
    removePlayer(socket.id);
    for (const [sessionId, session] of computerSessions) {
      if (session.socketId === socket.id) computerSessions.delete(sessionId);
    }
    for (const [sessionId, session] of npcChatSessions) {
      if (session.socketId === socket.id) npcChatSessions.delete(sessionId);
    }
    io.emit("player_left", { playerId: socket.id });
  });
}
