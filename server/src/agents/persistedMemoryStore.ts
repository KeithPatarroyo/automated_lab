import type { Db } from "../db/index.js";
import { InMemoryMemoryStore, type MemoryEntry, type MemoryKind, type MemoryStore } from "./memoryStore.js";

const HYDRATE_LIMIT = 500; // matches InMemoryMemoryStore's own default per-agent cap

/**
 * Wraps InMemoryMemoryStore (the fast, hot-path source of truth every decision reads
 * from) with a write-through to the database, and hydrates it from the database on
 * construction so an agent's memory survives a server restart. Everything else
 * (agentEngine.ts, runtime.ts) just sees a plain MemoryStore - it has no idea this one
 * happens to be durable.
 */
export class PersistedMemoryStore implements MemoryStore {
  private readonly inner = new InMemoryMemoryStore();

  constructor(
    private readonly db: Db,
    agentIds: string[],
  ) {
    for (const agentId of agentIds) {
      this.inner.hydrate(agentId, db.loadMemoryEntries(agentId, HYDRATE_LIMIT));
    }
  }

  record(agentId: string, kind: MemoryKind, text: string): MemoryEntry {
    const entry = this.inner.record(agentId, kind, text);
    this.db.saveMemoryEntry(entry);
    return entry;
  }

  recent(agentId: string, limit: number): MemoryEntry[] {
    return this.inner.recent(agentId, limit);
  }

  all(agentId: string): MemoryEntry[] {
    return this.inner.all(agentId);
  }
}
