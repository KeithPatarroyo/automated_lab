import type { TerminalCalibrationPoint, TerminalVisualization } from "@lab/shared";
import type { MemoryEntry } from "../agents/memoryStore.js";
import { BULK_MODULUS_NOISE_SIGMA_MULTIPLIER, evaluateGroundTruth, formatSequence, INFO_CONTENT_NOISE_SIGMA } from "./crystalDomain.js";
import { allRuns, bestRun, getTarget } from "./experimentLog.js";

// Keep the plotted set bounded - all runs would grow unbounded over a long session,
// and a plot with hundreds of overlapping points/error bars stops being readable
// anyway. Most recent N is a reasonable "what's been happening lately" window for a
// terminal display, distinct from experimentLog's own internal RUN_LOG_LIMIT (500).
const SCATTER_POINT_LIMIT = 60;
const CALIBRATION_POINT_LIMIT = 40; // fewer than the scatter - error bars get busy faster

const BULK_MODULUS_NOISE_SIGMA = INFO_CONTENT_NOISE_SIGMA * BULK_MODULUS_NOISE_SIGMA_MULTIPLIER;

/** Office terminal: the theorist's high-level view - the best structure found so far
 * plus the overall information-content/bulk-modulus landscape across recent runs. */
function buildCharacterizationVisualization(): TerminalVisualization {
  const runs = allRuns();
  const target = getTarget();
  const best = bestRun();

  const points = runs.slice(-SCATTER_POINT_LIMIT).map((r) => ({
    informationContent: r.measured.informationContent,
    bulkModulus: r.measured.bulkModulus,
    mechanism: r.mechanism,
    meetsTarget: r.meetsTarget,
  }));

  const structure = best
    ? {
        material: best.config.material,
        sequence: formatSequence(best.config.sequence),
        mechanism: best.mechanism,
        informationContent: best.measured.informationContent,
        bulkModulus: best.measured.bulkModulus,
        meetsTarget: best.meetsTarget,
      }
    : null;

  const headline =
    !best || runs.length === 0
      ? "No experiment data logged yet."
      : `Characterizing ${runs.length} logged configuration${runs.length === 1 ? "" : "s"} - current best: ` +
        `${best.measured[target.property].toFixed(2)} ${target.property}. Target: ${target.note}`;

  return {
    kind: "characterization",
    headline,
    structure,
    scatter: {
      points,
      targetProperty: target.property,
      targetMin: target.min,
      targetMax: target.max,
    },
  };
}

/** Lab terminal: the experimentalist's raw-measurement view - how individual readings
 * compare to the underlying theoretical prediction, with real instrument uncertainty.
 * Genuinely grounded, not fabricated: every logged run's `measured` value already IS
 * the ground-truth prediction plus Gaussian noise (crystalDomain.ts's measure()) - this
 * just recomputes that same noise-free ground truth for display alongside it. */
function buildCalibrationVisualization(): TerminalVisualization {
  const runs = allRuns();
  const recent = runs.slice(-CALIBRATION_POINT_LIMIT);

  const points: TerminalCalibrationPoint[] = recent.map((r) => {
    const truth = evaluateGroundTruth(r.config);
    return {
      mechanism: r.mechanism,
      meetsTarget: r.meetsTarget,
      theoreticalInformationContent: truth.informationContent,
      experimentalInformationContent: r.measured.informationContent,
      informationContentUncertainty: INFO_CONTENT_NOISE_SIGMA,
      theoreticalBulkModulus: truth.bulkModulus,
      experimentalBulkModulus: r.measured.bulkModulus,
      bulkModulusUncertainty: BULK_MODULUS_NOISE_SIGMA,
    };
  });

  const headline =
    runs.length === 0
      ? "No experiment data logged yet."
      : `${runs.length} measurement${runs.length === 1 ? "" : "s"} logged - raw readings vs. the underlying theoretical ` +
        `model, with instrument uncertainty (±${INFO_CONTENT_NOISE_SIGMA.toFixed(2)} information content, ` +
        `±${BULK_MODULUS_NOISE_SIGMA.toFixed(2)} bulk modulus).`;

  return { kind: "calibration", headline, points };
}

