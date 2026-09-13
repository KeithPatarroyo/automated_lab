import type { Server, Socket } from "socket.io";
import { nanoid } from "nanoid";
import type { ClientToServerEvents, ServerToClientEvents } from "@lab/shared";
import { INTERACT_RANGE_TILES } from "@lab/shared";
import { mapMeta, randomSpawn, TILE_WIDTH, TILE_HEIGHT } from "../data/mapMeta.js";
import { getNpcLines } from "../data/npcDialogue.js";
import { addPlayer, allPlayerStates, MAX_CONNECTED_HUMANS, players, publicPlayerState, removePlayer, setInput } from "../game/state.js";
import { askFast, GeminiClientError, type TerminalTurn } from "../ai/geminiClient.js";
import { agentLogTail, agentNpcStates, agentStates, getReplayConversationCount, memoryStore } from "../agents/runtime.js";
import { SIMULATION_MODE } from "../env.js";
import { getPersona } from "../agents/personas.js";
import { buildTerminalSystemPrompt, buildTerminalVisualization } from "../science/terminalVisualization.js";
import { authenticate, claimSession, isReservedUsername, releaseSession } from "../accounts/humanAccounts.js";
import { loadHumanSpawn, saveHumanSnapshot } from "../accounts/humanSnapshots.js";
import { db } from "../db/singleton.js";

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const INTERACT_RANGE_PX = INTERACT_RANGE_TILES * TILE_WIDTH;

