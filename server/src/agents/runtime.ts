import type { Server } from "socket.io";
import { nanoid } from "nanoid";
import type { AgentLogEntry, AgentNpcState, ClientToServerEvents, ServerToClientEvents } from "@lab/shared";
import { askAgent } from "../ai/geminiClient.js";
import { mapMeta, TILE_WIDTH, TILE_HEIGHT, isBlocked } from "../data/mapMeta.js";
import { SIMULATION_MODE } from "../env.js";
import { AGENT_PERSONAS } from "./personas.js";
import { PersistedMemoryStore } from "./persistedMemoryStore.js";
import {
  applyAction,
  applyStreakGuard,
  buildStreakNote,
  type CallAgentLLM,
  decideNextAction,
  generateConversationLine,
  initialAgentState,
  stepAgentMovement,
  type AgentRuntimeState,
  type ConversationLine,
} from "./agentEngine.js";
import { allRuns, getTarget, hydrateExperimentLog, recentRuns } from "../science/experimentLog.js";
import { openDb } from "../db/index.js";
import { bakeReplay, ReplayPlayer } from "../replay/replayEngine.js";

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;

// Everything below is hydrated from (and written through to) this on startup - agent
// memory, the experiment log/target, the human-visible activity feed, and each agent's
// last known position/streak. A human's own position/chat isn't persisted - they're
// just an observer for now (see the v2 roadmap), nothing about a session is worth
// keeping across a restart yet.
const db = openDb();
hydrateExperimentLog(db);

// Timestamped feed of agent decisions/movement, shown at the bottom of the web client
// (separate from in-world chat) - same ring-buffer + tail pattern as game/state.ts's
// chatLog, so a client joining mid-session sees recent history via join_ack, then live
// entries via the "agent_log" event.
const AGENT_LOG_LIMIT = 200;
const agentLog: AgentLogEntry[] = db.loadRecentAgentLog(AGENT_LOG_LIMIT);
let ioRef: IoServer | null = null;

function logAgentEvent(npcId: string, text: string): void {
  console.log(`[agent:${npcId}] ${text}`);
  const entry: AgentLogEntry = { id: nanoid(), ts: Date.now(), npcId, text };
  agentLog.push(entry);
  if (agentLog.length > AGENT_LOG_LIMIT) agentLog.shift();
  db.saveAgentLogEntry(entry);
  ioRef?.emit("agent_log", entry);
}

export function agentLogTail(limit: number): AgentLogEntry[] {
  return agentLog.slice(-limit);
}

// Background agent "thinking" cadence - deliberately coarse. Real LLM calls per agent
// on every physics tick would be both slow and expensive; a few minutes between
// decisions is plenty for a background presence a human only checks in on
// occasionally, and each agent skips its own decision entirely while still mid-move
// (see decisionTick below), so this is an upper bound on call frequency, not a fixed rate.
const DECISION_INTERVAL_MS = 2 * 60 * 1000;

export const memoryStore = new PersistedMemoryStore(db, Object.keys(AGENT_PERSONAS));

// Only set in replay mode - the baked-once source of truth stepAllAgentsMovement reads
// from every tick instead of running the live decision loop. See replay/replayEngine.ts.
let replayPlayer: ReplayPlayer | null = null;

function buildInitialAgentStates(): Record<string, AgentRuntimeState> {
  if (SIMULATION_MODE === "replay") {
    const baked = bakeReplay(db, Object.keys(AGENT_PERSONAS), mapMeta, TILE_WIDTH, TILE_HEIGHT, isBlocked);
    replayPlayer = new ReplayPlayer(baked);
    const frames = replayPlayer.initialFrames();
    return Object.fromEntries(
      Object.keys(AGENT_PERSONAS).map((npcId) => {
        const frame = frames[npcId];
        const state: AgentRuntimeState = {
          npcId,
          x: frame.x,
          y: frame.y,
          dir: frame.dir,
          activity: frame.activity,
          destination: null,
          path: [],
          lastActionSignature: null,
          actionStreak: 0,
        };
        return [npcId, state];
      }),
    );
  }

  return Object.fromEntries(
    Object.keys(AGENT_PERSONAS).map((npcId) => {
      const state = initialAgentState(npcId, mapMeta, TILE_WIDTH, TILE_HEIGHT, isBlocked);
      // A saved position/streak overrides the fresh spawn above, so an agent resumes
      // roughly where it left off instead of teleporting back to its map spawn point on
      // every restart. Its route (destination/path) is deliberately NOT restored - that's
      // transient, cheaply replanned on the next decision, and could reference a since-
      // edited map if Keith changed the layout between restarts.
      const snapshot = db.loadAgentSnapshot(npcId);
      if (snapshot) {
        state.x = snapshot.x;
        state.y = snapshot.y;
        state.dir = snapshot.dir;
        state.activity = snapshot.activity === "moving" ? "idle" : snapshot.activity;
        state.lastActionSignature = snapshot.lastActionSignature;
        state.actionStreak = snapshot.actionStreak;
      }
      return [npcId, state];
    }),
  );
}

