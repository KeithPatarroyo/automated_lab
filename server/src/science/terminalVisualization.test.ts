import { describe, expect, it } from "vitest";
import { buildTerminalSystemPrompt, buildTerminalVisualization } from "./terminalVisualization.js";
import { allRuns, recordRun, setTarget } from "./experimentLog.js";
import { evaluateGroundTruth, INFO_CONTENT_NOISE_SIGMA } from "./crystalDomain.js";

// experimentLog is genuinely module-singleton state, shared with other test files run
// in the same process (same pattern already used by agentEngine.test.ts's applyAction
// tests) - assert on relative deltas from a captured baseline, not absolute counts.
function snapshot() {
  return { runCount: allRuns().length };
}

describe("buildTerminalVisualization('theoretical') - office terminal characterization view", () => {
  it("reports no data yet when nothing has been logged in this run of the suite and the log truly is empty", () => {
    const before = snapshot();
    if (before.runCount > 0) return; // only meaningful when genuinely empty
    const viz = buildTerminalVisualization("theoretical");
    expect(viz.kind).toBe("characterization");
    if (viz.kind !== "characterization") return;
    expect(viz.structure).toBeNull();
    expect(viz.scatter.points).toEqual([]);
    expect(viz.headline).toMatch(/no experiment data/i);
  });

  it("includes a newly recorded run in both the structure (if it's the best) and scatter points", () => {
    setTarget({ property: "informationContent", min: 999, note: "impossible target so meetsTarget is deterministically false" });
    const before = snapshot();
    recordRun("lab_scientist", "thermal", { material: "SiC", sequence: ["H", "C", "H", "H"] }, { informationContent: 5, bulkModulus: 40 });

    const viz = buildTerminalVisualization("theoretical");
    expect(viz.kind).toBe("characterization");
    if (viz.kind !== "characterization") return;
    expect(viz.scatter.points.length).toBe(Math.min(before.runCount + 1, 60));
    const last = viz.scatter.points[viz.scatter.points.length - 1];
    expect(last).toEqual({ informationContent: 5, bulkModulus: 40, mechanism: "thermal", meetsTarget: false });
  });

  it("structure reflects the best-scoring run, not just the most recent one", () => {
    setTarget({ property: "informationContent", min: 0, note: "any positive value counts" });
    recordRun("lab_scientist", "growth", { material: "ZnS", sequence: ["C", "C", "H"] }, { informationContent: 50, bulkModulus: 10 });
    recordRun("lab_scientist", "contaminant", { material: "SiC", sequence: ["H"] }, { informationContent: 1, bulkModulus: 1 });

    const viz = buildTerminalVisualization("theoretical");
    expect(viz.kind).toBe("characterization");
    if (viz.kind !== "characterization") return;
    expect(viz.structure).not.toBeNull();
    expect(viz.structure!.informationContent).toBeGreaterThanOrEqual(50);
    expect(viz.structure!.material).toBe("ZnS");
  });

  it("caps scatter points at the most recent 60, even with a much larger log", () => {
    setTarget({ property: "informationContent", min: 0, note: "any positive value counts" });
    for (let i = 0; i < 70; i++) {
      recordRun("lab_scientist", "growth", { material: "SiC", sequence: ["H"] }, { informationContent: i, bulkModulus: i });
    }
    const viz = buildTerminalVisualization("theoretical");
    expect(viz.kind).toBe("characterization");
    if (viz.kind !== "characterization") return;
    expect(viz.scatter.points.length).toBeLessThanOrEqual(60);
  });
});

describe("buildTerminalVisualization('experimental') - lab terminal calibration view", () => {
  it("reports no data yet when the log is genuinely empty", () => {
    const before = snapshot();
    if (before.runCount > 0) return;
    const viz = buildTerminalVisualization("experimental");
    expect(viz.kind).toBe("calibration");
    if (viz.kind !== "calibration") return;
    expect(viz.points).toEqual([]);
    expect(viz.headline).toMatch(/no experiment data/i);
  });

  it("pairs each run's real measured value with the recomputed noise-free theoretical prediction for that exact structure", () => {
    setTarget({ property: "informationContent", min: 0, note: "any positive value counts" });
    const config = { material: "SiC" as const, sequence: ["H", "C", "H", "H", "C"] as ("H" | "C")[] };
    const truth = evaluateGroundTruth(config);
    recordRun("lab_scientist", "thermal", config, { informationContent: truth.informationContent + 1.23, bulkModulus: truth.bulkModulus - 4.5 });

    const viz = buildTerminalVisualization("experimental");
    expect(viz.kind).toBe("calibration");
    if (viz.kind !== "calibration") return;
    const last = viz.points[viz.points.length - 1];
    expect(last.theoreticalInformationContent).toBeCloseTo(truth.informationContent, 5);
    expect(last.experimentalInformationContent).toBeCloseTo(truth.informationContent + 1.23, 5);
    expect(last.theoreticalBulkModulus).toBeCloseTo(truth.bulkModulus, 5);
    expect(last.experimentalBulkModulus).toBeCloseTo(truth.bulkModulus - 4.5, 5);
  });

  it("reports the real noise sigma actually used by measure(), not a made-up number", () => {
    setTarget({ property: "informationContent", min: 0, note: "any positive value counts" });
    recordRun("lab_scientist", "growth", { material: "SiC", sequence: ["H", "C"] }, { informationContent: 3, bulkModulus: 30 });
    const viz = buildTerminalVisualization("experimental");
    expect(viz.kind).toBe("calibration");
    if (viz.kind !== "calibration") return;
    const last = viz.points[viz.points.length - 1];
    expect(last.informationContentUncertainty).toBe(INFO_CONTENT_NOISE_SIGMA);
  });

  it("caps points at the most recent 40", () => {
    setTarget({ property: "informationContent", min: 0, note: "any positive value counts" });
    for (let i = 0; i < 50; i++) {
      recordRun("lab_scientist", "growth", { material: "SiC", sequence: ["H"] }, { informationContent: i, bulkModulus: i });
    }
    const viz = buildTerminalVisualization("experimental");
    expect(viz.kind).toBe("calibration");
    if (viz.kind !== "calibration") return;
    expect(viz.points.length).toBeLessThanOrEqual(40);
  });
});

