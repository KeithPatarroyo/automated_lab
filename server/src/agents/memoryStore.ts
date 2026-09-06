import { nanoid } from "nanoid";

export type MemoryKind = "observation" | "action" | "reflection" | "chat";

export interface MemoryEntry {
  id: string;
  agentId: string;
  ts: number;
  kind: MemoryKind;
  text: string;
}

export interface MemoryStore {
  record(agentId: string, kind: MemoryKind, text: string): MemoryEntry;
  recent(agentId: string, limit: number): MemoryEntry[];
  all(agentId: string): MemoryEntry[];
}

/**
 * Recency-only memory for now - no importance/relevance scoring or embedding search
 * like the Generative Agents paper's memory stream. That's a reasonable v2 upgrade
 * once there's enough real memory volume to show recency-only picking the wrong
 * entries; premature to build retrieval ranking against an empty log.
 *
 * In-memory (lost on restart), same caveat as game/state.ts and science/experimentLog.ts -
 * first thing to move behind a real DB once this interface has proven itself out.
 */
export class InMemoryMemoryStore implements MemoryStore {
  private byAgent = new Map<string, MemoryEntry[]>();
  private readonly limitPerAgent: number;

  constructor(limitPerAgent = 500) {
    this.limitPerAgent = limitPerAgent;
  }

  record(agentId: string, kind: MemoryKind, text: string): MemoryEntry {
    const entry: MemoryEntry = { id: nanoid(), agentId, ts: Date.now(), kind, text };
    const list = this.byAgent.get(agentId) ?? [];
    list.push(entry);
    if (list.length > this.limitPerAgent) list.shift();
    this.byAgent.set(agentId, list);
    return entry;
  }

  recent(agentId: string, limit: number): MemoryEntry[] {
    const list = this.byAgent.get(agentId) ?? [];
    return list.slice(-limit);
  }

  all(agentId: string): MemoryEntry[] {
    return this.byAgent.get(agentId) ?? [];
  }

  /** Seeds an agent's memory from persisted entries (oldest first) - used to restore
   * state on startup. Not `record()` in a loop: these already have real ids/timestamps
   * from when they originally happened, which record() would otherwise overwrite. */
  hydrate(agentId: string, entries: MemoryEntry[]): void {
    this.byAgent.set(agentId, entries.slice(-this.limitPerAgent));
  }
}