/** Builds the (synthetic, for-show) data panel content for a computer terminal, purely
 * from the shared experiment log - both terminals draw on the same underlying runs
 * (there's only one shared log), but show genuinely different views: "experimental"
 * (lab terminal) gets the calibration/uncertainty view, "theoretical" (office terminal)
 * gets the characterization view. */
export function buildTerminalVisualization(perspective: "experimental" | "theoretical"): TerminalVisualization {
  return perspective === "experimental" ? buildCalibrationVisualization() : buildCharacterizationVisualization();
}

function describeVisualizationForPrompt(visualization: TerminalVisualization): string {
  if (visualization.kind === "characterization") {
    return visualization.structure
      ? `The structure diagram on screen shows the best result so far: a ${visualization.structure.mechanism}-faulted ` +
          `${visualization.structure.material} polytype, stacking sequence "${visualization.structure.sequence}" ` +
          `(information content ${visualization.structure.informationContent.toFixed(2)}, bulk modulus ` +
          `${visualization.structure.bulkModulus.toFixed(2)}, ${visualization.structure.meetsTarget ? "meets" : "does not yet meet"} the target spec).`
      : "No structure has been synthesized yet, so the structure panel is empty.";
  }
  if (visualization.points.length === 0) return "No measurements have been logged yet, so the calibration panel is empty.";
  const diffs = visualization.points.map((p) => Math.abs(p.experimentalInformationContent - p.theoreticalInformationContent));
  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return (
    `The screen shows a theory-vs-experiment comparison: each logged run's raw measured information content and ` +
    `bulk modulus plotted against the noise-free theoretical prediction for that exact structure, with error bars ` +
    `showing the instrument's real measurement uncertainty. Average deviation between experiment and theory across ` +
    `${visualization.points.length} points: ${avgDiff.toFixed(2)} information content.`
  );
}

/** Grounds the human-facing terminal chat in the same real (synthetic) data the panel
 * is showing, plus whichever scientist's own recent notes are relevant - so "what is
 * this?" gets answered from the actual numbers on screen, not invented ones. */
export function buildTerminalSystemPrompt(
  computerId: string,
  recentMemory: MemoryEntry[],
  visualization: TerminalVisualization,
): string {
  const memoryLines = recentMemory.length ? recentMemory.map((m) => `- [${m.kind}] ${m.text}`).join("\n") : "(no notes logged yet)";
  const panelDescription = describeVisualizationForPrompt(visualization);

  const role =
    computerId === "lab_terminal"
      ? "the automated-experiment terminal in the Primary Lab, which the lab's experimentalist uses to run the closed-loop crystal grower"
      : "the office terminal, which the lab's theoretical scientist uses to analyze and characterize the experimentalist's data";

  return (
    `You are ${role}, in a simulated research lab studying 'chaotic layered crystals' - faulted polytypes of a ` +
    `layered semiconductor (silicon carbide or zinc sulfide), searching for stacking configurations with unusual ` +
    `information-content/bulk-property tradeoffs. Everything shown and discussed is synthetic/fictional data for ` +
    `a simulation, not real physics results.\n\n` +
    `A human researcher just walked up and is looking at your screen, which currently shows:\n\n` +
    `${visualization.headline}\n${panelDescription}\n\n` +
    `Recent notes from the scientist who uses this terminal:\n${memoryLines}\n\n` +
    `Answer the human's questions about what's on screen and what the scientists have been doing, grounded ONLY ` +
    `in the real data and notes given above - don't invent numbers, structures, or events that aren't given. If ` +
    `they ask something the data above doesn't cover, say so plainly rather than making it up. Keep replies under ` +
    `~150 words unless they ask for more detail.`
  );
}
