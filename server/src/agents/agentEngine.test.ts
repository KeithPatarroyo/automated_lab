import { describe, expect, it } from "vitest";
import type { MapMeta } from "@lab/shared";
import {
  actionSignature,
  applyAction,
  applyStreakGuard,
  buildStreakNote,
  decideNextAction,
  generateConversationLine,
  initialAgentState,
  planRoute,
  resolveWaypoint,
  STREAK_NUDGE_THRESHOLD,
  STREAK_OVERRIDE_THRESHOLD,
  stepAgentMovement,
  type AgentRuntimeState,
} from "./agentEngine.js";
import { InMemoryMemoryStore } from "./memoryStore.js";
import { recentRuns } from "../science/experimentLog.js";

const TILE = 16;

const fakeMapMeta: MapMeta = {
  tileWidth: TILE,
  tileHeight: TILE,
  widthTiles: 40,
  heightTiles: 30,
  spawns: [],
  npcs: [
    { npcId: "lab_scientist", x: 20, y: 10 },
    { npcId: "workshop_tech", x: 5, y: 5 },
    { npcId: "kitchen_cook", x: 10, y: 25 },
  ],
  computers: [
    { computerId: "lab_terminal", x: 20, y: 8 },
    { computerId: "office_terminal", x: 35, y: 22 },
  ],
  zones: [],
};

const noBlock = () => false;

describe("resolveWaypoint", () => {
  it("resolves lab_bench and office_desk to the tile-center pixel position when the computer's own tile is walkable", () => {
    expect(resolveWaypoint("lab_bench", fakeMapMeta, TILE, TILE)).toEqual({ x: 328, y: 136 });
    expect(resolveWaypoint("office_desk", fakeMapMeta, TILE, TILE)).toEqual({ x: 568, y: 360 });
  });

  it("routes around the computer's own tile when it's blocked (e.g. the desk prop itself)", () => {
    // office_terminal is at tile (35, 22) - block exactly that tile, nothing else.
    const isTileBlocked = (tx: number, ty: number) => tx === 35 && ty === 22;
    const { x, y } = resolveWaypoint("office_desk", fakeMapMeta, TILE, TILE, isTileBlocked);
    // Should land on a walkable neighboring tile, not the blocked tile itself.
    expect({ x, y }).not.toEqual({ x: 568, y: 360 });
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    expect(Math.max(Math.abs(tx - 35), Math.abs(ty - 22))).toBeLessThanOrEqual(4);
    expect(isTileBlocked(tx, ty)).toBe(false);
  });

  it("gives different slots distinct adjacent tiles at the same waypoint, not the same tile", () => {
    const slot0 = resolveWaypoint("office_desk", fakeMapMeta, TILE, TILE, undefined, 0);
    const slot1 = resolveWaypoint("office_desk", fakeMapMeta, TILE, TILE, undefined, 1);
    expect(slot0).not.toEqual(slot1);
    // Adjacent, not far apart - both still standing right next to the same terminal.
    const dist = Math.hypot(slot0.x - slot1.x, slot0.y - slot1.y);
    expect(dist).toBeLessThanOrEqual(TILE * Math.SQRT2 + 0.01);
  });

  it("throws a clear error when the map is missing the needed computer", () => {
    const empty: MapMeta = { ...fakeMapMeta, computers: [] };
    expect(() => resolveWaypoint("lab_bench", empty, TILE, TILE)).toThrow(/lab_terminal/);
  });

  it("resolves workshop/kitchen off the existing static-NPC positions, not a computer", () => {
    // workshop_tech is at tile (5,5), kitchen_cook at (10,25) in fakeMapMeta - no
    // computer object needed for either.
    const workshop = resolveWaypoint("workshop", fakeMapMeta, TILE, TILE);
    const kitchen = resolveWaypoint("kitchen", fakeMapMeta, TILE, TILE);
    // Both should land within 1 tile of their anchor (npc anchors exclude the exact
    // center tile - see the next test - but stay close by).
    expect(Math.hypot(workshop.x - (5 * TILE + TILE / 2), workshop.y - (5 * TILE + TILE / 2))).toBeLessThanOrEqual(TILE * Math.SQRT2 + 0.01);
    expect(Math.hypot(kitchen.x - (10 * TILE + TILE / 2), kitchen.y - (25 * TILE + TILE / 2))).toBeLessThanOrEqual(TILE * Math.SQRT2 + 0.01);
  });

  it("never resolves a workshop/kitchen visit onto the static NPC's own tile (would overlap the sprite)", () => {
    // office_desk (a computer anchor) standing on the anchor's own tile is fine - it's
    // just a prop. workshop_tech/kitchen_cook (npc anchors) are actual character
    // sprites already standing there, so an agent should never land on that exact tile.
    const officeDesk = resolveWaypoint("office_desk", fakeMapMeta, TILE, TILE);
    expect(officeDesk).toEqual({ x: 568, y: 360 }); // unchanged from before - computer's own tile is fine

    const workshop = resolveWaypoint("workshop", fakeMapMeta, TILE, TILE);
    expect(workshop).not.toEqual({ x: 5 * TILE + TILE / 2, y: 5 * TILE + TILE / 2 });
  });

  it("throws a clear error when the map is missing the needed npc anchor", () => {
    const empty: MapMeta = { ...fakeMapMeta, npcs: fakeMapMeta.npcs.filter((n) => n.npcId !== "kitchen_cook") };
    expect(() => resolveWaypoint("kitchen", empty, TILE, TILE)).toThrow(/kitchen_cook/);
  });
});

