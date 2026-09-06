import { nanoid } from "nanoid";
import type { CrystalConfig, FaultMechanism, MeasuredProperties, TargetSpec } from "./crystalDomain.js";
import { DEFAULT_TARGET, meetsTarget } from "./crystalDomain.js";
import type { Db } from "../db/index.js";

export interface ExperimentRun {
  id: string;
  ts: number;
  requestedBy: "lab_scientist" | "theoretical_scientist" | "human";
  mechanism: FaultMechanism;
  config: CrystalConfig;
  measured: MeasuredProperties;
  meetsTarget: boolean;
}

// In-memory, same recency-capped pattern as agents/memoryStore.ts - db (below) is an
// optional write-through/hydration attachment, unset in tests, so every existing test
// calling recordRun()/recentRuns() directly keeps working with zero DB involvement.
const runs: ExperimentRun[] = [];
let target: TargetSpec = DEFAULT_TARGET;
const RUN_LOG_LIMIT = 500;
let db: Db | null = null;

/** Attaches durable storage: loads persisted runs/target (if any) into the in-memory
 * state, then keeps writing new ones through. Call once at server startup; tests that
 * never call this get the same pure in-memory behavior as before. */
export function hydrateExperimentLog(database: Db): void {
  db = database;
  const persisted = database.loadRecentExperimentRuns(RUN_LOG_LIMIT);
  runs.splice(0, runs.length, ...persisted);
  const persistedTarget = database.loadTarget();
  if (persistedTarget) target = persistedTarget;
}

export function getTarget(): TargetSpec {
  return target;
}

export function setTarget(next: TargetSpec): void {
  target = next;
  db?.saveTarget(next);
}

export function recordRun(
  requestedBy: ExperimentRun["requestedBy"],
  mechanism: FaultMechanism,
  config: CrystalConfig,
  measured: MeasuredProperties,
): ExperimentRun {
  const run: ExperimentRun = {
    id: nanoid(),
    ts: Date.now(),
    requestedBy,
    mechanism,
    config,
    measured,
    meetsTarget: meetsTarget(measured, target),
  };
  runs.push(run);
  if (runs.length > RUN_LOG_LIMIT) runs.shift();
  db?.saveExperimentRun(run);
  return run;
}

export function recentRuns(limit: number): ExperimentRun[] {
  return runs.slice(-limit);
}

export function allRuns(): ExperimentRun[] {
  return runs;
}

export function bestRun(): ExperimentRun | undefined {
  if (runs.length === 0) return undefined;
  return runs.reduce((best, r) => (scoreFor(r) > scoreFor(best) ? r : best));
}

function scoreFor(run: ExperimentRun): number {
  const value = run.measured[target.property];
  let score = -Math.abs(value);
  if (target.min !== undefined) score = value - target.min;
  if (target.max !== undefined) score = Math.min(score, target.max - value);
  return score;
}
