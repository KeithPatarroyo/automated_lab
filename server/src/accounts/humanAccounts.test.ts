import { describe, expect, it } from "vitest";
import { claimSession, isReservedUsername, matchAccount, releaseSession, type HumanAccount } from "./humanAccounts.js";

const FIXTURE_ACCOUNTS: HumanAccount[] = [
  { key: "keith", displayName: "Keith", gender: "male", password: "correct-horse" },
  { key: "anna", displayName: "Anna", gender: "female", password: "battery-staple" },
  { key: "empty", displayName: "Empty", gender: "male", password: "" },
];

describe("matchAccount", () => {
  it("matches on the right username/password", () => {
    const account = matchAccount(FIXTURE_ACCOUNTS, "Keith", "correct-horse");
    expect(account?.key).toBe("keith");
  });

  it("is case-insensitive on username", () => {
    expect(matchAccount(FIXTURE_ACCOUNTS, "keith", "correct-horse")?.key).toBe("keith");
    expect(matchAccount(FIXTURE_ACCOUNTS, "KEITH", "correct-horse")?.key).toBe("keith");
  });

  it("rejects a wrong password", () => {
    expect(matchAccount(FIXTURE_ACCOUNTS, "Keith", "wrong")).toBeNull();
  });

  it("rejects an unknown username", () => {
    expect(matchAccount(FIXTURE_ACCOUNTS, "Bob", "anything")).toBeNull();
  });

  it("never matches an account with no password configured, regardless of input", () => {
    expect(matchAccount(FIXTURE_ACCOUNTS, "Empty", "")).toBeNull();
    expect(matchAccount(FIXTURE_ACCOUNTS, "Empty", "anything")).toBeNull();
  });
});

describe("isReservedUsername", () => {
  it("is true for a reserved display name, any case", () => {
    expect(isReservedUsername("Keith", FIXTURE_ACCOUNTS)).toBe(true);
    expect(isReservedUsername("anna", FIXTURE_ACCOUNTS)).toBe(true);
    expect(isReservedUsername("ANNA", FIXTURE_ACCOUNTS)).toBe(true);
  });

  it("is false for a name that isn't reserved", () => {
    expect(isReservedUsername("Bob", FIXTURE_ACCOUNTS)).toBe(false);
  });
});

describe("claimSession / releaseSession", () => {
  it("lets the same socket re-claim its own account idempotently", () => {
    expect(claimSession("keith", "socket-1")).toBe(true);
    expect(claimSession("keith", "socket-1")).toBe(true);
    releaseSession("socket-1");
  });

  it("rejects a different socket while the account is claimed, then allows it after release", () => {
    expect(claimSession("keith", "socket-1")).toBe(true);
    expect(claimSession("keith", "socket-2")).toBe(false);
    releaseSession("socket-1");
    expect(claimSession("keith", "socket-2")).toBe(true);
    releaseSession("socket-2");
  });

  it("releasing a socket that holds no session is a no-op", () => {
    expect(() => releaseSession("never-claimed")).not.toThrow();
  });
});
