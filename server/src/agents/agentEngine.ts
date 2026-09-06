import type { AgentActivity, Direction, MapMeta } from "@lab/shared";
import { PLAYER_SPEED_PX_PER_SEC, resolveMove } from "@lab/shared";
import type { TerminalTurn } from "../ai/geminiClient.js";
import type { MemoryEntry, MemoryStore } from "./memoryStore.js";
import { type AgentPersona, type Waypoint, getPersona } from "./personas.js";
import type { FaultMechanism } from "../science/crystalDomain.js";
import { formatSequence, generateConfig, makeRng, measure, proposeNextConfig } from "../science/crystalDomain.js";
import { type ExperimentRun, getTarget, recentRuns, recordRun } from "../science/experimentLog.js";
import { findPath } from "./pathfinding.js";

const AGENT_SPEED_PX_PER_SEC = 70; // slower than a human player's 110 - reads as unhurried background activity.
// Must stay comfortably above the max distance a single tick can cover (at the live
// tick rate, 70px/s * 1/20s = 3.5px), or the final approach to a waypoint can overshoot
// back and forth forever without ever landing inside the arrival radius - found via the
// replay bake's coarser step size making the oscillation obvious, but the same failure
// mode is latent in live movement too at a tight enough epsilon/angle combination.
const ARRIVAL_EPSILON_PX = 6;

export interface AgentRuntimeState {
  npcId: string;
  x: number;
  y: number;
  dir: Direction;
  activity: AgentActivity;
  /** The immediate next waypoint being walked toward - null means not moving. */
  destination: { x: number; y: number } | null;
  /** Remaining waypoints after `destination`, from findPath() - each one gets promoted
   * into `destination` in turn as the agent arrives at the current one. Straight-line
   * movement toward a single far-off destination reliably gets stuck on any wall not on
   * the direct line to it (observed directly: 62% of move attempts failed this way over
   * a day-long run); walking a precomputed tile path avoids that entirely. */
  path: { x: number; y: number }[];
  /** Signature of the last action this agent actually took (see actionSignature) and
   * how many decisions in a row it's matched - used by applyStreakGuard to break the
   * model out of repeating itself. Reset to null/0 for a freshly spawned agent. */
  lastActionSignature: string | null;
  actionStreak: number;
}

export type AgentAction =
  | { kind: "move"; destination: Waypoint; reason: string }
  | { kind: "run_experiment"; mechanism: FaultMechanism; reason: string }
  | { kind: "analyze"; reason: string }
  | { kind: "idle"; reason: string };

const ALLOWED_ACTIONS_BY_ROLE: Record<AgentPersona["role"], AgentAction["kind"][]> = {
  experimentalist: ["move", "run_experiment", "idle"],
  theorist: ["move", "analyze", "idle"],
};

// --- waypoints ----------------------------------------------------------------------

/** Where each named waypoint's position comes from on the map. "lab_bench"/"office_desk"
 * are real computer-terminal objects agents actually interact with (open a session,
 * etc.) - "workshop"/"kitchen" have no terminal, so they're anchored on the existing
 * static flavor NPCs already placed there (workshop_tech, kitchen_cook), requiring no
 * new map objects. The distinction matters for `excludeCenter` below: a computer's own
 * tile is fine to stand on (that's where the prop is, the agent is "using" it), but an
 * npc's own tile already has a character sprite rendered there - standing on it too
 * would visually overlap the static NPC, so those candidates get excluded. */
const WAYPOINT_ANCHORS: Record<Waypoint, { kind: "computer" | "npc"; id: string }> = {
  lab_bench: { kind: "computer", id: "lab_terminal" },
  office_desk: { kind: "computer", id: "office_terminal" },
  workshop: { kind: "npc", id: "workshop_tech" },
  kitchen: { kind: "npc", id: "kitchen_cook" },
};

