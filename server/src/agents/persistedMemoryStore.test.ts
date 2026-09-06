import { describe, expect, it } from "vitest";
import { openDb } from "../db/index.js";
import { PersistedMemoryStore } from "./persistedMemoryStore.js";

describe("PersistedMemoryStore", () => {
  it("writes through to the database on record()", () => {
    const db = openDb(":memory:");
    const store = new PersistedMemoryStore(db, ["lab_scientist"]);
    store.record("lab_scientist", "action", "ran an experiment");

    expect(store.all("lab_scientist").map((e) => e.text)).toEqual(["ran an experiment"]);
    expect(db.loadMemoryEntries("lab_scientist", 10).map((e) => e.text)).toEqual(["ran an experiment"]);
    db.close();
  });

  it("hydrates from the database on construction", () => {
    const db = openDb(":memory:");
    db.saveMemoryEntry({ id: "a", agentId: "lab_scientist", ts: 100, kind: "observation", text: "from a previous run" });

    const store = new PersistedMemoryStore(db, ["lab_scientist", "theoretical_scientist"]);
    expect(store.all("lab_scientist").map((e) => e.text)).toEqual(["from a previous run"]);
    expect(store.all("theoretical_scientist")).toEqual([]);
    db.close();
  });
});