describe("planRoute", () => {
  function freshState(x: number, y: number): AgentRuntimeState {
    return { npcId: "lab_scientist", x, y, dir: "down", activity: "idle", destination: null, path: [], lastActionSignature: null, actionStreak: 0 };
  }

  it("routes around a wall instead of getting stuck on the direct line", () => {
    // office_terminal is at tile (35, 22); wall off a straight vertical line at x=20
    // between the start (tile 0,0) and the goal so a direct-line walk would fail, but
    // there's a gap at y=25 to route through.
    const isTileBlocked = (tx: number, ty: number) => tx === 20 && ty !== 25;
    const state = freshState(0, 0);
    planRoute(state, "office_desk", fakeMapMeta, TILE, TILE, isTileBlocked);

    expect(state.activity).toBe("moving");
    const fullRoute = [state.destination!, ...state.path];
    for (const { x, y } of fullRoute) {
      expect(isTileBlocked(Math.floor(x / TILE), Math.floor(y / TILE))).toBe(false);
    }
    expect(fullRoute[fullRoute.length - 1]).toEqual({ x: 568, y: 360 });
    expect(fullRoute.length).toBeGreaterThan(1); // actually routes tile-by-tile, not a single jump
  });

  it("goes straight to idle if already standing on the goal tile", () => {
    const state = freshState(568, 360); // already at office_desk's resolved tile-center
    planRoute(state, "office_desk", fakeMapMeta, TILE, TILE);
    expect(state.destination).toBeNull();
    expect(state.path).toEqual([]);
    expect(state.activity).toBe("idle");
  });

  it("falls back to a direct single waypoint if the map genuinely has no path", () => {
    const isTileBlocked = (tx: number, ty: number) => tx === 20; // full wall, no gap
    const state = freshState(0, 0);
    planRoute(state, "office_desk", fakeMapMeta, TILE, TILE, isTileBlocked);
    expect(state.activity).toBe("moving");
    expect(state.destination).toEqual({ x: 568, y: 360 });
    expect(state.path).toEqual([]);
  });

  it("theoretical_scientist gets an exact tile offset at the kitchen (3 tiles right of where it stood before this correction), overriding the slot mechanism entirely", () => {
    // kitchen_cook is at tile (10,25) in fakeMapMeta; the exact offset is (dx=2, dy=0)
    // (3 tiles right of its former dx=-1 position) -> tile (12,25).
    const theorist: AgentRuntimeState = { npcId: "theoretical_scientist", x: 0, y: 0, dir: "down", activity: "idle", destination: null, path: [], lastActionSignature: null, actionStreak: 0 };
    planRoute(theorist, "kitchen", fakeMapMeta, TILE, TILE);
    const theoristFinal = [theorist.destination!, ...theorist.path].at(-1)!;
    expect(theoristFinal).toEqual({ x: 12 * TILE + TILE / 2, y: 25 * TILE + TILE / 2 });
  });

  it("lab_scientist still lands adjacent to the kitchen via the slot mechanism (unaffected by theoretical_scientist's exact offset)", () => {
    const lab: AgentRuntimeState = { npcId: "lab_scientist", x: 0, y: 0, dir: "down", activity: "idle", destination: null, path: [], lastActionSignature: null, actionStreak: 0 };
    const theorist: AgentRuntimeState = { npcId: "theoretical_scientist", x: 0, y: 0, dir: "down", activity: "idle", destination: null, path: [], lastActionSignature: null, actionStreak: 0 };
    planRoute(lab, "kitchen", fakeMapMeta, TILE, TILE);
    planRoute(theorist, "kitchen", fakeMapMeta, TILE, TILE);

    const labFinal = [lab.destination!, ...lab.path].at(-1)!;
    const theoristFinal = [theorist.destination!, ...theorist.path].at(-1)!;
    expect(labFinal).not.toEqual(theoristFinal);
  });

  it("does not affect lab_bench/office_desk - only kitchen gets the slot override", () => {
    const lab: AgentRuntimeState = { npcId: "lab_scientist", x: 0, y: 0, dir: "down", activity: "idle", destination: null, path: [], lastActionSignature: null, actionStreak: 0 };
    planRoute(lab, "office_desk", fakeMapMeta, TILE, TILE);
    const labFinal = [lab.destination!, ...lab.path].at(-1)!;
    expect(labFinal).toEqual({ x: 568, y: 360 }); // unchanged from the existing office_desk tests above
  });

  it("falls back to the slot mechanism if theoretical_scientist's exact kitchen tile is blocked", () => {
    // Block exactly the exact-offset target tile (12,25) - the map may have changed
    // since this offset was tuned; planRoute should still produce a valid destination.
    const isTileBlocked = (tx: number, ty: number) => tx === 12 && ty === 25;
    const theorist: AgentRuntimeState = { npcId: "theoretical_scientist", x: 0, y: 0, dir: "down", activity: "idle", destination: null, path: [], lastActionSignature: null, actionStreak: 0 };
    planRoute(theorist, "kitchen", fakeMapMeta, TILE, TILE, isTileBlocked);
    const theoristFinal = [theorist.destination!, ...theorist.path].at(-1)!;
    expect(theoristFinal).not.toEqual({ x: 12 * TILE + TILE / 2, y: 25 * TILE + TILE / 2 });
    const tx = Math.floor(theoristFinal.x / TILE);
    const ty = Math.floor(theoristFinal.y / TILE);
    expect(isTileBlocked(tx, ty)).toBe(false);
  });
});