export const agentStates: Record<string, AgentRuntimeState> = buildInitialAgentStates();

function saveAllAgentSnapshots(): void {
  for (const state of Object.values(agentStates)) {
    db.saveAgentSnapshot({
      npcId: state.npcId,
      x: state.x,
      y: state.y,
      dir: state.dir,
      activity: state.activity,
      lastActionSignature: state.lastActionSignature,
      actionStreak: state.actionStreak,
    });
  }
}

/** Call once during server shutdown (after stopping the timers startAgentRuntime
 * returned) to capture each agent's final position and close the database cleanly.
 * Skips saving a snapshot in replay mode - a replayed position is fabricated, not a
 * real agent state, and must never overwrite the real recorded snapshot it came from. */
export function shutdownAgentRuntime(): void {
  if (SIMULATION_MODE !== "replay") saveAllAgentSnapshots();
  db.close();
}

// Safety net: if an agent has been "moving" toward a destination for longer than this,
// something's wrong (e.g. the destination tile turned out to be unreachable) - give up
// and go idle rather than staying stuck forever. Without this, a wedged agent also never
// decides anything else again, since decisionTick deliberately skips deciding while
// still mid-move. Generous relative to how long any on-map walk should actually take
// (see AGENT_SPEED_PX_PER_SEC in agentEngine.ts).
const MOVE_TIMEOUT_MS = 15_000;
const movingSince = new Map<string, number>();

// All-time stats per mechanism, independent of the 8-entry recent-memory window a
// decision otherwise only sees - without this, a mechanism a few decisions old simply
// disappears from the model's awareness (observed directly: a 3-hour run swept all
// three mechanisms once, then locked onto whichever one happened to fill recent memory
// for the rest of the run, never revisiting the others). Deliberately all-time rather
// than recency-limited, unlike everything else the decision prompt is built from.
function mechanismSummary(): string {
  const runs = allRuns();
  if (runs.length === 0) return "no runs yet";
  const target = getTarget();
  const byMechanism = new Map<string, { count: number; best: number }>();
  for (const r of runs) {
    const value = r.measured[target.property];
    const entry = byMechanism.get(r.mechanism) ?? { count: 0, best: -Infinity };
    entry.count++;
    entry.best = Math.max(entry.best, value);
    byMechanism.set(r.mechanism, entry);
  }
  return Array.from(byMechanism.entries())
    .map(([mechanism, s]) => `${mechanism}: ${s.count} runs, best ${target.property}=${s.best.toFixed(2)}`)
    .join("; ");
}

/** Nearest-anchor guess at where an agent currently is, for the model's own
 * self-description in the decision prompt - anchored on the same four map objects
 * resolveWaypoint uses (see agentEngine.ts's WAYPOINT_ANCHORS), so "current location"
 * and "places I can move to" stay in sync as a set. */
function locationLabel(state: AgentRuntimeState): string {
  const lab = mapMeta.computers.find((c) => c.computerId === "lab_terminal");
  const office = mapMeta.computers.find((c) => c.computerId === "office_terminal");
  const workshop = mapMeta.npcs.find((n) => n.npcId === "workshop_tech");
  const kitchen = mapMeta.npcs.find((n) => n.npcId === "kitchen_cook");
  const distTo = (px: number, py: number) => Math.hypot(state.x - px * TILE_WIDTH, state.y - py * TILE_HEIGHT);

  const candidates: { label: string; dist: number }[] = [
    lab && { label: "the Primary Lab, near the automated-experiment terminal", dist: distTo(lab.x, lab.y) },
    office && { label: "the Office, near the office terminal", dist: distTo(office.x, office.y) },
    workshop && { label: "the Workshop", dist: distTo(workshop.x, workshop.y) },
    kitchen && { label: "the Kitchen", dist: distTo(kitchen.x, kitchen.y) },
  ].filter((c): c is { label: string; dist: number } => !!c);

  if (candidates.length === 0) return "an unknown location";
  return candidates.reduce((best, c) => (c.dist < best.dist ? c : best)).label;
}