// Explicit (dx, dy) tile offset from a waypoint's anchor for one specific agent - used
// when the generic slotIndex ring-search (WAYPOINT_SLOT_OVERRIDES below) isn't precise
// enough for a specific correction ("exactly 3 tiles to the right" isn't something a
// "pick the Nth-nearest walkable tile" search can target reliably - which candidate
// ring position corresponds to a given direction/distance is itself an accident of
// local wall geometry, the same issue WAYPOINT_SLOT_OVERRIDES exists to patch around,
// just needing a more precise fix here). Checked before slotIndex; falls back to the
// slotIndex path if the exact tile turns out to be blocked.
const WAYPOINT_TILE_OFFSETS: Partial<Record<Waypoint, Record<string, { dx: number; dy: number }>>> = {
  kitchen: {
    // 3 tiles right of where he previously stood (kitchen_cook's own tile - 1, i.e.
    // dx=-1) - kitchen_cook's tile is dx=0, so the target is dx=(-1+3)=2.
    theoretical_scientist: { dx: 2, dy: 0 },
  },
};

/** Resolves a named waypoint to a pixel position from the live map data (see
 * WAYPOINT_ANCHORS for what each one is anchored to). Both agents' movement targets go
 * through this rather than their own NPC spawn object, so movement works even before
 * every agent has a placed NPC object on the map.
 *
 * A computer object's own marker position is frequently ON a blocked furniture/pc tile
 * (it marks where the desk/terminal prop itself is) - a human player only needs to
 * stand within INTERACT_RANGE_TILES of it, never on it, but an agent's destination
 * needs to be somewhere it can actually stand. If `isTileBlocked` says the marker's own
 * tile is blocked, this searches outward for the nearest walkable tile instead -
 * otherwise the agent would approach, permanently fail to get any closer (its collision
 * box can never occupy a blocked tile), and never reach the arrival threshold.
 *
 * `slotIndex` (see AgentPersona.slotIndex) picks which nearby-tile candidate this agent
 * gets - so two agents sent to the same waypoint end up in adjacent squares rather than
 * stacked on the exact same tile (or, for an npc-anchored waypoint, on top of the
 * static NPC standing there). `npcId`, if given, is checked against
 * WAYPOINT_TILE_OFFSETS first for an exact per-agent placement, taking priority over
 * slotIndex entirely. */
export function resolveWaypoint(
  waypoint: Waypoint,
  mapMeta: MapMeta,
  tileWidth: number,
  tileHeight: number,
  isTileBlocked: (tx: number, ty: number) => boolean = () => false,
  slotIndex = 0,
  npcId?: string,
): { x: number; y: number } {
  const anchor = WAYPOINT_ANCHORS[waypoint];
  const anchorPos =
    anchor.kind === "computer"
      ? mapMeta.computers.find((c) => c.computerId === anchor.id)
      : mapMeta.npcs.find((n) => n.npcId === anchor.id);
  if (!anchorPos) {
    throw new Error(`Map is missing the "${anchor.id}" ${anchor.kind} needed to resolve waypoint "${waypoint}"`);
  }
  // mapMeta.computers/npcs positions are already in tile units (see data/mapMeta.ts's
  // toTile()), not pixels - only the return value below is converted to pixels.
  const tx = Math.floor(anchorPos.x);
  const ty = Math.floor(anchorPos.y);

  const exactOffset = npcId ? WAYPOINT_TILE_OFFSETS[waypoint]?.[npcId] : undefined;
  if (exactOffset) {
    const ex = tx + exactOffset.dx;
    const ey = ty + exactOffset.dy;
    if (!isTileBlocked(ex, ey)) {
      return { x: ex * tileWidth + tileWidth / 2, y: ey * tileHeight + tileHeight / 2 };
    }
    // Falls through to the slotIndex path below if the exact tile is blocked (e.g. the
    // map changed since this offset was tuned).
  }

  const candidates = nearestWalkableTiles(tx, ty, isTileBlocked, slotIndex + 1, anchor.kind === "npc");
  const { x: walkTx, y: walkTy } = candidates[Math.min(slotIndex, candidates.length - 1)];
  return { x: walkTx * tileWidth + tileWidth / 2, y: walkTy * tileHeight + tileHeight / 2 };
}