describe("initialAgentState", () => {
  it("spawns at the agent's placed NPC position when one exists", () => {
    const state = initialAgentState("lab_scientist", fakeMapMeta, TILE, TILE);
    expect(state).toMatchObject({ x: 320, y: 160, activity: "idle", destination: null });
  });

  it("falls back to the persona's home waypoint when no NPC object is placed yet, offset by its slot", () => {
    // theoretical_scientist's slotIndex is 1 (see personas.ts) - it lands on the
    // second-nearest walkable tile to office_desk, not the terminal's own tile, so it
    // doesn't spawn stacked on whoever/whatever else uses slot 0 there.
    const state = initialAgentState("theoretical_scientist", fakeMapMeta, TILE, TILE);
    expect(state).toMatchObject({ x: 552, y: 344 });
  });

  it("throws for an npcId with no persona defined", () => {
    expect(() => initialAgentState("kitchen_cook", fakeMapMeta, TILE, TILE)).toThrow(/persona/);
  });
});

describe("stepAgentMovement", () => {
  it("moves toward the destination and clears it on arrival", () => {
    const state: AgentRuntimeState = { npcId: "lab_scientist", x: 0, y: 0, dir: "down", activity: "moving", destination: { x: 0, y: 5 }, path: [], lastActionSignature: null, actionStreak: 0 };
    for (let i = 0; i < 20 && state.destination; i++) {
      stepAgentMovement(state, 1 / 20, TILE, TILE, noBlock);
    }
    expect(state.destination).toBeNull();
    expect(state.activity).toBe("idle");
    expect(state.y).toBeCloseTo(5, 0);
  });

  it("does not move through a blocked tile", () => {
    const state: AgentRuntimeState = { npcId: "lab_scientist", x: 0, y: 0, dir: "down", activity: "moving", destination: { x: 100, y: 0 }, path: [], lastActionSignature: null, actionStreak: 0 };
    const blockEverythingRight = (tx: number) => tx >= 1;
    stepAgentMovement(state, 1, TILE, TILE, blockEverythingRight);
    expect(state.x).toBe(0);
  });
});