// Not yet backed by a real computation - see productivity_open below. Revisit once
// there's an actual definition of "productive"/"efficient" for this task worth
// computing from the experiment log.
const PRODUCTIVITY_SCORE_LABEL = "3% more productive than last week";
const EFFICIENCY_SCORE_LABEL = "Energy limits within budget";
// A placeholder for comparing this simulation's synthetic results against real lab
// data, once there's a real experiment to compare against - see README's Metrics
// dashboard section.
const SIMULATION_MATCH_LABEL = "Matching to 85%";

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
  socket.on("join", ({ username, gender }) => {
    if (players.size >= MAX_CONNECTED_HUMANS) {
      socket.emit("join_error", { message: `The lab is full right now (${MAX_CONNECTED_HUMANS}/${MAX_CONNECTED_HUMANS}) - try again in a bit.` });
      return;
    }
    const clean = username.trim().slice(0, 24) || "Player";
    if (isReservedUsername(clean)) {
      socket.emit("join_error", { message: `"${clean}" is reserved - log in instead if that's you.` });
      return;
    }
    const cleanGender = gender === "female" ? "female" : "male";
    const { x, y } = randomSpawn();
    const player = addPlayer(socket.id, clean, x, y, cleanGender);
    db.saveAccessLogEntry({ id: nanoid(), ts: Date.now(), username: clean, accountKey: null });

    socket.emit("join_ack", {
      playerId: socket.id,
      players: allPlayerStates(),
      mapMeta,
      // A Visitor only ever sees chat sent after they join (live, via the
      // chat_message broadcast below) - none of the pre-existing history, which is
      // only ever kept for the two persisted accounts anyway (see the login handler).
      chatLogTail: [],
      agents: agentNpcStates(),
      agentLogTail: agentLogTail(50),
    });
    socket.broadcast.emit("player_joined", { player: publicPlayerState(player) });
  });

  socket.on("login", ({ username, password }) => {
    if (players.size >= MAX_CONNECTED_HUMANS) {
      socket.emit("login_error", { message: `The lab is full right now (${MAX_CONNECTED_HUMANS}/${MAX_CONNECTED_HUMANS}) - try again in a bit.` });
      return;
    }
    const account = authenticate(username, password);
    if (!account) {
      socket.emit("login_error", { message: "Invalid username or password." });
      return;
    }
    if (!claimSession(account.key, socket.id)) {
      socket.emit("login_error", { message: `${account.displayName} is already logged in elsewhere.` });
      return;
    }
    const snapshot = loadHumanSpawn(account.key);
    const spawn = snapshot ?? randomSpawn();
    const player = addPlayer(socket.id, account.displayName, spawn.x, spawn.y, account.gender, account.key, snapshot?.dir);
    db.saveAccessLogEntry({ id: nanoid(), ts: Date.now(), username: account.displayName, accountKey: account.key });

    socket.emit("join_ack", {
      playerId: socket.id,
      players: allPlayerStates(),
      mapMeta,
      // A logged-in account gets its whole persisted chat history back, not just a
      // recent tail - see loadAllPublicChatLog's docstring for why loading it whole is fine.
      chatLogTail: db.loadAllPublicChatLog(),
      agents: agentNpcStates(),
      agentLogTail: agentLogTail(50),
    });
    socket.broadcast.emit("player_joined", { player: publicPlayerState(player) });
  });

  socket.on("productivity_open", () => {
    socket.emit("productivity_data", {
      // Replay has no notion of "cumulative" - it loops the same recording, so this is
      // a live count of chat lines played back since the current loop started (resets
      // each time it wraps), not db.countAgentConversationLines()'s all-time total.
      agentInteractionCount:
        SIMULATION_MODE === "replay" ? getReplayConversationCount() : db.countAgentConversationLines(),
      humanAccessCount: db.countAccessLogEntries(),
      productivityScoreLabel: PRODUCTIVITY_SCORE_LABEL,
      efficiencyScoreLabel: EFFICIENCY_SCORE_LABEL,
      simulationMatchLabel: SIMULATION_MATCH_LABEL,
    });
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
      // Only the two persisted accounts show under their bare name - an anonymous
      // Visitor is labeled so it's clear at a glance who was a guest when Keith/Anna
      // read this back later.
      username: player.accountKey ? player.username : `${player.username} (visitor)`,
      text: trimmed,
      ts: Date.now(),
    };
    io.emit("chat_message", msg);
    db.savePublicChatMessage(msg);
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
    const accountKey = players.get(socket.id)?.accountKey;

    const perspective = session.computerId === "lab_terminal" ? "experimental" : "theoretical";
    const groundingAgentId = session.computerId === "lab_terminal" ? "lab_scientist" : "theoretical_scientist";
    const visualization = buildTerminalVisualization(perspective);

    session.history.push({ role: "user", text: trimmed });
    if (accountKey) {
      db.saveHumanInteractionEntry({
        id: nanoid(),
        ts: Date.now(),
        accountKey,
        kind: "terminal",
        targetId: session.computerId,
        role: "user",
        text: trimmed,
      });
    }
    try {
      const systemPrompt = buildTerminalSystemPrompt(session.computerId, memoryStore.recent(groundingAgentId, 6), visualization);
      const reply = await askFast(session.history, systemPrompt);
      session.history.push({ role: "assistant", text: reply });
      if (accountKey) {
        db.saveHumanInteractionEntry({
          id: nanoid(),
          ts: Date.now(),
          accountKey,
          kind: "terminal",
          targetId: session.computerId,
          role: "assistant",
          text: reply,
        });
      }
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
    const accountKey = players.get(socket.id)?.accountKey;

    session.history.push({ role: "user", text: trimmed });
    if (accountKey) {
      db.saveHumanInteractionEntry({
        id: nanoid(),
        ts: Date.now(),
        accountKey,
        kind: "npc_chat",
        targetId: session.npcId,
        role: "user",
        text: trimmed,
      });
    }
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
      if (accountKey) {
        db.saveHumanInteractionEntry({
          id: nanoid(),
          ts: Date.now(),
          accountKey,
          kind: "npc_chat",
          targetId: session.npcId,
          role: "assistant",
          text: reply,
        });
      }
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
    const player = players.get(socket.id);
    if (player?.accountKey) {
      saveHumanSnapshot(player.accountKey);
    } else if (player) {
      // A Visitor's departure is announced live (same shape as a normal chat message,
      // so the client needs no changes to render it) and saved into the shared public
      // record the same way their own chat now is.
      const departureMsg = {
        id: nanoid(),
        playerId: "system",
        username: "System",
        text: `${player.username} (visitor) has left.`,
        ts: Date.now(),
      };
      io.emit("chat_message", departureMsg);
      db.savePublicChatMessage(departureMsg);
    }
    releaseSession(socket.id);
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
