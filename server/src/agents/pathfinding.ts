export interface TileCoord {
  x: number;
  y: number;
}

/**
 * Plain BFS over the map's tile grid - the same isTileBlocked/dimensions the movement
 * collision system already uses (see data/mapMeta.ts). Returns the tile path from
 * `start` to `goal`, *excluding* `start` itself (so the first element is the first step
 * to take), or `[]` if already at `goal`, or `null` if no path exists at all.
 *
 * BFS rather than A*: this is a small (~40x30), unweighted grid - BFS already finds the
 * shortest path in that case, and doesn't need a heuristic/priority queue to do it.
 */
export function findPath(
  start: TileCoord,
  goal: TileCoord,
  isTileBlocked: (tx: number, ty: number) => boolean,
  widthTiles: number,
  heightTiles: number,
): TileCoord[] | null {
  if (start.x === goal.x && start.y === goal.y) return [];
  if (isTileBlocked(goal.x, goal.y)) return null;

  const key = (t: TileCoord) => `${t.x},${t.y}`;
  const visited = new Set<string>([key(start)]);
  const cameFrom = new Map<string, TileCoord>();
  const queue: TileCoord[] = [start];

  for (let qi = 0; qi < queue.length; qi++) {
    const current = queue[qi];
    if (current.x === goal.x && current.y === goal.y) {
      const path: TileCoord[] = [];
      let node: TileCoord | undefined = current;
      while (node && key(node) !== key(start)) {
        path.push(node);
        node = cameFrom.get(key(node));
      }
      return path.reverse();
    }

    const neighbors: TileCoord[] = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    for (const n of neighbors) {
      if (n.x < 0 || n.x >= widthTiles || n.y < 0 || n.y >= heightTiles) continue;
      if (isTileBlocked(n.x, n.y)) continue;
      const k = key(n);
      if (visited.has(k)) continue;
      visited.add(k);
      cameFrom.set(k, current);
      queue.push(n);
    }
  }
  return null; // goal is unreachable from start
}