describe("decideNextAction", () => {
  const ctx = {
    persona: {
      npcId: "lab_scientist",
      displayName: "Lab Scientist",
      role: "experimentalist" as const,
      home: "lab_bench" as const,
      slotIndex: 0,
      systemPrompt: "test",
    },
    locationLabel: "lab_bench",
    recentMemory: [],
    recentRunsSummary: "no runs",
    timeOfDayLabel: "2:34 PM",
  };

  it("parses a valid JSON action from the model", async () => {
    const action = await decideNextAction(ctx, async () => '{"kind":"run_experiment","mechanism":"thermal","reason":"trying something new"}');
    expect(action).toEqual({ kind: "run_experiment", mechanism: "thermal", reason: "trying something new" });
  });

  it("parses a move to the workshop or kitchen, not just lab_bench/office_desk", async () => {
    const toWorkshop = await decideNextAction(ctx, async () => '{"kind":"move","destination":"workshop","reason":"grabbing materials"}');
    expect(toWorkshop).toEqual({ kind: "move", destination: "workshop", reason: "grabbing materials" });

    const toKitchen = await decideNextAction(ctx, async () => '{"kind":"move","destination":"kitchen","reason":"coffee break"}');
    expect(toKitchen).toEqual({ kind: "move", destination: "kitchen", reason: "coffee break" });
  });

  it("tolerates surrounding prose around the JSON object", async () => {
    const action = await decideNextAction(
      ctx,
      async () => 'Sure, here is my decision:\n{"kind":"idle","reason":"taking a break"}\nHope that helps.',
    );
    expect(action).toEqual({ kind: "idle", reason: "taking a break" });
  });

  it("falls back to a scripted action when the response is unparseable", async () => {
    const action = await decideNextAction(ctx, async () => "not json at all");
    expect(action.kind).toBe("run_experiment");
  });

  it("falls back when the model call throws (e.g. no API key configured)", async () => {
    const action = await decideNextAction(ctx, async () => {
      throw new Error("no API key");
    });
    expect(action.kind).toBe("run_experiment");
  });

  it("rejects an action kind not allowed for this agent's role", async () => {
    // Theorist role doesn't allow run_experiment - an out-of-role response should fall
    // back rather than being executed.
    const theoristCtx = { ...ctx, persona: { ...ctx.persona, role: "theorist" as const } };
    const action = await decideNextAction(theoristCtx, async () => '{"kind":"run_experiment","mechanism":"thermal","reason":"x"}');
    expect(action.kind).toBe("analyze");
  });
});