async function decisionTick(npcId: string): Promise<void> {
  const state = agentStates[npcId];
  const persona = AGENT_PERSONAS[npcId];
  if (!state || !persona) return;
  if (conversationInProgress) return; // let the agent-to-agent conversation finish first
  if (state.activity === "moving" && state.destination) return; // let them arrive first

  const target = getTarget();
  const runs = recentRuns(5);
  const runsSummary = runs.length
    ? runs
        .map((r) => `${r.mechanism} run, ${target.property}=${r.measured[target.property].toFixed(2)}, meetsTarget=${r.meetsTarget}`)
        .join("; ")
    : "no runs yet";

  const decided = await decideNextAction(
    {
      persona,
      locationLabel: locationLabel(state),
      recentMemory: memoryStore.recent(npcId, 8),
      recentRunsSummary: runsSummary,
      mechanismSummary: persona.role === "experimentalist" ? mechanismSummary() : undefined,
      streakNote: buildStreakNote(state),
      timeOfDayLabel: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    },
    (history, systemPrompt) => askAgent(history, systemPrompt),
  );

  // "Annealing" backstop: if this agent has repeated the exact same action many times
  // in a row despite the streak nudge above, force a different one regardless of what
  // the model said this time - see agentEngine.ts's applyStreakGuard for the thresholds.
  const action = applyStreakGuard(state, decided, persona);
  const wasOverridden = action !== decided;

  applyAction(state, action, { memory: memoryStore, mapMeta, tileWidth: TILE_WIDTH, tileHeight: TILE_HEIGHT, isTileBlocked: isBlocked });
  db.saveAgentSnapshot({
    npcId: state.npcId,
    x: state.x,
    y: state.y,
    dir: state.dir,
    activity: state.activity,
    lastActionSignature: state.lastActionSignature,
    actionStreak: state.actionStreak,
  });

  const prefix = wasOverridden ? "\u{1F9EA} " : "";
  if (action.kind === "move") {
    logAgentEvent(npcId, `${prefix}\u{1F6B6} MOVE -> ${action.destination} - ${action.reason}`);
  } else {
    logAgentEvent(npcId, `${prefix}${action.kind} - ${action.reason}`);
  }
}

// --- agent-to-agent conversation ----------------------------------------------------
// Triggered when the two agents find themselves stationary and physically next to each
// other (e.g. one visits the other's terminal - see personas.ts's slotIndex, which is
// exactly what keeps them from literally standing on top of each other when this
// happens). A short two-line exchange, grounded in each speaker's own real memory.

// Generous relative to a slot-adjacent standing distance (one tile apart, ~16px on this
// map) so minor pixel-level positioning differences don't matter, but still tight enough
// that two agents merely in the same large room, far apart, won't trigger it.
const CONVERSATION_TRIGGER_DISTANCE_PX = TILE_WIDTH * 2;

let conversationInProgress = false;
// Edge-triggered on the not-near -> near transition (see checkForConversation) rather
// than time-based, so agents don't repeatedly strike up new conversations every few
// minutes just for continuing to stand next to each other - only when they newly arrive.
let wasNear = false;

function checkForConversation(): void {
  if (conversationInProgress) return;
  const a = agentStates["lab_scientist"];
  const b = agentStates["theoretical_scientist"];
  if (!a || !b) return;
  // Only strike up a conversation once both have actually stopped, not while one is
  // mid-walk (e.g. just passing near the other en route somewhere else).
  if (a.activity === "moving" || b.activity === "moving") {
    wasNear = false;
    return;
  }
  const near = Math.hypot(a.x - b.x, a.y - b.y) <= CONVERSATION_TRIGGER_DISTANCE_PX;
  if (near && !wasNear) {
    conversationInProgress = true;
    void runConversation().finally(() => {
      conversationInProgress = false;
    });
  }
  wasNear = near;
}

async function runConversation(): Promise<void> {
  const initiatorId = "lab_scientist";
  const responderId = "theoretical_scientist";
  const initiator = AGENT_PERSONAS[initiatorId];
  const responder = AGENT_PERSONAS[responderId];
  const initiatorState = agentStates[initiatorId];
  const responderState = agentStates[responderId];
  if (!initiator || !responder || !initiatorState || !responderState) return;

  initiatorState.activity = "conversing";
  responderState.activity = "conversing";
  const location = locationLabel(initiatorState);
  const transcript: ConversationLine[] = [];
  const callLLM: CallAgentLLM = (history, systemPrompt) => askAgent(history, systemPrompt);

  const line1 = await generateConversationLine(
    { speaker: initiator, listener: responder, locationLabel: location, speakerMemory: memoryStore.recent(initiatorId, 6), transcriptSoFar: transcript },
    callLLM,
  );
  transcript.push({ npcId: initiatorId, text: line1 });
  memoryStore.record(initiatorId, "chat", `Ran into ${responder.displayName} and said: "${line1}"`);
  logAgentEvent(initiatorId, `\u{1F4AC} ${line1}`);

  const line2 = await generateConversationLine(
    { speaker: responder, listener: initiator, locationLabel: location, speakerMemory: memoryStore.recent(responderId, 6), transcriptSoFar: transcript },
    callLLM,
  );
  memoryStore.record(responderId, "chat", `${initiator.displayName} said: "${line1}" - I replied: "${line2}"`);
  memoryStore.record(initiatorId, "chat", `${responder.displayName} replied: "${line2}"`);
  logAgentEvent(responderId, `\u{1F4AC} ${line2}`);

  initiatorState.activity = "idle";
  responderState.activity = "idle";
  saveAllAgentSnapshots();
}

