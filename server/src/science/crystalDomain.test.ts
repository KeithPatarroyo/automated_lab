import { describe, expect, it } from "vitest";
import {
  BULK_MODULUS_QUADRATIC_COEFFICIENT,
  DEFAULT_TARGET,
  evaluateGroundTruth,
  formatSequence,
  generateConfig,
  makeRng,
  measure,
  meetsTarget,
  proposeNextConfig,
  type ScoredRun,
} from "./crystalDomain.js";

// Averaging measure() over many rng draws cancels out the zero-mean Gaussian noise,
// isolating the deterministic instrument-response curve underneath it.
function averagedBulkModulus(cfg: Parameters<typeof measure>[0], samples: number): number {
  let total = 0;
  for (let i = 0; i < samples; i++) total += measure(cfg, makeRng(i + 1)).bulkModulus;
  return total / samples;
}

describe("generateConfig", () => {
  it("is deterministic for a given seed", () => {
    const a = generateConfig("growth", { length: 20 }, makeRng(42));
    const b = generateConfig("growth", { length: 20 }, makeRng(42));
    expect(formatSequence(a.sequence)).toBe(formatSequence(b.sequence));
  });

  it("produces different sequences for different mechanisms from the same seed", () => {
    const thermal = generateConfig("thermal", { length: 30, intensity: 0.3 }, makeRng(7));
    const contaminant = generateConfig("contaminant", { length: 30, intensity: 0.3 }, makeRng(7));
    const growth = generateConfig("growth", { length: 30, intensity: 0.3 }, makeRng(7));
    const seqs = [thermal, contaminant, growth].map((c) => formatSequence(c.sequence));
    expect(new Set(seqs).size).toBe(3);
  });

  it("always produces exactly `length` symbols from only H/C", () => {
    for (const mechanism of ["thermal", "contaminant", "growth"] as const) {
      const cfg = generateConfig(mechanism, { length: 50 }, makeRng(1));
      expect(cfg.sequence).toHaveLength(50);
      expect(cfg.sequence.every((s) => s === "H" || s === "C")).toBe(true);
    }
  });
});

describe("evaluateGroundTruth", () => {
  it("is a pure function of the sequence (same input -> same output)", () => {
    const cfg = generateConfig("growth", { length: 24 }, makeRng(99));
    expect(evaluateGroundTruth(cfg)).toEqual(evaluateGroundTruth(cfg));
  });

  it("is not monotonic in H-fraction alone (two configs, same H-count, different scores)", () => {
    const a = { material: "SiC" as const, sequence: "HHHHCCCC".split("") as ("H" | "C")[] };
    const b = { material: "SiC" as const, sequence: "HCHCHCHC".split("") as ("H" | "C")[] };
    const scoreA = evaluateGroundTruth(a).bulkModulus;
    const scoreB = evaluateGroundTruth(b).bulkModulus;
    expect(scoreA).not.toBeCloseTo(scoreB, 5);
  });
});

describe("measure", () => {
  it("scatters around the ground truth rather than reproducing it exactly", () => {
    const cfg = generateConfig("growth", { length: 20 }, makeRng(5));
    const truth = evaluateGroundTruth(cfg);
    const m1 = measure(cfg, makeRng(1));
    const m2 = measure(cfg, makeRng(2));
    expect(m1).not.toEqual(m2);
    expect(Math.abs(m1.informationContent - truth.informationContent)).toBeLessThan(5);
  });

  it("informationContent stays a direct linear read of ground truth (mean over noise matches truth)", () => {
    const cfg = generateConfig("thermal", { length: 20 }, makeRng(11));
    const truth = evaluateGroundTruth(cfg);
    let total = 0;
    const samples = 200;
    for (let i = 0; i < samples; i++) total += measure(cfg, makeRng(i + 1)).informationContent;
    expect(total / samples).toBeCloseTo(truth.informationContent, 0);
  });

  it("bulkModulus has a quadratic (not linear) response to ground truth - deviates further from truth the further truth sits from the 50 baseline", () => {
    // Two configs whose ground-truth bulkModulus sit at different distances from the
    // baseline (50) - the one further out should show a larger systematic offset
    // between its averaged (noise-cancelled) measurement and its own ground truth.
    let near: ReturnType<typeof generateConfig> | undefined;
    let far: ReturnType<typeof generateConfig> | undefined;
    for (let seed = 1; seed < 200 && (!near || !far); seed++) {
      const cfg = generateConfig("growth", { length: 20 }, makeRng(seed));
      const truth = evaluateGroundTruth(cfg);
      const dist = Math.abs(truth.bulkModulus - 50);
      if (!near && dist < 3) near = cfg;
      if (!far && dist > 15) far = cfg;
    }
    expect(near).toBeDefined();
    expect(far).toBeDefined();

    const nearTruth = evaluateGroundTruth(near!).bulkModulus;
    const farTruth = evaluateGroundTruth(far!).bulkModulus;
    const nearOffset = Math.abs(averagedBulkModulus(near!, 300) - nearTruth);
    const farOffset = Math.abs(averagedBulkModulus(far!, 300) - farTruth);

    expect(farOffset).toBeGreaterThan(nearOffset);
    // Sanity-check the offset roughly matches the documented quadratic formula.
    const expectedFarOffset = BULK_MODULUS_QUADRATIC_COEFFICIENT * (farTruth - 50) ** 2;
    expect(farOffset).toBeCloseTo(expectedFarOffset, 0);
  });
});

describe("meetsTarget / DEFAULT_TARGET", () => {
  it("accepts values at or above a min threshold and rejects below", () => {
    expect(meetsTarget({ informationContent: 10, bulkModulus: 0 }, DEFAULT_TARGET)).toBe(true);
    expect(meetsTarget({ informationContent: 1, bulkModulus: 0 }, DEFAULT_TARGET)).toBe(false);
  });
});

describe("proposeNextConfig", () => {
  it("falls back to a fresh config when there is no history", () => {
    const cfg = proposeNextConfig([], DEFAULT_TARGET, 16, makeRng(3));
    expect(cfg.sequence).toHaveLength(16);
  });

  it("tends to move scores toward the target over successive generations", () => {
    // Measurement noise (sigma 0.35, see measure()) means any one run is unreliable -
    // average over enough generations that the search's actual bias toward the target
    // dominates the per-run noise, rather than comparing a handful of noisy samples.
    const rng = makeRng(123);
    let history: ScoredRun[] = [];
    let config = generateConfig("thermal", { length: 20 }, rng);
    let measured = measure(config, rng);
    history.push({ config, measured });

    const scores: number[] = [measured.informationContent];
    for (let gen = 0; gen < 80; gen++) {
      config = proposeNextConfig(history, DEFAULT_TARGET, 20, rng);
      measured = measure(config, rng);
      history.push({ config, measured });
      scores.push(measured.informationContent);
    }

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const earlyAvg = mean(scores.slice(0, 20));
    const lateAvg = mean(scores.slice(-20));
    expect(lateAvg).toBeGreaterThan(earlyAvg);
  });
});
