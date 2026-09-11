import type { AgentActivity, AgentLogEntry, Direction, MapMeta } from "@lab/shared";
import { TICK_RATE_HZ } from "@lab/shared";
import type { Waypoint } from "../agents/personas.js";
import { getPersona } from "../agents/personas.js";
import { initialAgentState, planRoute, stepAgentMovement } from "../agents/agentEngine.js";
import type { Db } from "../db/index.js";

// A gap this long between two consecutive log rows marks the boundary of a session -
// only the most recent session (after the last such gap) gets baked into a replay, so
// a stale earlier recording (or a run of scripted-fallback lines from a quota outage,
// see gemini-model-tiering notes) doesn't get replayed instead of the real one.
const SESSION_GAP_MS = 30 * 60 * 1000;

// How long a non-move activity (running an experiment, analyzing data, idling) stays
// visible before the replay advances to the next recorded decision. The real gap
// between decisions was ~2min of "thinking" with nothing to show for it; holding each
// one for a much shorter, fixed duration is what actually compresses a multi-hour
// recording into a watchable demo loop, rather than a separate speed multiplier on top.
const HOLD_DURATION_MS = 10_000;
// A conversation line is a quick dialogue beat, not a multi-minute decision - held for
// less time than HOLD_DURATION_MS so a two-line exchange doesn't drag the replay out.
const CHAT_HOLD_DURATION_MS = 8_000;

// Simulated-movement step size while baking a "move" segment - matches the live physics
// tick rate exactly, so a baked walk moves the same distance per step live movement
// does (a coarser step risks overshooting the arrival radius on the final approach).
const BAKE_STEP_MS = 1000 / TICK_RATE_HZ;
// Safety cap on how long a single baked walk is allowed to simulate for, in case a
// route can never complete (shouldn't happen on a validated map, but this is offline
// baking at startup, not something that should ever be able to hang the process).
const MAX_WALK_SIM_MS = 60_000;
// Floor for a "move" segment's duration - see the comment where it's used below.
const MIN_MOVE_DISPLAY_MS = 3_000;

interface PositionSample {
  /** Offset in ms from this segment's start. */
  t: number;
  x: number;
  y: number;
  dir: Direction;
}

interface Segment {
  npcId: string;
  /** Offset in ms from the start of the whole baked loop. */
  simStart: number;
  simEnd: number;
  activity: AgentActivity;
  /** The original recorded log line, replayed verbatim at simStart. */
  logText: string;
  /** Present only for "move" segments - sampled positions to interpolate through.
   * Absent (stationary) segments just hold x/y/dir fixed for the whole segment. */
  path?: PositionSample[];
  x: number;
  y: number;
  dir: Direction;
}

export interface ReplayFrame {
  x: number;
  y: number;
  dir: Direction;
  activity: AgentActivity;
}

export interface BakedReplay {
  /** Per-agent segments, sorted by simStart - used for position/activity lookup. */
  byAgent: Record<string, Segment[]>;
  /** All segments across every agent, sorted by simStart - used to know which log
   * lines are due as playback time advances. */
  timeline: Segment[];
  totalDurationMs: number;
  recordingStart: number;
  recordingEnd: number;
  npcIds: string[];
}

function parseKind(
  text: string,
):
  | { kind: "move"; destination: Waypoint }
  | { kind: "run_experiment" | "analyze" | "idle" | "chat" }
  | { kind: "skip" } {
  const clean = text.replace(/^\u{1F9EA}\s*/u, ""); // strip the annealing-override marker, if present
  if (clean.includes("MOVE ->")) {
    const m = clean.match(/MOVE -> (lab_bench|office_desk|workshop|kitchen)/);
    return m ? { kind: "move", destination: m[1] as Waypoint } : { kind: "skip" };
  }
  if (clean.startsWith("\u{1F4AC}")) return { kind: "chat" }; // 💬 agent-to-agent conversation line
  if (clean.startsWith("run_experiment")) return { kind: "run_experiment" };
  if (clean.startsWith("analyze")) return { kind: "analyze" };
  if (clean.startsWith("idle")) return { kind: "idle" };
  return { kind: "skip" }; // "arrived"/"stuck" markers and anything else aren't decisions
}

