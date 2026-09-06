import { PLAYER_SPEED_PX_PER_SEC } from "./protocol.js";

// Collision box is intentionally smaller than a 16px tile so a player can pass
// through a multi-tile doorway without corner-catching on its edges.
export const PLAYER_HALF_SIZE = 7;

export type TileBlockedFn = (tileX: number, tileY: number) => boolean;
export type PositionBlockedFn = (x: number, y: number) => boolean;

// Two entities (players, NPCs) block each other if their same-size boxes overlap -
// i.e. their centers are within one box-width of each other on both axes.
const ENTITY_OVERLAP_DISTANCE = PLAYER_HALF_SIZE * 2;

export function entitiesOverlap(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) < ENTITY_OVERLAP_DISTANCE && Math.abs(ay - by) < ENTITY_OVERLAP_DISTANCE;
}

function isBoxBlocked(
  cx: number,
  cy: number,
  tileWidth: number,
  tileHeight: number,
  isBlocked: TileBlockedFn,
): boolean {
  const corners: [number, number][] = [
    [cx - PLAYER_HALF_SIZE, cy - PLAYER_HALF_SIZE],
    [cx + PLAYER_HALF_SIZE, cy - PLAYER_HALF_SIZE],
    [cx - PLAYER_HALF_SIZE, cy + PLAYER_HALF_SIZE],
    [cx + PLAYER_HALF_SIZE, cy + PLAYER_HALF_SIZE],
  ];
  return corners.some(([x, y]) => isBlocked(Math.floor(x / tileWidth), Math.floor(y / tileHeight)));
}

/**
 * Resolves a player's next position, sliding along walls by testing x/y axes
 * independently, and rejecting a blocked move outright rather than moving into it
 * and separating back out - a real hard stop, not a bump-then-push-back.
 *
 * Used by both the server (authoritative) and the client (local prediction) against
 * their own `isTileBlocked` lookup over the same tile layers, so the two can never
 * visually disagree about where a wall/piece of furniture actually is. `isEntityBlocked`
 * (other players, NPCs) is optional and separate, since - unlike static tile data -
 * other players' positions are only known approximately on the client (via periodic
 * server broadcasts), so perfect agreement there isn't achievable the way it is for
 * tiles; the server remains the authority and corrects any drift.
 */
export function resolveMove(
  x: number,
  y: number,
  dx: number,
  dy: number,
  dt: number,
  tileWidth: number,
  tileHeight: number,
  isTileBlocked: TileBlockedFn,
  isEntityBlocked?: PositionBlockedFn,
): { x: number; y: number } {
  // Normalize diagonal movement so it isn't sqrt(2)x faster than a straight line -
  // still resolved per-axis below so sliding along a wall keeps working.
  const diagonal = dx !== 0 && dy !== 0;
  const scale = diagonal ? Math.SQRT1_2 : 1;
  const vx = dx * scale;
  const vy = dy * scale;

  const blocked = (cx: number, cy: number) =>
    isBoxBlocked(cx, cy, tileWidth, tileHeight, isTileBlocked) || (isEntityBlocked?.(cx, cy) ?? false);

  let nx = x;
  let ny = y;
  if (vx !== 0) {
    const candidate = x + vx * PLAYER_SPEED_PX_PER_SEC * dt;
    if (!blocked(candidate, y)) nx = candidate;
  }
  if (vy !== 0) {
    const candidate = y + vy * PLAYER_SPEED_PX_PER_SEC * dt;
    if (!blocked(nx, candidate)) ny = candidate;
  }
  return { x: nx, y: ny };
}
