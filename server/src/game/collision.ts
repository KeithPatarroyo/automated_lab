import { resolveMove as resolveMoveShared, type PositionBlockedFn } from "@lab/shared";
import { isBlocked, TILE_WIDTH, TILE_HEIGHT } from "../data/mapMeta.js";

/** Resolves a player's next position against the map's walls layer and, optionally,
 * other entities (see shared/src/collision.ts). */
export function resolveMove(
  x: number,
  y: number,
  dx: number,
  dy: number,
  dt: number,
  isEntityBlocked?: PositionBlockedFn,
): { x: number; y: number } {
  return resolveMoveShared(x, y, dx, dy, dt, TILE_WIDTH, TILE_HEIGHT, isBlocked, isEntityBlocked);
}
