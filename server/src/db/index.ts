import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { AgentLogEntry, AgentActivity, ChatMessage, Direction } from "@lab/shared";
import type { MemoryEntry } from "../agents/memoryStore.js";
import type { CrystalConfig, FaultMechanism, Material, StackingSymbol } from "../science/crystalDomain.js";
import type { ExperimentRun } from "../science/experimentLog.js";
import type { TargetSpec } from "../science/crystalDomain.js";
import { DB_FILE } from "../env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Under the test runner, default to an ephemeral in-memory database instead of the real
// on-disk file - runtime.ts opens a database at import time (module-level, so tests that
// merely import anything that pulls in runtime.ts would otherwise touch the real file,
// even though nothing here actually asserts anything about persistence itself). vitest
// sets VITEST=true automatically; this only affects the *default*, an explicit path
// argument (as db/index.test.ts and persistedMemoryStore.test.ts already pass) always wins.
// DB_FILE (env.ts) lets a separate "lab" instance point at its own sqlite file - see
// README's "Multiple labs" section - defaulting to today's single-lab "lab.sqlite".
const DEFAULT_DB_PATH = process.env.VITEST ? ":memory:" : path.resolve(__dirname, "../../data", DB_FILE);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_memory (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_ts ON agent_memory(agent_id, ts);

CREATE TABLE IF NOT EXISTS experiment_runs (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  requested_by TEXT NOT NULL,
  mechanism TEXT NOT NULL,
  material TEXT NOT NULL,
  sequence TEXT NOT NULL,
  information_content REAL NOT NULL,
  bulk_modulus REAL NOT NULL,
  meets_target INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_experiment_runs_ts ON experiment_runs(ts);

CREATE TABLE IF NOT EXISTS agent_log (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  npc_id TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_log_ts ON agent_log(ts);

CREATE TABLE IF NOT EXISTS agent_snapshot (
  npc_id TEXT PRIMARY KEY,
  x REAL NOT NULL,
  y REAL NOT NULL,
  dir TEXT NOT NULL,
  activity TEXT NOT NULL,
  last_action_signature TEXT,
  action_streak INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS experiment_target (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  property TEXT NOT NULL,
  min REAL,
  max REAL,
  note TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS human_snapshot (
  account_key TEXT PRIMARY KEY,
  x REAL NOT NULL,
  y REAL NOT NULL,
  dir TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS public_chat_log (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  username TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_public_chat_log_ts ON public_chat_log(ts);

CREATE TABLE IF NOT EXISTS human_interaction_log (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  account_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_human_interaction_log_account_ts ON human_interaction_log(account_key, ts);

-- One row per successful join/login (never a rejected attempt) - backs the
-- productivity dashboard's "humans who've accessed this lab" count. account_key is
-- null for an anonymous Visitor.
CREATE TABLE IF NOT EXISTS access_log (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  username TEXT NOT NULL,
  account_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_access_log_ts ON access_log(ts);
`;

export interface AgentSnapshot {
  npcId: string;
  x: number;
  y: number;
  dir: Direction;
  activity: AgentActivity;
  lastActionSignature: string | null;
  actionStreak: number;
}

export interface HumanSnapshot {
  accountKey: string;
  x: number;
  y: number;
  dir: Direction;
}

export interface HumanInteractionEntry {
  id: string;
  ts: number;
  accountKey: string;
  kind: "npc_chat" | "terminal";
  targetId: string;
  role: "user" | "assistant";
  text: string;
}

export interface AccessLogEntry {
  id: string;
  ts: number;
  username: string;
  accountKey: string | null;
}

export interface Db {
  saveMemoryEntry(entry: MemoryEntry): void;
  loadMemoryEntries(agentId: string, limit: number): MemoryEntry[];

  saveExperimentRun(run: ExperimentRun): void;
  loadRecentExperimentRuns(limit: number): ExperimentRun[];

  saveAgentLogEntry(entry: AgentLogEntry): void;
  loadRecentAgentLog(limit: number): AgentLogEntry[];
  /** Every entry ever logged, oldest first - used by the replay engine to find and bake
   * the most recent recorded session (see replay/replayEngine.ts). Not paginated: this
   * project's log volume (hundreds to low thousands of rows) is small enough to load
   * whole; revisit if that stops being true. */
  loadAllAgentLog(): AgentLogEntry[];

  saveAgentSnapshot(snapshot: AgentSnapshot): void;
  loadAgentSnapshot(npcId: string): AgentSnapshot | undefined;

  saveTarget(target: TargetSpec): void;
  loadTarget(): TargetSpec | undefined;

  saveHumanSnapshot(snapshot: HumanSnapshot): void;
  loadHumanSnapshot(accountKey: string): HumanSnapshot | undefined;

  /** Every public chat message - from a Visitor as well as a logged-in account, plus
   * the system "<name> (visitor) has left." departure notice - is saved here; only a
   * Visitor's own position/interaction-log state stays unpersisted. */
  savePublicChatMessage(msg: ChatMessage): void;
  /** Every message ever persisted, oldest first - sent in full to a logged-in account
   * on login, same "small enough to load whole" precedent as loadAllAgentLog. */
  loadAllPublicChatLog(): ChatMessage[];

  saveHumanInteractionEntry(entry: HumanInteractionEntry): void;
  loadRecentHumanInteractionLog(accountKey: string, limit: number): HumanInteractionEntry[];

  saveAccessLogEntry(entry: AccessLogEntry): void;
  countAccessLogEntries(): number;

  /** Number of agent-to-agent conversation lines ever logged - agents/runtime.ts's
   * decisionTick logs each side of an exchange with a "💬 " prefix (two rows per
   * exchange), the same marker replayEngine.ts's parseKind checks for. Backs the
   * productivity dashboard's "agent-to-agent interactions" count. */
  countAgentConversationLines(): number;

  close(): void;
}

/**
 * Opens (creating if needed) the durable store behind the agent simulation - memory,
 * experiment log, the human-visible activity feed, each agent's last known
 * position/streak - plus, for the two named human accounts only (see
 * server/src/accounts/humanAccounts.ts), their own last known position, their own
 * public chat messages, and their own NPC-agent/terminal chat history. An anonymous
 * Visitor is still just an observer: nothing about their session is persisted, and
 * their public chat is shown live but never written here.
 *
 * Pass ":memory:" for an ephemeral in-process database (used by tests); omit `dbPath`
 * to use the real on-disk file under server/data/ (gitignored - this is generated data,
 * not source).
 */
export function openDb(dbPath: string = DEFAULT_DB_PATH): Db {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const raw = new Database(dbPath);
  raw.pragma("journal_mode = WAL");
  raw.exec(SCHEMA);

  const insertMemory = raw.prepare(
    "INSERT INTO agent_memory (id, agent_id, ts, kind, text) VALUES (@id, @agentId, @ts, @kind, @text)",
  );
  const selectMemory = raw.prepare(
    "SELECT id, agent_id as agentId, ts, kind, text FROM agent_memory WHERE agent_id = ? ORDER BY ts DESC LIMIT ?",
  );

  const insertRun = raw.prepare(
    `INSERT INTO experiment_runs (id, ts, requested_by, mechanism, material, sequence, information_content, bulk_modulus, meets_target)
     VALUES (@id, @ts, @requestedBy, @mechanism, @material, @sequence, @informationContent, @bulkModulus, @meetsTarget)`,
  );
  const selectRuns = raw.prepare("SELECT * FROM experiment_runs ORDER BY ts DESC LIMIT ?");

  const insertLog = raw.prepare("INSERT INTO agent_log (id, ts, npc_id, text) VALUES (@id, @ts, @npcId, @text)");
  const selectLog = raw.prepare("SELECT id, ts, npc_id as npcId, text FROM agent_log ORDER BY ts DESC LIMIT ?");
  const selectAllLog = raw.prepare("SELECT id, ts, npc_id as npcId, text FROM agent_log ORDER BY ts ASC");

  const upsertSnapshot = raw.prepare(`
    INSERT INTO agent_snapshot (npc_id, x, y, dir, activity, last_action_signature, action_streak, updated_at)
    VALUES (@npcId, @x, @y, @dir, @activity, @lastActionSignature, @actionStreak, @updatedAt)
    ON CONFLICT(npc_id) DO UPDATE SET
      x = excluded.x, y = excluded.y, dir = excluded.dir, activity = excluded.activity,
      last_action_signature = excluded.last_action_signature, action_streak = excluded.action_streak,
      updated_at = excluded.updated_at
  `);
  const selectSnapshot = raw.prepare(
    "SELECT npc_id as npcId, x, y, dir, activity, last_action_signature as lastActionSignature, action_streak as actionStreak FROM agent_snapshot WHERE npc_id = ?",
  );

  const upsertTarget = raw.prepare(`
    INSERT INTO experiment_target (id, property, min, max, note) VALUES (1, @property, @min, @max, @note)
    ON CONFLICT(id) DO UPDATE SET property = excluded.property, min = excluded.min, max = excluded.max, note = excluded.note
  `);
  const selectTarget = raw.prepare("SELECT property, min, max, note FROM experiment_target WHERE id = 1");

  const upsertHumanSnapshot = raw.prepare(`
    INSERT INTO human_snapshot (account_key, x, y, dir, updated_at)
    VALUES (@accountKey, @x, @y, @dir, @updatedAt)
    ON CONFLICT(account_key) DO UPDATE SET
      x = excluded.x, y = excluded.y, dir = excluded.dir, updated_at = excluded.updated_at
  `);
  const selectHumanSnapshot = raw.prepare(
    "SELECT account_key as accountKey, x, y, dir FROM human_snapshot WHERE account_key = ?",
  );

  const insertPublicChat = raw.prepare(
    "INSERT INTO public_chat_log (id, ts, player_id, username, text) VALUES (@id, @ts, @playerId, @username, @text)",
  );
  const selectAllPublicChat = raw.prepare(
    "SELECT id, ts, player_id as playerId, username, text FROM public_chat_log ORDER BY ts ASC",
  );

  const insertHumanInteraction = raw.prepare(
    `INSERT INTO human_interaction_log (id, ts, account_key, kind, target_id, role, text)
     VALUES (@id, @ts, @accountKey, @kind, @targetId, @role, @text)`,
  );
  const selectRecentHumanInteraction = raw.prepare(
    `SELECT id, ts, account_key as accountKey, kind, target_id as targetId, role, text
     FROM human_interaction_log WHERE account_key = ? ORDER BY ts DESC LIMIT ?`,
  );

  const insertAccessLog = raw.prepare(
    "INSERT INTO access_log (id, ts, username, account_key) VALUES (@id, @ts, @username, @accountKey)",
  );
  const selectAccessLogCount = raw.prepare("SELECT COUNT(*) as count FROM access_log");
  const selectAgentConversationCount = raw.prepare("SELECT COUNT(*) as count FROM agent_log WHERE text LIKE ?");
  const AGENT_CONVERSATION_MARKER = "\u{1F4AC}%"; // 💬 - see countAgentConversationLines's docstring

  return {
    saveMemoryEntry(entry) {
      insertMemory.run(entry);
    },
    loadMemoryEntries(agentId, limit) {
      const rows = selectMemory.all(agentId, limit) as MemoryEntry[];
      return rows.reverse(); // DESC for the LIMIT, then back to oldest-first for callers
    },

    saveExperimentRun(run) {
      insertRun.run({
        id: run.id,
        ts: run.ts,
        requestedBy: run.requestedBy,
        mechanism: run.mechanism,
        material: run.config.material,
        sequence: run.config.sequence.join(""),
        informationContent: run.measured.informationContent,
        bulkModulus: run.measured.bulkModulus,
        meetsTarget: run.meetsTarget ? 1 : 0,
      });
    },
    loadRecentExperimentRuns(limit) {
      const rows = selectRuns.all(limit) as {
        id: string;
        ts: number;
        requested_by: ExperimentRun["requestedBy"];
        mechanism: FaultMechanism;
        material: Material;
        sequence: string;
        information_content: number;
        bulk_modulus: number;
        meets_target: number;
      }[];
      return rows
        .map(
          (r): ExperimentRun => ({
            id: r.id,
            ts: r.ts,
            requestedBy: r.requested_by,
            mechanism: r.mechanism,
            config: { material: r.material, sequence: r.sequence.split("") as StackingSymbol[] } as CrystalConfig,
            measured: { informationContent: r.information_content, bulkModulus: r.bulk_modulus },
            meetsTarget: r.meets_target === 1,
          }),
        )
        .reverse();
    },

    saveAgentLogEntry(entry) {
      insertLog.run(entry);
    },
    loadRecentAgentLog(limit) {
      const rows = selectLog.all(limit) as AgentLogEntry[];
      return rows.reverse();
    },
    loadAllAgentLog() {
      return selectAllLog.all() as AgentLogEntry[];
    },

    saveAgentSnapshot(snapshot) {
      upsertSnapshot.run({ ...snapshot, updatedAt: Date.now() });
    },
    loadAgentSnapshot(npcId) {
      const row = selectSnapshot.get(npcId) as AgentSnapshot | undefined;
      return row;
    },

    saveTarget(target) {
      upsertTarget.run({ property: target.property, min: target.min ?? null, max: target.max ?? null, note: target.note });
    },
    loadTarget() {
      const row = selectTarget.get() as { property: TargetSpec["property"]; min: number | null; max: number | null; note: string } | undefined;
      if (!row) return undefined;
      return { property: row.property, min: row.min ?? undefined, max: row.max ?? undefined, note: row.note };
    },

    saveHumanSnapshot(snapshot) {
      upsertHumanSnapshot.run({ ...snapshot, updatedAt: Date.now() });
    },
    loadHumanSnapshot(accountKey) {
      return selectHumanSnapshot.get(accountKey) as HumanSnapshot | undefined;
    },

    savePublicChatMessage(msg) {
      insertPublicChat.run({ id: msg.id, ts: msg.ts, playerId: msg.playerId, username: msg.username, text: msg.text });
    },
    loadAllPublicChatLog() {
      return selectAllPublicChat.all() as ChatMessage[];
    },

    saveHumanInteractionEntry(entry) {
      insertHumanInteraction.run(entry);
    },
    loadRecentHumanInteractionLog(accountKey, limit) {
      const rows = selectRecentHumanInteraction.all(accountKey, limit) as HumanInteractionEntry[];
      return rows.reverse();
    },

    saveAccessLogEntry(entry) {
      insertAccessLog.run(entry);
    },
    countAccessLogEntries() {
      return (selectAccessLogCount.get() as { count: number }).count;
    },
    countAgentConversationLines() {
      return (selectAgentConversationCount.get(AGENT_CONVERSATION_MARKER) as { count: number }).count;
    },

    close() {
      raw.close();
    },
  };
}
