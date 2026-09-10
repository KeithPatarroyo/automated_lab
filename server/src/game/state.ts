import type { Direction, Gender, PlayerState } from "@lab/shared";

interface ServerPlayer extends PlayerState {
  lastSeq: number;
  input: { dx: -1 | 0 | 1; dy: -1 | 0 | 1 };
  /** Set only for the two persisted human accounts (see accounts/humanAccounts.ts) -
   * undefined for an anonymous, ephemeral Visitor. Server-internal only, not part of
   * the public PlayerState wire shape. */
  accountKey?: string;
}

export const players = new Map<string, ServerPlayer>();

export function addPlayer(
  id: string,
  username: string,
  x: number,
  y: number,
  gender: Gender,
  accountKey?: string,
  dir: Direction = "down",
): ServerPlayer {
  const player: ServerPlayer = { id, username, x, y, dir, gender, accountKey, lastSeq: 0, input: { dx: 0, dy: 0 } };
  players.set(id, player);
  return player;
}

export function removePlayer(id: string): void {
  players.delete(id);
}

export function setInput(id: string, seq: number, dx: -1 | 0 | 1, dy: -1 | 0 | 1): void {
  const player = players.get(id);
  if (!player) return;
  if (seq < player.lastSeq) return; // stale, out-of-order packet
  player.lastSeq = seq;
  player.input = { dx, dy };
  if (dx !== 0 || dy !== 0) {
    player.dir = directionFromVector(dx, dy, player.dir);
  }
}

function directionFromVector(dx: number, dy: number, fallback: Direction): Direction {
  if (dy < 0) return "up";
  if (dy > 0) return "down";
  if (dx < 0) return "left";
  if (dx > 0) return "right";
  return fallback;
}

export function publicPlayerState(p: ServerPlayer): PlayerState {
  return { id: p.id, username: p.username, x: p.x, y: p.y, dir: p.dir, gender: p.gender };
}

export function allPlayerStates(): PlayerState[] {
  return Array.from(players.values()).map(publicPlayerState);
}

export type { ServerPlayer };
