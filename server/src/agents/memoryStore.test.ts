import { describe, expect, it } from "vitest";
import { InMemoryMemoryStore } from "./memoryStore.js";

describe("InMemoryMemoryStore", () => {
  it("keeps memories separate per agent", () => {
    const store = new InMemoryMemoryStore();
    store.record("lab_scientist", "action", "ran an experiment");
    store.record("theoretical_scientist", "reflection", "reviewed data");
    expect(store.all("lab_scientist")).toHaveLength(1);
    expect(store.all("theoretical_scientist")).toHaveLength(1);
    expect(store.all("lab_scientist")[0].text).toBe("ran an experiment");
  });

  it("recent() returns the most recent N in order, oldest first", () => {
    const store = new InMemoryMemoryStore();
    for (let i = 0; i < 5; i++) store.record("a", "observation", `entry ${i}`);
    const recent = store.recent("a", 3);
    expect(recent.map((e) => e.text)).toEqual(["entry 2", "entry 3", "entry 4"]);
  });

  it("caps memory per agent at the configured limit", () => {
    const store = new InMemoryMemoryStore(3);
    for (let i = 0; i < 10; i++) store.record("a", "observation", `entry ${i}`);
    const all = store.all("a");
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.text)).toEqual(["entry 7", "entry 8", "entry 9"]);
  });

  it("returns an empty array for an unknown agent", () => {
    const store = new InMemoryMemoryStore();
    expect(store.all("nobody")).toEqual([]);
    expect(store.recent("nobody", 5)).toEqual([]);
  });
});