/** Returns up to `count` distinct walkable tiles near (tx, ty), nearest first. Unless
 * `excludeCenter`, (tx,ty) itself is the first candidate if walkable, then an expanding
 * ring search. Always returns at least one tile (falling back to (tx,ty) itself if
 * every nearby tile is blocked), even if that's fewer than requested. */
function nearestWalkableTiles(
  tx: number,
  ty: number,
  isTileBlocked: (tx: number, ty: number) => boolean,
  count: number,
  excludeCenter = false,
): { x: number; y: number }[] {
  const candidates: { x: number; y: number }[] = [];
  if (!excludeCenter && !isTileBlocked(tx, ty)) candidates.push({ x: tx, y: ty });
  for (let radius = 1; radius <= 4 && candidates.length < count; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue; // only the ring's edge, not its interior
        if (!isTileBlocked(tx + dx, ty + dy)) candidates.push({ x: tx + dx, y: ty + dy });
      }
    }
  }
  if (candidates.length === 0) candidates.push({ x: tx, y: ty }); // give up - every nearby tile is blocked
  return candidates;
}

// Which nearby-tile candidate (see resolveWaypoint/nearestWalkableTiles) each agent
// gets is normally just AgentPersona.slotIndex - a global per-agent constant, the same
// at every waypoint. But which physical side that maps to at any given waypoint is an
// accident of local wall/furniture geometry (the ring search happens to prefer -dx
// before +dx, but whether that lands left or right of the *other* agent depends on
// what's blocked nearby), not something intentionally designed - Keith found that out
// the kitchen ended up with lab_scientist on the wrong side of theoretical_scientist.
// Rather than reordering the ring search globally (which would silently reshuffle
// lab_bench/office_desk too, undoing already-approved placements there), this overrides
// the effective slot for specific (npcId, waypoint) pairs only.
const WAYPOINT_SLOT_OVERRIDES: Partial<Record<Waypoint, Record<string, number>>> = {
  // theoretical_scientist is NOT here - it now has an exact WAYPOINT_TILE_OFFSETS entry
  // above instead (checked first, so this slot value would never be reached for it).
  kitchen: { lab_scientist: 1 },
};

function effectiveSlotIndex(npcId: string, waypoint: Waypoint): number {
  const override = WAYPOINT_SLOT_OVERRIDES[waypoint]?.[npcId];
  if (override !== undefined) return override;
  return getPersona(npcId)?.slotIndex ?? 0;
}

/** Computes a full tile-by-tile route from the agent's current position to a named
 * waypoint and loads it into state.destination/state.path, replacing whatever route (if
 * any) it was already on. Falls back to walking straight at the final target if the map
 * genuinely has no path there (shouldn't happen on a validated map, but stepAgentMovement
 * plus the stall-timeout safety net in runtime.ts still bound the damage if it ever does). */
export function planRoute(
  state: AgentRuntimeState,
  waypoint: Waypoint,
  mapMeta: MapMeta,
  tileWidth: number,
  tileHeight: number,
  isTileBlocked: (tx: number, ty: number) => boolean = () => false,
): void {
  const slotIndex = effectiveSlotIndex(state.npcId, waypoint);
  const target = resolveWaypoint(waypoint, mapMeta, tileWidth, tileHeight, isTileBlocked, slotIndex, state.npcId);
  const startTile = { x: Math.floor(state.x / tileWidth), y: Math.floor(state.y / tileHeight) };
  const goalTile = { x: Math.floor(target.x / tileWidth), y: Math.floor(target.y / tileHeight) };

  const tilePath = findPath(startTile, goalTile, isTileBlocked, mapMeta.widthTiles, mapMeta.heightTiles);
  const pixelWaypoints = (tilePath ?? [goalTile]).map((t) => ({
    x: t.x * tileWidth + tileWidth / 2,
    y: t.y * tileHeight + tileHeight / 2,
  }));

  if (pixelWaypoints.length === 0) {
    // Already standing on the goal tile - nothing to walk.
    state.destination = null;
    state.path = [];
    state.activity = "idle";
    return;
  }
  state.destination = pixelWaypoints[0];
  state.path = pixelWaypoints.slice(1);
  state.activity = "moving";
}

