import { describe, expect, it } from "vitest";
import type { MapMeta } from "@lab/shared";
import { openDb } from "../db/index.js";
import { bakeReplay, ReplayPlayer } from "./replayEngine.js";

const TILE = 16;
const fakeMapMeta: MapMeta = {
  tileWidth: TILE,
  tileHeight: TILE,
  widthTiles: 40,
  heightTiles: 30,
  spawns: [],
  npcs: [{ npcId: "lab_scientist", x: 20, y: 10 }],
  computers: [
    { computerId: "lab_terminal", x: 20, y: 8 },
    { computerId: "office_terminal", x: 35, y: 22 },
  ],
  zones: [],
};
const noBlock = () => false;
const NPC_IDS = ["lab_scientist", "theoretical_scientist"];

function bake(rows: { ts: number; npcId: string; text: string }[], window?: { startTs: number; endTs: number }) {
  const db = openDb(":memory:");
  rows.forEach((r, i) => db.saveAgentLogEntry({ id: `e${i}`, ts: r.ts, npcId: r.npcId, text: r.text }));
  const baked = bakeReplay(db, NPC_IDS, fakeMapMeta, TILE, TILE, noBlock, window);
  db.close();
  return baked;
}

describe("bakeReplay", () => {
  it("only bakes the most recent contiguous session, ignoring a stale earlier one", () => {
    const baked = bake([
      // A stale session hours earlier - should be excluded.
      { ts: 0, npcId: "lab_scientist", text: "run_experiment - fallback: continuing the closed-loop search" },
      { ts: 10_000, npcId: "theoretical_scientist", text: "analyze - fallback: reviewing the latest experiment data" },
      // A >30min gap, then the real session.
      { ts: 3_000_000, npcId: "lab_scientist", text: "run_experiment - kicked off a real run" },
      { ts: 3_010_000, npcId: "theoretical_scientist", text: "analyze - looked at the results" },
    ]);
    const texts = baked.timeline.map((s) => s.logText);
    expect(texts).toEqual(["run_experiment - kicked off a real run", "analyze - looked at the results"]);
  });

  it("bakes a specific window instead, ignoring the latest-session heuristic entirely", () => {
    const baked = bake(
      [
        // Would normally win as "the latest session" - excluded by the window instead.
        { ts: 3_000_000, npcId: "lab_scientist", text: "run_experiment - too late, outside the window" },
        { ts: 1_000_000, npcId: "lab_scientist", text: "run_experiment - inside the window" },
        { ts: 1_500_000, npcId: "theoretical_scientist", text: "analyze - also inside the window" },
        // Right at the recorded start, before an intentionally stale gap - included
        // anyway since an explicit window overrides the session-gap heuristic.
        { ts: 0, npcId: "lab_scientist", text: "run_experiment - before the window, excluded" },
      ],
      { startTs: 500_000, endTs: 2_000_000 },
    );
    const texts = baked.timeline.map((s) => s.logText);
    expect(texts).toEqual(["run_experiment - inside the window", "analyze - also inside the window"]);
  });

  it("holds a fixed position for non-move decisions", () => {
    const baked = bake([
      { ts: 1000, npcId: "lab_scientist", text: "run_experiment - first" },
      { ts: 2000, npcId: "lab_scientist", text: "run_experiment - second" },
    ]);
    const segs = baked.byAgent.lab_scientist;
    expect(segs).toHaveLength(2);
    expect(segs[0].activity).toBe("running_experiment");
    expect(segs[0].path).toBeUndefined();
    expect(segs[0].simEnd - segs[0].simStart).toBeGreaterThan(0);
    // Position doesn't change for a non-move decision - stays at the npc's spawn.
    expect(segs[1].x).toBe(segs[0].x);
    expect(segs[1].y).toBe(segs[0].y);
  });

  it("bakes a move into a multi-sample walk ending near the destination", () => {
    const baked = bake([{ ts: 1000, npcId: "lab_scientist", text: "\u{1F6B6} MOVE -> office_desk - heading over" }]);
    const [seg] = baked.byAgent.lab_scientist;
    expect(seg.activity).toBe("moving");
    expect(seg.path!.length).toBeGreaterThan(1);
    const finalSample = seg.path![seg.path!.length - 1];
    // office_terminal resolves to tile (35, 22) -> pixel-center (568, 360).
    expect(finalSample.x).toBeCloseTo(568, 0);
    expect(finalSample.y).toBeCloseTo(360, 0);
  });

  it("skips arrived/stuck markers - they aren't new decisions", () => {
    const baked = bake([
      { ts: 1000, npcId: "lab_scientist", text: "\u{1F6B6} MOVE -> office_desk - heading over" },
      { ts: 1500, npcId: "lab_scientist", text: "\u{1F4CD} arrived at (568, 360)" },
      { ts: 2000, npcId: "lab_scientist", text: "run_experiment - back to work" },
    ]);
    expect(baked.byAgent.lab_scientist).toHaveLength(2); // move + run_experiment, not the arrived line
  });

  it("bakes a recorded conversation line into a 'conversing' segment for the speaker", () => {
    const baked = bake([
      { ts: 1000, npcId: "lab_scientist", text: "\u{1F4AC} Just hit 9.8 information content on the last thermal run." },
      { ts: 1005, npcId: "theoretical_scientist", text: "\u{1F4AC} That's a strong result - let's see how it holds up." },
    ]);
    expect(baked.byAgent.lab_scientist).toHaveLength(1);
    expect(baked.byAgent.lab_scientist[0].activity).toBe("conversing");
    expect(baked.byAgent.lab_scientist[0].logText).toContain("9.8 information content");
    expect(baked.byAgent.theoretical_scientist).toHaveLength(1);
    expect(baked.byAgent.theoretical_scientist[0].activity).toBe("conversing");
  });
});

describe("ReplayPlayer", () => {
  it("emits due log lines in order as the clock advances, and produces frames", () => {
    // Two decisions for the SAME agent - each agent's baked clock starts at 0
    // independently, so these are the ones actually staggered relative to each other
    // (each HOLD_DURATION_MS segment is 10s long).
    const baked = bake([
      { ts: 1000, npcId: "lab_scientist", text: "run_experiment - first" },
      { ts: 2000, npcId: "lab_scientist", text: "analyze - second" },
    ]);
    const player = new ReplayPlayer(baked);

    const first = player.tick(1);
    expect(first.dueLogLines.map((s) => s.logText)).toEqual(["run_experiment - first"]);
    expect(first.frames.lab_scientist.activity).toBe("running_experiment");

    // Advance past the first segment's end (10s) into the second, but staying well
    // short of the total 20s loop duration so this doesn't also wrap back to the start.
    const second = player.tick(15_000);
    expect(second.dueLogLines.map((s) => s.logText)).toEqual(["analyze - second"]);
  });

  it("loops back to the start once the baked duration is exceeded", () => {
    const baked = bake([{ ts: 1000, npcId: "lab_scientist", text: "run_experiment - only one" }]);
    const player = new ReplayPlayer(baked);

    player.tick(1); // consumes the one log line
    const afterWrap = player.tick(baked.totalDurationMs + 1000); // wrap around the loop
    expect(afterWrap.dueLogLines.map((s) => s.logText)).toEqual(["run_experiment - only one"]);
  });
});
