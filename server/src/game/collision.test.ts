import { describe, expect, it } from "vitest";
import { entitiesOverlap } from "@lab/shared";
import { isBlocked, mapMeta } from "../data/mapMeta.js";
import { resolveMove } from "./collision.js";

// The map (client/public/assets/map/lab.json) is now hand-edited in Tiled, so exact
// door-gap tile coordinates are expected to shift over time as the room art changes.
// These tests deliberately avoid asserting specific coordinates and instead check
// structural properties that must hold regardless of layout details.

describe("isBlocked", () => {
  it("blocks the outer border", () => {
    expect(isBlocked(0, 17)).toBe(true);
  });

  it("treats out-of-range tiles as blocked", () => {
    expect(isBlocked(-1, 5)).toBe(true);
    expect(isBlocked(5, 999)).toBe(true);
  });
});

function floodFillReachableTiles(startX: number, startY: number): Set<string> {
  const key = (x: number, y: number) => `${x},${y}`;
  const seen = new Set<string>();
  if (isBlocked(startX, startY)) return seen;
  seen.add(key(startX, startY));
  const queue: [number, number][] = [[startX, startY]];
  while (queue.length) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!seen.has(key(nx, ny)) && !isBlocked(nx, ny)) {
        seen.add(key(nx, ny));
        queue.push([nx, ny]);
      }
    }
  }
  return seen;
}

/** NPCs/computers are approached by proximity (see INTERACT_RANGE_TILES), not by
 * standing exactly on their tile - furniture can legitimately sit right on/against
 * one (e.g. an NPC "at" a desk) without breaking interaction. A 3x3 neighborhood
 * approximates the real interact range (1.5 tiles) closely enough for this check. */
function isApproachable(reachable: Set<string>, tileX: number, tileY: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (reachable.has(`${tileX + dx},${tileY + dy}`)) return true;
    }
  }
  return false;
}

describe("map connectivity", () => {
  it("keeps every spawn walkable, and every NPC/computer approachable, from the first spawn", () => {
    const [first, ...restSpawns] = mapMeta.spawns;
    const reachable = floodFillReachableTiles(Math.floor(first.x), Math.floor(first.y));
    expect(reachable.size).toBeGreaterThan(50); // sanity: not just an isolated pocket

    for (const spawn of restSpawns) {
      const tile = `${Math.floor(spawn.x)},${Math.floor(spawn.y)}`;
      expect(reachable.has(tile), `spawn at (${spawn.x}, ${spawn.y}) is unreachable`).toBe(true);
    }
    for (const npc of mapMeta.npcs) {
      const ok = isApproachable(reachable, Math.floor(npc.x), Math.floor(npc.y));
      expect(ok, `NPC "${npc.npcId}" is not approachable from spawn`).toBe(true);
    }
    for (const computer of mapMeta.computers) {
      const ok = isApproachable(reachable, Math.floor(computer.x), Math.floor(computer.y));
      expect(ok, `computer "${computer.computerId}" is not approachable from spawn`).toBe(true);
    }
  });
});

describe("resolveMove", () => {
  it("moves freely through open floor", () => {
    const start = { x: 40, y: 280 }; // inside the kitchen quadrant
    const next = resolveMove(start.x, start.y, 1, 0, 0.05);
    expect(next.x).toBeGreaterThan(start.x);
    expect(next.y).toBe(start.y);
  });

  it("stops at the border wall instead of passing through it", () => {
    let pos = { x: 40, y: 280 };
    for (let i = 0; i < 40; i++) {
      pos = resolveMove(pos.x, pos.y, -1, 0, 0.05);
    }
    // box left edge (x - halfSize) must never enter tile 0 (px 0-15)
    expect(pos.x).toBeGreaterThanOrEqual(23);
    const stillBlocked = resolveMove(pos.x, pos.y, -1, 0, 0.05);
    expect(stillBlocked.x).toBe(pos.x);
  });

  it("stops at another entity (another player, or an NPC) instead of overlapping it", () => {
    const otherAt = { x: 70, y: 280 };
    const isEntityBlocked = (x: number, y: number) => entitiesOverlap(x, y, otherAt.x, otherAt.y);

    let pos = { x: 40, y: 280 };
    for (let i = 0; i < 40; i++) {
      pos = resolveMove(pos.x, pos.y, 1, 0, 0.05, isEntityBlocked);
    }
    expect(entitiesOverlap(pos.x, pos.y, otherAt.x, otherAt.y)).toBe(false);
    expect(pos.x).toBeLessThan(otherAt.x);

    const stillBlocked = resolveMove(pos.x, pos.y, 1, 0, 0.05, isEntityBlocked);
    expect(stillBlocked.x).toBe(pos.x);
  });

  it("does not block on entities when no isEntityBlocked callback is given", () => {
    const next = resolveMove(40, 280, 1, 0, 0.05);
    expect(next.x).toBeGreaterThan(40);
  });
});