export function initialAgentState(
  npcId: string,
  mapMeta: MapMeta,
  tileWidth: number,
  tileHeight: number,
  isTileBlocked: (tx: number, ty: number) => boolean = () => false,
): AgentRuntimeState {
  const persona = getPersona(npcId);
  if (!persona) throw new Error(`No persona defined for agent npcId "${npcId}"`);

  const npcSpawn = mapMeta.npcs.find((n) => n.npcId === npcId);
  const { x, y } = npcSpawn
    ? { x: npcSpawn.x * tileWidth, y: npcSpawn.y * tileHeight }
    : resolveWaypoint(persona.home, mapMeta, tileWidth, tileHeight, isTileBlocked, persona.slotIndex, npcId);

  return { npcId, x, y, dir: "up", activity: "idle", destination: null, path: [], lastActionSignature: null, actionStreak: 0 };
}

// --- movement (called every physics tick, like player movement) --------------------

export function stepAgentMovement(
  state: AgentRuntimeState,
  dt: number,
  tileWidth: number,
  tileHeight: number,
  isTileBlocked: (tx: number, ty: number) => boolean,
): void {
  if (!state.destination) return;
  const { x: tx, y: ty } = state.destination;
  const dx = tx - state.x;
  const dy = ty - state.y;
  if (Math.hypot(dx, dy) <= ARRIVAL_EPSILON_PX) {
    state.x = tx;
    state.y = ty;
    if (state.path.length > 0) {
      // More waypoints on this route - promote the next one and keep moving, rather
      // than dropping to idle between each tile of a multi-tile path.
      state.destination = state.path[0];
      state.path = state.path.slice(1);
    } else {
      state.destination = null;
      state.activity = "idle";
    }
    return;
  }

  const stepX: -1 | 0 | 1 = Math.abs(dx) < 1 ? 0 : dx > 0 ? 1 : -1;
  const stepY: -1 | 0 | 1 = Math.abs(dy) < 1 ? 0 : dy > 0 ? 1 : -1;
  // resolveMove always moves at the shared PLAYER_SPEED_PX_PER_SEC - scaling dt down
  // proportionally gets agents their own slower AGENT_SPEED_PX_PER_SEC without forking
  // resolveMove, so agents keep sharing the exact same collision behavior players and
  // the wall layer already agree on.
  const scaledDt = dt * (AGENT_SPEED_PX_PER_SEC / PLAYER_SPEED_PX_PER_SEC);
  const { x, y } = resolveMove(state.x, state.y, stepX, stepY, scaledDt, tileWidth, tileHeight, isTileBlocked);
  state.x = x;
  state.y = y;
  state.dir = stepY < 0 ? "up" : stepY > 0 ? "down" : stepX < 0 ? "left" : stepX > 0 ? "right" : state.dir;
}

// --- decision (called on a coarse interval per agent, not every physics tick) ------

export interface DecisionContext {
  persona: AgentPersona;
  locationLabel: string;
  recentMemory: MemoryEntry[];
  recentRunsSummary: string;
  /** All-time (not just recent-memory-window) stats per mechanism, so a mechanism that
   * scrolled out of `recentMemory` doesn't disappear from the model's awareness -
   * without this, a long run reliably collapses onto whichever mechanism happens to
   * fill the last few memory slots (observed directly - see gemini-model-tiering notes). */
  mechanismSummary?: string;
  /** Set once this agent has repeated the same action several decisions in a row - an
   * explicit nudge for the model to reconsider, before the harder applyStreakGuard
   * override kicks in. */
  streakNote?: string;
  /** Current wall-clock time (e.g. "1:15 PM"), so the model has some basis for deciding
   * "is now a reasonable moment for a lunch/coffee break at the Kitchen" - both personas'
   * system prompts mention taking one around midday, but without an actual notion of
   * time that instruction has nothing to anchor to. */
  timeOfDayLabel: string;
}

export type CallAgentLLM = (history: TerminalTurn[], systemPrompt: string) => Promise<string>;

