import { describe, expect, it } from "vitest";
import { findPath } from "./pathfinding.js";

const noBlock = () => false;

describe("findPath", () => {
  it("returns an empty path when already at the goal", () => {
    expect(findPath({ x: 3, y: 3 }, { x: 3, y: 3 }, noBlock, 10, 10)).toEqual([]);
  });

  it("finds a direct path on an open grid", () => {
    const path = findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, noBlock, 10, 10);
    expect(path).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it("routes around a wall instead of failing", () => {
    // A vertical wall at x=2 from y=0..3, with a gap at y=4 - straight-line movement
    // would get stuck against this; pathfinding should route through the gap.
    const wall = new Set(["2,0", "2,1", "2,2", "2,3"]);
    const isTileBlocked = (tx: number, ty: number) => wall.has(`${tx},${ty}`);
    const path = findPath({ x: 0, y: 0 }, { x: 4, y: 0 }, isTileBlocked, 10, 10);
    expect(path).not.toBeNull();
    expect(path!.some((t) => wall.has(`${t.x},${t.y}`))).toBe(false);
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 0 });
  });

  it("returns null when the goal is completely walled off", () => {
    const isTileBlocked = (tx: number, ty: number) => tx === 5;
    const path = findPath({ x: 0, y: 0 }, { x: 9, y: 0 }, isTileBlocked, 10, 10);
    expect(path).toBeNull();
  });

  it("returns null when the goal tile itself is blocked", () => {
    const isTileBlocked = (tx: number, ty: number) => tx === 3 && ty === 3;
    expect(findPath({ x: 0, y: 0 }, { x: 3, y: 3 }, isTileBlocked, 10, 10)).toBeNull();
  });

  it("stays within the given grid bounds", () => {
    const path = findPath({ x: 0, y: 0 }, { x: 1, y: 1 }, noBlock, 2, 2);
    expect(path).not.toBeNull();
    for (const t of path!) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(2);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(2);
    }
  });
});