describe("applyAction", () => {
  const deps = { memory: new InMemoryMemoryStore(), mapMeta: fakeMapMeta, tileWidth: TILE, tileHeight: TILE, rngSeed: 12345 };

  it("move plans a route whose final waypoint is the resolved destination", () => {
    const state: AgentRuntimeState = { npcId: "lab_scientist", x: 0, y: 0, dir: "down", activity: "idle", destination: null, path: [], lastActionSignature: null, actionStreak: 0 };
    applyAction(state, { kind: "move", destination: "office_desk", reason: "going to log data" }, deps);
    expect(state.activity).toBe("moving");
    expect(state.destination).not.toBeNull();
    const fullRoute = [state.destination, ...state.path];
    expect(fullRoute[fullRoute.length - 1]).toEqual({ x: 568, y: 360 });
  });

  it("run_experiment records a run in the experiment log and a memory entry", () => {
    const state: AgentRuntimeState = { npcId: "lab_scientist", x: 0, y: 0, dir: "down", activity: "idle", destination: null, path: [], lastActionSignature: null, actionStreak: 0 };
    const before = recentRuns(1000).length;
    applyAction(state, { kind: "run_experiment", mechanism: "growth", reason: "continuing the search" }, deps);
    expect(recentRuns(1000).length).toBe(before + 1);
    const memories = deps.memory.all("lab_scientist");
    expect(memories.some((m) => m.kind === "observation")).toBe(true);
  });

  it("analyze records a reflection memory entry", () => {
    const state: AgentRuntimeState = { npcId: "theoretical_scientist", x: 0, y: 0, dir: "down", activity: "idle", destination: null, path: [], lastActionSignature: null, actionStreak: 0 };
    applyAction(state, { kind: "analyze", reason: "checking progress" }, deps);
    const memories = deps.memory.all("theoretical_scientist");
    expect(memories.some((m) => m.kind === "reflection")).toBe(true);
  });
});

describe("actionSignature", () => {
  it("includes the mechanism for run_experiment but not for other kinds", () => {
    expect(actionSignature({ kind: "run_experiment", mechanism: "thermal", reason: "x" })).toBe("run_experiment:thermal");
    expect(actionSignature({ kind: "run_experiment", mechanism: "growth", reason: "x" })).toBe("run_experiment:growth");
    expect(actionSignature({ kind: "analyze", reason: "x" })).toBe("analyze");
    expect(actionSignature({ kind: "idle", reason: "x" })).toBe("idle");
  });
});

describe("buildStreakNote", () => {
  const base: AgentRuntimeState = {
    npcId: "lab_scientist",
    x: 0,
    y: 0,
    dir: "down",
    activity: "idle",
    destination: null,
    path: [],
    lastActionSignature: null,
    actionStreak: 0,
  };

  it("is undefined for a fresh agent or a streak below the nudge threshold", () => {
    expect(buildStreakNote(base)).toBeUndefined();
    expect(
      buildStreakNote({ ...base, lastActionSignature: "run_experiment:thermal", actionStreak: STREAK_NUDGE_THRESHOLD - 1 }),
    ).toBeUndefined();
  });

  it("names the repeated action and count once at the nudge threshold", () => {
    const note = buildStreakNote({ ...base, lastActionSignature: "run_experiment:thermal", actionStreak: STREAK_NUDGE_THRESHOLD });
    expect(note).toContain("run_experiment:thermal");
    expect(note).toContain(String(STREAK_NUDGE_THRESHOLD));
  });
});