function buildDecisionPrompt(ctx: DecisionContext): string {
  const allowed = ALLOWED_ACTIONS_BY_ROLE[ctx.persona.role];
  const memoryLines = ctx.recentMemory.length
    ? ctx.recentMemory.map((m) => `- [${m.kind}] ${m.text}`).join("\n")
    : "(no memories yet)";

  return (
    `The current time is ${ctx.timeOfDayLabel}.\n\n` +
    `You are currently at: ${ctx.locationLabel}.\n\n` +
    `Your recent memory:\n${memoryLines}\n\n` +
    `Recent experiment results:\n${ctx.recentRunsSummary}\n\n` +
    (ctx.mechanismSummary ? `All-time stats per faulting mechanism tried so far:\n${ctx.mechanismSummary}\n\n` : "") +
    (ctx.streakNote ? `${ctx.streakNote}\n\n` : "") +
    `Decide your next action. Respond with ONLY a single JSON object, no other text, matching one of these ` +
    `shapes (pick exactly one "kind" from: ${allowed.join(", ")}):\n` +
    `{"kind":"move","destination":"lab_bench"|"office_desk"|"workshop"|"kitchen","reason":"..."}\n` +
    (allowed.includes("run_experiment")
      ? `{"kind":"run_experiment","mechanism":"thermal"|"contaminant"|"growth","reason":"..."}\n`
      : "") +
    (allowed.includes("analyze") ? `{"kind":"analyze","reason":"..."}\n` : "") +
    `{"kind":"idle","reason":"..."}`
  );
}

function fallbackAction(persona: AgentPersona): AgentAction {
  // Used when the LLM is unavailable/unparseable, so the sim keeps making forward
  // progress (no player is watching a background agent silently stall) instead of
  // surfacing an error the way the human-facing terminal does.
  if (persona.role === "experimentalist") {
    return { kind: "run_experiment", mechanism: "growth", reason: "fallback: continuing the closed-loop search" };
  }
  return { kind: "analyze", reason: "fallback: reviewing the latest experiment data" };
}

function parseAction(raw: string, persona: AgentPersona): AgentAction | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("kind" in parsed)) return null;
  const candidate = parsed as { kind?: unknown; destination?: unknown; mechanism?: unknown; reason?: unknown };
  const allowed = ALLOWED_ACTIONS_BY_ROLE[persona.role];
  const reason = typeof candidate.reason === "string" ? candidate.reason : "";

  if (candidate.kind === "move" && allowed.includes("move")) {
    if (typeof candidate.destination === "string" && candidate.destination in WAYPOINT_ANCHORS) {
      return { kind: "move", destination: candidate.destination as Waypoint, reason };
    }
    return null;
  }
  if (candidate.kind === "run_experiment" && allowed.includes("run_experiment")) {
    if (candidate.mechanism === "thermal" || candidate.mechanism === "contaminant" || candidate.mechanism === "growth") {
      return { kind: "run_experiment", mechanism: candidate.mechanism, reason };
    }
    return null;
  }
  if (candidate.kind === "analyze" && allowed.includes("analyze")) {
    return { kind: "analyze", reason };
  }
  if (candidate.kind === "idle") {
    return { kind: "idle", reason };
  }
  return null;
}

export async function decideNextAction(ctx: DecisionContext, callLLM: CallAgentLLM): Promise<AgentAction> {
  try {
    const raw = await callLLM([{ role: "user", text: buildDecisionPrompt(ctx) }], ctx.persona.systemPrompt);
    return parseAction(raw, ctx.persona) ?? fallbackAction(ctx.persona);
  } catch {
    return fallbackAction(ctx.persona);
  }
}

// --- agent-to-agent conversation ----------------------------------------------------
// Triggered when the two agents find themselves physically next to each other (see
// runtime.ts's checkForConversation) - a short in-character exchange, grounded in each
// speaker's own memory so it actually shares real results rather than generic chatter.

export interface ConversationLine {
  npcId: string;
  text: string;
}

export interface ConversationTurnContext {
  speaker: AgentPersona;
  listener: AgentPersona;
  locationLabel: string;
  speakerMemory: MemoryEntry[];
  /** Lines exchanged so far this encounter, oldest first - empty for the opening line. */
  transcriptSoFar: ConversationLine[];
}

