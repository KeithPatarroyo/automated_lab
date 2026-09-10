import { defineConfig } from "vitest/config";

// Deterministic credentials for the two persisted human accounts (see
// accounts/humanAccounts.ts) during tests, independent of whatever's in a real
// server/.env - `test.env` is injected before any test module loads, so it isn't
// subject to ESM import-hoisting order and always wins over dotenv's "don't override
// an existing value" behavior (server/src/env.ts does `import "dotenv/config"`).
export default defineConfig({
  test: {
    env: {
      KEITH_PASSWORD: "test-keith-pw",
      ANNA_PASSWORD: "test-anna-pw",
    },
  },
});
