import type { Gender } from "@lab/shared";
import { ANNA_PASSWORD, KEITH_PASSWORD } from "../env.js";

export interface HumanAccount {
  /** Canonical lowercase id, used as the DB key (human_snapshot.account_key etc.). */
  key: string;
  /** Display name shown in-game and in chat - what a login username is matched against. */
  displayName: string;
  gender: Gender;
  password: string;
}

export const HUMAN_ACCOUNTS: HumanAccount[] = [
  { key: "keith", displayName: "Keith", gender: "male", password: KEITH_PASSWORD },
  { key: "anna", displayName: "Anna", gender: "female", password: ANNA_PASSWORD },
];

/** Pure matching logic, kept separate from HUMAN_ACCOUNTS (env/dotenv-backed) so tests
 * can exercise it against fixture accounts without depending on real .env values -
 * server/src/env.ts loads the developer's real server/.env via `dotenv/config`, which
 * would otherwise leak into every test run (see handlers.test.ts's askFast mock for the
 * same concern with GEMINI_API_KEY). An account with no password configured never
 * matches, regardless of what's typed - "unset" must mean "login disabled," not "any
 * password works." */
export function matchAccount(accounts: HumanAccount[], username: string, password: string): HumanAccount | null {
  const clean = username.trim().toLowerCase();
  const account = accounts.find((a) => a.displayName.toLowerCase() === clean);
  if (!account || !account.password) return null;
  return password === account.password ? account : null;
}

export function isReservedUsername(username: string, accounts: HumanAccount[] = HUMAN_ACCOUNTS): boolean {
  const clean = username.trim().toLowerCase();
  return accounts.some((a) => a.displayName.toLowerCase() === clean);
}

export function authenticate(username: string, password: string): HumanAccount | null {
  return matchAccount(HUMAN_ACCOUNTS, username, password);
}

// Single-session-per-account enforcement: a second login attempt for an account already
// claimed by a different socket is rejected, rather than letting two sockets represent
// the same identity and race each other's position snapshots.
const activeSessions = new Map<string, string>(); // accountKey -> socketId

export function claimSession(accountKey: string, socketId: string): boolean {
  const holder = activeSessions.get(accountKey);
  if (holder && holder !== socketId) return false;
  activeSessions.set(accountKey, socketId);
  return true;
}

export function releaseSession(socketId: string): void {
  for (const [key, id] of activeSessions) {
    if (id === socketId) activeSessions.delete(key);
  }
}