describe("applyStreakGuard", () => {
  const experimentalist = {
    npcId: "lab_scientist",
    displayName: "Lab Scientist",
    role: "experimentalist" as const,
    home: "lab_bench" as const,
    slotIndex: 0,
    systemPrompt: "test",
  };
  const theorist = { ...experimentalist, npcId: "theoretical_scientist", role: "theorist" as const, home: "office_desk" as const, slotIndex: 1 };

  function freshState(npcId: string): AgentRuntimeState {
    return { npcId, x: 0, y: 0, dir: "down", activity: "idle", destination: null, path: [], lastActionSignature: null, actionStreak: 0 };
  }

  it("passes the action through unchanged while under the override threshold, tracking the streak", () => {
    const state = freshState("lab_scientist");
    let action = { kind: "run_experiment", mechanism: "thermal", reason: "x" } as const;
    for (let i = 1; i < STREAK_OVERRIDE_THRESHOLD; i++) {
      const result = applyStreakGuard(state, action, experimentalist);
      expect(result).toBe(action);
      expect(state.actionStreak).toBe(i);
    }
  });

  it("forces a different mechanism once the same run_experiment mechanism repeats past the override threshold", () => {
    const state = freshState("lab_scientist");
    const repeated = { kind: "run_experiment", mechanism: "thermal", reason: "keep going" } as const;
    let lastResult;
    for (let i = 0; i < STREAK_OVERRIDE_THRESHOLD; i++) {
      lastResult = applyStreakGuard(state, repeated, experimentalist);
    }
    expect(lastResult!.kind).toBe("run_experiment");
    expect((lastResult as { mechanism: string }).mechanism).not.toBe("thermal");
    expect(state.actionStreak).toBe(1);
  });

  it("forces a move once the theorist's analyze streak passes the override threshold", () => {
    const state = freshState("theoretical_scientist");
    const repeated = { kind: "analyze", reason: "keep analyzing" } as const;
    let lastResult;
    for (let i = 0; i < STREAK_OVERRIDE_THRESHOLD; i++) {
      lastResult = applyStreakGuard(state, repeated, theorist);
    }
    expect(lastResult).toEqual(expect.objectContaining({ kind: "move", destination: "lab_bench" }));
  });

  it("resets the streak when the action changes", () => {
    const state = freshState("lab_scientist");
    applyStreakGuard(state, { kind: "run_experiment", mechanism: "thermal", reason: "x" }, experimentalist);
    applyStreakGuard(state, { kind: "run_experiment", mechanism: "thermal", reason: "x" }, experimentalist);
    expect(state.actionStreak).toBe(2);
    applyStreakGuard(state, { kind: "idle", reason: "x" }, experimentalist);
    expect(state.actionStreak).toBe(1);
  });
});

describe("generateConversationLine", () => {
  const labScientist = {
    npcId: "lab_scientist",
    displayName: "Lab Scientist",
    role: "experimentalist" as const,
    home: "lab_bench" as const,
    slotIndex: 0,
    systemPrompt: "test",
  };
  const theoreticalScientist = {
    npcId: "theoretical_scientist",
    displayName: "Theoretical Scientist",
    role: "theorist" as const,
    home: "office_desk" as const,
    slotIndex: 1,
    systemPrompt: "test",
  };
  const baseCtx = {
    speaker: labScientist,
    listener: theoreticalScientist,
    locationLabel: "the Primary Lab",
    speakerMemory: [],
    transcriptSoFar: [],
  };

  it("returns the model's line, trimmed of surrounding quotes", () => {
    const line = generateConversationLine(baseCtx, async () => '"Just hit 9.8 information content on the last thermal run."');
    return expect(line).resolves.toBe("Just hit 9.8 information content on the last thermal run.");
  });

  it("falls back to a scripted opening line when the call throws and there's no transcript yet", async () => {
    const line = await generateConversationLine(baseCtx, async () => {
      throw new Error("quota exceeded");
    });
    expect(line).toMatch(/update/i);
  });

  it("falls back to a scripted reply line when the call throws and this is a reply", async () => {
    const ctx = { ...baseCtx, speaker: theoreticalScientist, listener: labScientist, transcriptSoFar: [{ npcId: "lab_scientist", text: "Hit 9.8 today." }] };
    const line = await generateConversationLine(ctx, async () => {
      throw new Error("quota exceeded");
    });
    expect(line).toMatch(/nods|thought/i);
  });

  it("falls back when the model returns an empty string", async () => {
    const line = await generateConversationLine(baseCtx, async () => "   ");
    expect(line.length).toBeGreaterThan(0);
  });
});
