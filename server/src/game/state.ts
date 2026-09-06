import type { ChatMessage, Direction, PlayerState } from "@lab/shared";
import { CHAT_LOG_LIMIT } from "@lab/shared";

interface ServerPlayer extends PlayerState {
  lastSeq: number;
  input: { dx: -1 | 0 | 1; dy: -1 | 0 | 1 };
}

export const players = new Map<string, ServerPlayer>();
export const chatLog: ChatMessage[] = [];

export function addPlayer(id: string, username: string, x: number, y: number): ServerPlayer {
  const player: ServerPlayer = { id, username, x, y, dir: "down", lastSeq: 0, input: { dx: 0, dy: 0 } };
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
  return { id: p.id, username: p.username, x: p.x, y: p.y, dir: p.dir };
}

export function allPlayerStates(): PlayerState[] {
  return Array.from(players.values()).map(publicPlayerState);
}

export function pushChatMessage(msg: ChatMessage): void {
  chatLog.push(msg);
  if (chatLog.length > CHAT_LOG_LIMIT) chatLog.shift();
}

export type { ServerPlayer };
