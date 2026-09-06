import { describe, expect, it } from "vitest";
import { openDb } from "./index.js";
import type { MemoryEntry } from "../agents/memoryStore.js";
import type { ExperimentRun } from "../science/experimentLog.js";
import type { AgentLogEntry } from "@lab/shared";

function freshDb() {
  return openDb(":memory:");
}

describe("agent memory persistence", () => {
  it("round-trips entries in chronological order, most-recent-N", () => {
    const db = freshDb();
    const entries: MemoryEntry[] = [
      { id: "a", agentId: "lab_scientist", ts: 100, kind: "action", text: "first" },
      { id: "b", agentId: "lab_scientist", ts: 200, kind: "observation", text: "second" },
      { id: "c", agentId: "lab_scientist", ts: 300, kind: "reflection", text: "third" },
      { id: "d", agentId: "theoretical_scientist", ts: 150, kind: "action", text: "other agent" },
    ];
    for (const e of entries) db.saveMemoryEntry(e);

    const loaded = db.loadMemoryEntries("lab_scientist", 10);
    expect(loaded.map((e) => e.text)).toEqual(["first", "second", "third"]);

    const limited = db.loadMemoryEntries("lab_scientist", 2);
    expect(limited.map((e) => e.text)).toEqual(["second", "third"]);

    expect(db.loadMemoryEntries("theoretical_scientist", 10).map((e) => e.text)).toEqual(["other agent"]);
    db.close();
  });
});

describe("experiment run persistence", () => {
  it("round-trips a full run including the stacking sequence", () => {
    const db = freshDb();
    const run: ExperimentRun = {
      id: "run1",
      ts: 1000,
      requestedBy: "lab_scientist",
      mechanism: "thermal",
      config: { material: "SiC", sequence: ["H", "C", "H", "H", "C"] },
      measured: { informationContent: 7.42, bulkModulus: 61.3 },
      meetsTarget: true,
    };
    db.saveExperimentRun(run);
    const [loaded] = db.loadRecentExperimentRuns(10);
    expect(loaded).toEqual(run);
    db.close();
  });

  it("returns most-recent-N in chronological order", () => {
    const db = freshDb();
    for (let i = 0; i < 5; i++) {
      db.saveExperimentRun({
        id: `run${i}`,
        ts: i * 10,
        requestedBy: "lab_scientist",
        mechanism: "growth",
        config: { material: "ZnS", sequence: ["H", "C"] },
        measured: { informationContent: i, bulkModulus: i },
        meetsTarget: false,
      });
    }
    const loaded = db.loadRecentExperimentRuns(3);
    expect(loaded.map((r) => r.id)).toEqual(["run2", "run3", "run4"]);
    db.close();
  });
});

describe("agent log persistence", () => {
  it("round-trips entries most-recent-N, chronological order", () => {
    const db = freshDb();
    const entries: AgentLogEntry[] = [
      { id: "1", ts: 10, npcId: "lab_scientist", text: "did a thing" },
      { id: "2", ts: 20, npcId: "theoretical_scientist", text: "did another thing" },
    ];
    for (const e of entries) db.saveAgentLogEntry(e);
    expect(db.loadRecentAgentLog(10)).toEqual(entries);
    db.close();
  });
});

describe("loadAllAgentLog", () => {
  it("returns every entry ever logged, oldest first", () => {
    const db = freshDb();
    const entries: AgentLogEntry[] = [
      { id: "1", ts: 30, npcId: "lab_scientist", text: "third" },
      { id: "2", ts: 10, npcId: "lab_scientist", text: "first" },
      { id: "3", ts: 20, npcId: "theoretical_scientist", text: "second" },
    ];
    for (const e of entries) db.saveAgentLogEntry(e);
    expect(db.loadAllAgentLog().map((e) => e.text)).toEqual(["first", "second", "third"]);
    db.close();
  });
});

describe("agent snapshot persistence", () => {
  it("returns undefined for an agent with no saved snapshot", () => {
    const db = freshDb();
    expect(db.loadAgentSnapshot("lab_scientist")).toBeUndefined();
    db.close();
  });

  it("round-trips and upserts a snapshot for the same agent", () => {
    const db = freshDb();
    db.saveAgentSnapshot({
      npcId: "lab_scientist",
      x: 100,
      y: 200,
      dir: "down",
      activity: "idle",
      lastActionSignature: "run_experiment:thermal",
      actionStreak: 3,
    });
    const first = db.loadAgentSnapshot("lab_scientist");
    expect(first).toMatchObject({ x: 100, y: 200, actionStreak: 3 });

    db.saveAgentSnapshot({
      npcId: "lab_scientist",
      x: 150,
      y: 250,
      dir: "up",
      activity: "moving",
      lastActionSignature: null,
      actionStreak: 0,
    });
    const second = db.loadAgentSnapshot("lab_scientist");
    expect(second).toMatchObject({ x: 150, y: 250, dir: "up", activity: "moving", lastActionSignature: null, actionStreak: 0 });
    db.close();
  });
});

describe("target spec persistence", () => {
  it("returns undefined when nothing has been saved yet", () => {
    const db = freshDb();
    expect(db.loadTarget()).toBeUndefined();
    db.close();
  });

  it("round-trips a target spec, including undefined min/max", () => {
    const db = freshDb();
    db.saveTarget({ property: "informationContent", min: 6, note: "looking for high entropy" });
    expect(db.loadTarget()).toEqual({ property: "informationContent", min: 6, max: undefined, note: "looking for high entropy" });

    db.saveTarget({ property: "bulkModulus", max: 80, note: "looking for soft materials" });
    expect(db.loadTarget()).toEqual({ property: "bulkModulus", min: undefined, max: 80, note: "looking for soft materials" });
    db.close();
  });
});