function buildConversationPrompt(ctx: ConversationTurnContext): string {
  const memoryLines = ctx.speakerMemory.length
    ? ctx.speakerMemory.map((m) => `- [${m.kind}] ${m.text}`).join("\n")
    : "(no memories yet)";
  const transcriptLines = ctx.transcriptSoFar.length
    ? ctx.transcriptSoFar.map((line) => `${line.npcId === ctx.speaker.npcId ? ctx.speaker.displayName : ctx.listener.displayName}: "${line.text}"`).join("\n")
    : "(nothing said yet - you're the one starting this conversation)";

  return (
    `You've just run into ${ctx.listener.displayName} at ${ctx.locationLabel}.\n\n` +
    `Your recent memory:\n${memoryLines}\n\n` +
    `Conversation so far:\n${transcriptLines}\n\n` +
    `Say ONE natural, in-character line of dialogue (1-2 sentences) - share a quick, specific update on your ` +
    `recent work (reference real numbers/results from your memory if you have them) or respond to what ` +
    `${ctx.listener.displayName} just said. Respond with ONLY the line of dialogue itself - no quotation marks, ` +
    `no narration, no "${ctx.speaker.displayName}:" prefix.`
  );
}

function fallbackConversationLine(ctx: ConversationTurnContext): string {
  // Used when the LLM is unavailable/unparseable - the encounter still produces a
  // plausible (if generic) beat instead of silently skipping the exchange.
  return ctx.transcriptSoFar.length === 0
    ? "Shares a quick update on the latest results before getting back to work."
    : "Nods, taking in the update, and offers a brief thought before heading back to work.";
}

/** Generates one line of dialogue for `ctx.speaker`, given what's been said so far this
 * encounter. Falls back to a scripted line on any failure, same pattern as
 * decideNextAction - a conversation should never hang the sim on a bad/failed call. */