// Position drifts every physics tick while an agent is moving, but writing that to
// disk 20x/second per agent would be wasteful - a snapshot is already saved after every
// decision (see decisionTick above), this just covers the gap while mid-route so a
// crash doesn't lose more than ~10s of walking, without hammering the database.
const SNAPSHOT_INTERVAL_MS = 10_000;

export function startAgentRuntime(io: IoServer): () => void {
  ioRef = io;
  if (SIMULATION_MODE === "replay") {
    console.log("[replay] running a recorded session on a loop - no Gemini calls for agent decisions (npc chat still calls Gemini normally).");
    return () => {}; // nothing to tear down - the replay clock advances via stepAllAgentsMovement
  }
  const timers = Object.keys(AGENT_PERSONAS).map((npcId, i) => {
    // Stagger agents so they don't all call the LLM in the same instant.
    const offset = i * 10_000;
    const id = setTimeout(() => {
      void decisionTick(npcId);
      const interval = setInterval(() => void decisionTick(npcId), DECISION_INTERVAL_MS);
      timers.push(interval as unknown as ReturnType<typeof setTimeout>);
    }, offset);
    return id;
  });
  const snapshotInterval = setInterval(saveAllAgentSnapshots, SNAPSHOT_INTERVAL_MS);
  return () => {
    timers.forEach((t) => clearTimeout(t));
    clearInterval(snapshotInterval);
  };
}

function emitReplayLogLine(npcId: string, text: string): void {
  console.log(`[replay:${npcId}] ${text}`);
  const entry: AgentLogEntry = { id: nanoid(), ts: Date.now(), npcId, text };
  agentLog.push(entry);
  if (agentLog.length > AGENT_LOG_LIMIT) agentLog.shift();
  ioRef?.emit("agent_log", entry);
  // Deliberately no db.saveAgentLogEntry - replay is read-only with respect to the
  // recording it plays back; it must never write fabricated events into real history.
}

function stepReplay(dt: number): void {
  if (!replayPlayer) return;
  const { frames, dueLogLines } = replayPlayer.tick(dt * 1000);
  for (const [npcId, frame] of Object.entries(frames)) {
    const state = agentStates[npcId];
    if (!state) continue;
    state.x = frame.x;
    state.y = frame.y;
    state.dir = frame.dir;
    state.activity = frame.activity;
  }
  for (const seg of dueLogLines) emitReplayLogLine(seg.npcId, seg.logText);
}

/** Called every physics tick from game/loop.ts, same as player movement. */
export function stepAllAgentsMovement(dt: number): void {
  if (SIMULATION_MODE === "replay") {
    stepReplay(dt);
    return;
  }
  const now = Date.now();
  for (const state of Object.values(agentStates)) {
    const wasMoving = state.activity === "moving" && state.destination !== null;

    if (wasMoving) {
      const startedAt = movingSince.get(state.npcId) ?? now;
      movingSince.set(state.npcId, startedAt);
      if (now - startedAt > MOVE_TIMEOUT_MS) {
        logAgentEvent(state.npcId, "⚠️ stuck trying to reach its destination - giving up and going idle");
        state.destination = null;
        state.activity = "idle";
        movingSince.delete(state.npcId);
        continue;
      }
    } else {
      movingSince.delete(state.npcId);
    }

    stepAgentMovement(state, dt, TILE_WIDTH, TILE_HEIGHT, (tx, ty) => isBlocked(tx, ty));
    if (wasMoving && state.destination === null) {
      logAgentEvent(state.npcId, `\u{1F4CD} arrived at (${Math.round(state.x)}, ${Math.round(state.y)})`);
      movingSince.delete(state.npcId);
    }
  }
  checkForConversation();
}

/** Public snapshot broadcast to clients every tick (join_ack + state_sync) - just the
 * fields a renderer needs, not the full runtime state (destination, etc). */
export function agentNpcStates(): AgentNpcState[] {
  return Object.values(agentStates).map((s) => ({ npcId: s.npcId, x: s.x, y: s.y, dir: s.dir, activity: s.activity }));
}