/** Finds the most recent contiguous session in the full log (see SESSION_GAP_MS) - the
 * thing Keith actually means by "the recorded activity" is the latest real run, not
 * whatever's technically oldest in a database that accumulates across sessions. */
function latestSession(all: AgentLogEntry[]): AgentLogEntry[] {
  if (all.length === 0) return [];
  let startIdx = 0;
  for (let i = 1; i < all.length; i++) {
    if (all[i].ts - all[i - 1].ts > SESSION_GAP_MS) startIdx = i;
  }
  return all.slice(startIdx);
}

/** Picks a specific recorded window by wall-clock time instead of auto-detecting "the
 * latest session" - for pinning a replay to a particular, known-good stretch of
 * recorded activity (see env.ts's REPLAY_WINDOW_START/REPLAY_WINDOW_HOURS) rather than
 * whatever happens to be most recent. */
function sessionInWindow(all: AgentLogEntry[], startTs: number, endTs: number): AgentLogEntry[] {
  return all.filter((r) => r.ts >= startTs && r.ts < endTs);
}

function bakeAgent(
  npcId: string,
  rows: AgentLogEntry[],
  mapMeta: MapMeta,
  tileWidth: number,
  tileHeight: number,
  isTileBlocked: (tx: number, ty: number) => boolean,
): Segment[] {
  const state = initialAgentState(npcId, mapMeta, tileWidth, tileHeight, isTileBlocked);
  const segments: Segment[] = [];
  let clock = 0;

  for (const row of rows) {
    const parsed = parseKind(row.text);
    if (parsed.kind === "skip") continue;

    if (parsed.kind === "move") {
      planRoute(state, parsed.destination, mapMeta, tileWidth, tileHeight, isTileBlocked);
      const segStart = clock;
      const path: PositionSample[] = [{ t: 0, x: state.x, y: state.y, dir: state.dir }];
      const dtMs = BAKE_STEP_MS;
      let simMs = 0;
      while (state.destination && simMs < MAX_WALK_SIM_MS) {
        stepAgentMovement(state, dtMs / 1000, tileWidth, tileHeight, isTileBlocked);
        simMs += dtMs;
        path.push({ t: simMs, x: state.x, y: state.y, dir: state.dir });
      }
      // A recorded "move" to a destination the agent was already standing at bakes to
      // zero walking distance - give it a small floor instead of zero duration, or
      // several of these in a row (a real pattern in recorded sessions - the agent
      // deciding to "go" somewhere it never actually left) would all land on the exact
      // same simStart and flash by as one instantaneous burst instead of pacing out.
      simMs = Math.max(simMs, MIN_MOVE_DISPLAY_MS);
      clock += simMs;
      segments.push({ npcId, simStart: segStart, simEnd: clock, activity: "moving", logText: row.text, path, x: path[0].x, y: path[0].y, dir: path[0].dir });
      continue;
    }

    const activity: AgentActivity =
      parsed.kind === "run_experiment"
        ? "running_experiment"
        : parsed.kind === "analyze"
          ? "analyzing_data"
          : parsed.kind === "chat"
            ? "conversing"
            : "idle";
    const segStart = clock;
    clock += parsed.kind === "chat" ? CHAT_HOLD_DURATION_MS : HOLD_DURATION_MS;
    segments.push({ npcId, simStart: segStart, simEnd: clock, activity, logText: row.text, x: state.x, y: state.y, dir: state.dir });
  }

  return segments;
}

/** Bakes a recorded session into a replayable loop - pure offline computation from the
 * database's log, re-simulating movement with the exact same pathfinding/collision code
 * the live loop uses, so the walk looks like it really did. Nothing here writes to the
 * database - replay is read-only with respect to it.
 *
 * Defaults to the most recent recorded session (see latestSession); pass `window` to
 * pin it to a specific wall-clock stretch instead (see env.ts's REPLAY_WINDOW_START/
 * REPLAY_WINDOW_HOURS) - e.g. a known-good recording rather than whatever's freshest. */