export async function generateConversationLine(ctx: ConversationTurnContext, callLLM: CallAgentLLM): Promise<string> {
  try {
    const raw = await callLLM([{ role: "user", text: buildConversationPrompt(ctx) }], ctx.speaker.systemPrompt);
    const trimmed = raw.trim().replace(/^["']+|["']+$/g, "");
    return trimmed || fallbackConversationLine(ctx);
  } catch {
    return fallbackConversationLine(ctx);
  }
}

// --- streak guard ("annealing" backstop against the model repeating itself) --------

/** How many decisions in a row an action can repeat before buildDecisionPrompt starts
 * explicitly telling the model about the streak (a nudge, not a hard rule). */
export const STREAK_NUDGE_THRESHOLD = 4;
/** How many decisions in a row before applyStreakGuard stops trusting the model and
 * forces a different action outright. Chosen relative to the ~2min decision interval -
 * 8 decisions is ~16 minutes stuck, versus the ~2 hours observed without this guard. */
export const STREAK_OVERRIDE_THRESHOLD = 8;

const MECHANISMS: FaultMechanism[] = ["thermal", "contaminant", "growth"];

export function actionSignature(action: AgentAction): string {
  return action.kind === "run_experiment" ? `run_experiment:${action.mechanism}` : action.kind;
}

export function buildStreakNote(state: AgentRuntimeState): string | undefined {
  if (!state.lastActionSignature || state.actionStreak < STREAK_NUDGE_THRESHOLD) return undefined;
  return (
    `You have chosen "${state.lastActionSignature}" ${state.actionStreak} times in a row. Unless you have a ` +
    `specific strong reason to keep going, consider a different mechanism or checking in with your colleague instead.`
  );
}

function forceVariedAction(persona: AgentPersona, previous: AgentAction, rng: () => number): AgentAction {
  if (persona.role === "experimentalist") {
    const previousMechanism = previous.kind === "run_experiment" ? previous.mechanism : undefined;
    const alternatives = MECHANISMS.filter((m) => m !== previousMechanism);
    const mechanism = alternatives[Math.floor(rng() * alternatives.length)];
    return {
      kind: "run_experiment",
      mechanism,
      reason: `annealing: repeated the same action too many times in a row, forcing a switch to the ${mechanism} mechanism`,
    };
  }
  if (previous.kind !== "move") {
    return {
      kind: "move",
      destination: "lab_bench",
      reason: "annealing: repeated the same action too many times in a row, forcing a check-in at the lab",
    };
  }
  return { kind: "analyze", reason: "annealing: repeated the same action too many times in a row, forcing a return to analysis" };
}

/** Runs after the LLM's decision, not instead of it - the model always gets first say.
 * Tracks state.lastActionSignature/actionStreak as a side effect regardless of whether
 * it overrides anything, so buildStreakNote sees an accurate streak on the next call. */
export function applyStreakGuard(
  state: AgentRuntimeState,
  action: AgentAction,
  persona: AgentPersona,
  rng: () => number = Math.random,
): AgentAction {
  const signature = actionSignature(action);
  const streak = signature === state.lastActionSignature ? state.actionStreak + 1 : 1;

  if (streak < STREAK_OVERRIDE_THRESHOLD) {
    state.lastActionSignature = signature;
    state.actionStreak = streak;
    return action;
  }

  const forced = forceVariedAction(persona, action, rng);
  state.lastActionSignature = actionSignature(forced);
  state.actionStreak = 1;
  return forced;
}

// --- applying a decided action -------------------------------------------------------

export interface ApplyActionDeps {
  memory: MemoryStore;
  mapMeta: MapMeta;
  tileWidth: number;
  tileHeight: number;
  rngSeed?: number;
  isTileBlocked?: (tx: number, ty: number) => boolean;
}

export function applyAction(state: AgentRuntimeState, action: AgentAction, deps: ApplyActionDeps): void {
  deps.memory.record(state.npcId, "action", `Decided to ${action.kind}: ${action.reason}`);

  switch (action.kind) {
    case "move": {
      planRoute(state, action.destination, deps.mapMeta, deps.tileWidth, deps.tileHeight, deps.isTileBlocked);
      return;
    }
    case "run_experiment": {
      state.activity = "running_experiment";
      const rng = makeRng(deps.rngSeed ?? Date.now());
      const target = getTarget();
      const history = recentRuns(50).map((r) => ({ config: r.config, measured: r.measured }));
      const config =
        history.length > 0
          ? proposeNextConfig(history, target, 20, rng, "SiC")
          : generateConfig(action.mechanism, { length: 20 }, rng);
      const measured = measure(config, rng);
      const run = recordRun("lab_scientist", action.mechanism, config, measured);
      deps.memory.record(
        state.npcId,
        "observation",
        `Ran a ${action.mechanism}-faulted ${config.material} growth (${formatSequence(config.sequence)}): ` +
          `information content ${measured.informationContent.toFixed(2)}, bulk modulus ${measured.bulkModulus.toFixed(2)}. ` +
          `${run.meetsTarget ? "This meets the current target spec." : "Does not meet the current target spec yet."}`,
      );
      return;
    }
    case "analyze": {
      state.activity = "analyzing_data";
      const runs = recentRuns(50);
      deps.memory.record(state.npcId, "reflection", summarizeRunsForAnalysis(runs));
      return;
    }
    case "idle": {
      state.activity = "idle";
      return;
    }
  }
}

function summarizeRunsForAnalysis(runs: ExperimentRun[]): string {
  if (runs.length === 0) return "No experiment data yet to analyze.";
  const target = getTarget();
  const hits = runs.filter((r) => r.meetsTarget).length;
  const values = runs.map((r) => r.measured[target.property]);
  const best = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return (
    `Reviewed ${runs.length} recent runs targeting ${target.property} (${target.note}). ` +
    `${hits} of ${runs.length} meet the current spec. Best ${target.property} so far: ${best.toFixed(2)}, ` +
    `average: ${avg.toFixed(2)}.`
  );
}

export function summarizeRunsForHuman(limit = 10): string {
  return summarizeRunsForAnalysis(recentRuns(limit));
}