describe("buildTerminalVisualization: the two perspectives draw on the same log but describe it differently", () => {
  it("produces different headlines and different kinds for the same underlying data", () => {
    setTarget({ property: "informationContent", min: 0, note: "any positive value counts" });
    recordRun("lab_scientist", "growth", { material: "SiC", sequence: ["H", "C"] }, { informationContent: 7, bulkModulus: 20 });

    const experimental = buildTerminalVisualization("experimental");
    const theoretical = buildTerminalVisualization("theoretical");
    expect(experimental.kind).toBe("calibration");
    expect(theoretical.kind).toBe("characterization");
    expect(experimental.headline).not.toBe(theoretical.headline);
  });
});

describe("buildTerminalSystemPrompt", () => {
  const emptyCharacterization = { kind: "characterization" as const, headline: "No experiment data logged yet.", structure: null, scatter: { points: [], targetProperty: "informationContent" as const } };
  const emptyCalibration = { kind: "calibration" as const, headline: "No experiment data logged yet.", points: [] };

  it("names the correct role for lab_terminal vs office_terminal", () => {
    const lab = buildTerminalSystemPrompt("lab_terminal", [], emptyCalibration);
    const office = buildTerminalSystemPrompt("office_terminal", [], emptyCharacterization);
    expect(lab).toMatch(/experimentalist/i);
    expect(office).toMatch(/theoretical scientist/i);
  });

  it("includes the characterization headline and structure description verbatim", () => {
    const viz = {
      kind: "characterization" as const,
      headline: "3 runs logged - best result: 9.50 informationContent (thermal-faulted SiC).",
      structure: { material: "SiC", sequence: "HCHH", mechanism: "thermal", informationContent: 9.5, bulkModulus: 55, meetsTarget: true },
      scatter: { points: [], targetProperty: "informationContent" as const, targetMin: 6 },
    };
    const prompt = buildTerminalSystemPrompt("office_terminal", [], viz);
    expect(prompt).toContain(viz.headline);
    expect(prompt).toContain("HCHH");
    expect(prompt).toContain("9.50");
  });

  it("describes the calibration view's average deviation, not a made-up structure", () => {
    const viz = {
      kind: "calibration" as const,
      headline: "2 measurements logged.",
      points: [
        { mechanism: "thermal", meetsTarget: true, theoreticalInformationContent: 5, experimentalInformationContent: 5.5, informationContentUncertainty: 0.35, theoreticalBulkModulus: 50, experimentalBulkModulus: 51, bulkModulusUncertainty: 1.4 },
        { mechanism: "growth", meetsTarget: false, theoreticalInformationContent: 3, experimentalInformationContent: 2.5, informationContentUncertainty: 0.35, theoreticalBulkModulus: 40, experimentalBulkModulus: 39, bulkModulusUncertainty: 1.4 },
      ],
    };
    const prompt = buildTerminalSystemPrompt("lab_terminal", [], viz);
    expect(prompt).toContain(viz.headline);
    expect(prompt).toMatch(/theory-vs-experiment/i);
    expect(prompt).not.toContain("undefined");
  });

  it("includes recent memory entries when given", () => {
    const prompt = buildTerminalSystemPrompt("office_terminal", [{ id: "1", agentId: "theoretical_scientist", ts: 0, kind: "reflection", text: "hit a 10-bit ceiling" }], emptyCharacterization);
    expect(prompt).toContain("hit a 10-bit ceiling");
  });

  it("instructs the model not to invent data not given", () => {
    const prompt = buildTerminalSystemPrompt("lab_terminal", [], emptyCalibration);
    expect(prompt).toMatch(/don't invent/i);
  });
});