export function bakeReplay(
  db: Db,
  npcIds: string[],
  mapMeta: MapMeta,
  tileWidth: number,
  tileHeight: number,
  isTileBlocked: (tx: number, ty: number) => boolean,
  window?: { startTs: number; endTs: number },
): BakedReplay {
  const all = db.loadAllAgentLog();
  const session = window ? sessionInWindow(all, window.startTs, window.endTs) : latestSession(all);
  const byAgent: Record<string, Segment[]> = {};
  for (const npcId of npcIds) {
    if (!getPersona(npcId)) continue;
    byAgent[npcId] = bakeAgent(
      npcId,
      session.filter((r) => r.npcId === npcId),
      mapMeta,
      tileWidth,
      tileHeight,
      isTileBlocked,
    );
  }
  const timeline = Object.values(byAgent)
    .flat()
    .sort((a, b) => a.simStart - b.simStart);
  const totalDurationMs = Math.max(1, ...timeline.map((s) => s.simEnd));

  return {
    byAgent,
    timeline,
    totalDurationMs,
    recordingStart: session[0]?.ts ?? 0,
    recordingEnd: session[session.length - 1]?.ts ?? 0,
    npcIds,
  };
}

function frameAt(segments: Segment[], simMs: number): ReplayFrame {
  for (const seg of segments) {
    if (simMs < seg.simStart || simMs >= seg.simEnd) continue;
    if (!seg.path) return { x: seg.x, y: seg.y, dir: seg.dir, activity: seg.activity };
    const t = simMs - seg.simStart;
    let sample = seg.path[0];
    for (const p of seg.path) {
      if (p.t > t) break;
      sample = p;
    }
    return { x: sample.x, y: sample.y, dir: sample.dir, activity: seg.activity };
  }
  const last = segments[segments.length - 1];
  return last ? { x: last.x, y: last.y, dir: last.dir, activity: "idle" } : { x: 0, y: 0, dir: "down", activity: "idle" };
}

/** Stateful playback head over a baked replay - tracks a monotonic "loop position" and
 * which timeline entries have already been emitted this loop, so callers just feed it
 * elapsed wall-clock ms and get back current per-agent frames plus any log lines that
 * became due since the last call. */
export class ReplayPlayer {
  private nextTimelineIndex = 0;
  private loopCount = 0;
  /** Cumulative ms since this player started - not wrapped, so detecting a loop
   * boundary is exact regardless of how large a single `tick()` jump is (e.g. after
   * the host process was busy/suspended for longer than one full loop). */
  private totalElapsedMs = 0;

  constructor(private readonly baked: BakedReplay) {}

  initialFrames(): Record<string, ReplayFrame> {
    return this.framesAt(0);
  }

  private framesAt(simMs: number): Record<string, ReplayFrame> {
    const frames: Record<string, ReplayFrame> = {};
    for (const npcId of this.baked.npcIds) {
      const segments = this.baked.byAgent[npcId];
      frames[npcId] = segments && segments.length > 0 ? frameAt(segments, simMs) : { x: 0, y: 0, dir: "down", activity: "idle" };
    }
    return frames;
  }

  /** Advances the replay clock by `elapsedMs` and returns the current frame per agent,
   * plus any log lines whose scheduled moment was crossed since the last call (in
   * order - could be more than one if elapsedMs is large enough to span several
   * decisions at once). If elapsedMs is large enough to cross a full loop boundary,
   * this jumps straight to the correct current position rather than replaying every
   * skipped loop's log lines - a long-suspended host process should catch up to "now",
   * not dump a backlog. */
  tick(elapsedMs: number): { frames: Record<string, ReplayFrame>; dueLogLines: Segment[] } {
    this.totalElapsedMs += elapsedMs;
    const loopMs = this.totalElapsedMs % this.baked.totalDurationMs;
    const currentLoop = Math.floor(this.totalElapsedMs / this.baked.totalDurationMs);
    if (currentLoop > this.loopCount) {
      this.loopCount = currentLoop;
      this.nextTimelineIndex = 0;
    }

    const dueLogLines: Segment[] = [];
    while (this.nextTimelineIndex < this.baked.timeline.length && this.baked.timeline[this.nextTimelineIndex].simStart <= loopMs) {
      dueLogLines.push(this.baked.timeline[this.nextTimelineIndex]);
      this.nextTimelineIndex++;
    }

    return { frames: this.framesAt(loopMs), dueLogLines };
  }
}
