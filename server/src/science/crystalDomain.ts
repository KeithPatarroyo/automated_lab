/**
 * Fictional "chaotic layered crystals" closed-loop discovery domain - loosely modeled
 * on real close-packed polytype stacking-fault physics (SiC/ZnS polytypism, see
 * https://doi.org/10.1098/rsta.2015.0067), but the property model below is invented,
 * not a physical simulation. It exists to give the automated-experiment and
 * theoretical-scientist agents a genuine closed loop to run: generate a stacking
 * configuration, measure it, decide if it's worth keeping, propose the next one.
 *
 * A material is a sequence of local stacking symbols ("H" = hexagonal-like local
 * environment, "C" = cubic-like), the same coarse alphabet real polytype literature
 * uses for SiC/ZnS. Sequence length is a free parameter - the space to search grows as
 * 2^N, so difficulty is unbounded in principle even though any one run uses a finite N.
 */

export type StackingSymbol = "H" | "C";
export type Material = "SiC" | "ZnS";
export type FaultMechanism = "thermal" | "contaminant" | "growth";

export interface CrystalConfig {
  material: Material;
  sequence: StackingSymbol[];
}

export interface MeasuredProperties {
  /** Configurational information content - a stand-in for computational-application
   * relevance (e.g. usable state density for information encoding in the stacking
   * order itself). Roughly entropy-like, but reshaped nonlinearly so it isn't just a
   * restatement of sequence randomness. */
  informationContent: number;
  /** A bulk-property stand-in for engineering applications (e.g. an elastic-modulus-like
   * scalar). Deliberately non-monotonic in the fault pattern so there's no simple rule
   * an agent can shortcut to - has to actually search. */
  bulkModulus: number;
}

export interface CrystalGenerationOptions {
  length: number;
  material?: Material;
  /** Fault probability / perturbation strength, meaning depends on mechanism. */
  intensity?: number;
}

// --- deterministic PRNG (mulberry32) --------------------------------------------
// Same seed always reproduces the same run - useful for tests and for "regrowing" a
// reported-interesting configuration to double check it, without needing to persist
// anything beyond the seed.

export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSequence(sequence: StackingSymbol[]): number {
  let h = 2166136261;
  for (const s of sequence) {
    h ^= s.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- generation: how a configuration comes into being -----------------------------

/** A clean baseline lattice before any faulting is applied - alternating stacking,
 * the "perfect crystal" starting point every fault mechanism perturbs. */
function baselineSequence(length: number): StackingSymbol[] {
  return Array.from({ length }, (_, i) => (i % 2 === 0 ? "H" : "C"));
}

/** Thermal processing: independent, uncorrelated point flips - each layer has a small
 * independent chance of flipping, like thermal agitation kicking individual layers. */
function applyThermalFaulting(base: StackingSymbol[], intensity: number, rng: Rng): StackingSymbol[] {
  return base.map((s) => (rng() < intensity ? flip(s) : s));
}

/** Contaminant pinning: a contiguous run of layers gets flipped together, like an
 * impurity cluster locally disrupting growth over several layers at once. */
function applyContaminantFaulting(base: StackingSymbol[], intensity: number, rng: Rng): StackingSymbol[] {
  const out = base.slice();
  const clusterCount = 1 + Math.floor(intensity * 4);
  for (let c = 0; c < clusterCount; c++) {
    const start = Math.floor(rng() * out.length);
    const span = 1 + Math.floor(rng() * Math.max(1, out.length * 0.15));
    for (let i = start; i < Math.min(out.length, start + span); i++) {
      out[i] = flip(out[i]);
    }
  }
  return out;
}

/** Growth-condition faulting: sequential probabilistic layer-by-layer growth with a
 * per-step fault probability alpha, the classic faulted-growth model for polytype
 * stacking statistics - each new layer either continues the alternating pattern or
 * "faults" and repeats the previous layer's symbol instead. */
function applyGrowthFaulting(length: number, intensity: number, rng: Rng): StackingSymbol[] {
  const out: StackingSymbol[] = ["H"];
  for (let i = 1; i < length; i++) {
    const prev = out[i - 1];
    const faulted = rng() < intensity;
    out.push(faulted ? prev : flip(prev));
  }
  return out;
}

function flip(s: StackingSymbol): StackingSymbol {
  return s === "H" ? "C" : "H";
}

export function generateConfig(mechanism: FaultMechanism, opts: CrystalGenerationOptions, rng: Rng): CrystalConfig {
  const material = opts.material ?? "SiC";
  const intensity = opts.intensity ?? 0.15;
  const sequence =
    mechanism === "growth"
      ? applyGrowthFaulting(opts.length, intensity, rng)
      : mechanism === "contaminant"
        ? applyContaminantFaulting(baselineSequence(opts.length), intensity, rng)
        : applyThermalFaulting(baselineSequence(opts.length), intensity, rng);
  return { material, sequence };
}

// --- measurement: the (fictional) structure-property relationship ------------------

function windowScore(sequence: StackingSymbol[], windowSize: number, weight: (bits: number) => number): number {
  let total = 0;
  for (let i = 0; i + windowSize <= sequence.length; i++) {
    let bits = 0;
    for (let j = 0; j < windowSize; j++) {
      bits = (bits << 1) | (sequence[i + j] === "H" ? 1 : 0);
    }
    total += weight(bits);
  }
  return total;
}

/** Deterministic ground-truth property model (before measurement noise). Both outputs
 * are nonlinear, non-monotonic functions of local stacking patterns - deliberately
 * "chaotic" so nearby configurations can score very differently, the way real
 * structure-property landscapes in faulted polytypes can. */
export function evaluateGroundTruth(config: CrystalConfig): MeasuredProperties {
  const seq = config.sequence;
  const n = seq.length;
  if (n === 0) return { informationContent: 0, bulkModulus: 0 };

  // Shannon-like entropy of the H/C symbol distribution, reshaped through a sine so it
  // isn't a simple monotonic "more disordered = more information" reading.
  const hCount = seq.filter((s) => s === "H").length;
  const p = hCount / n;
  const entropy = p <= 0 || p >= 1 ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
  const seedTerm = (hashSequence(seq) % 1000) / 1000;
  const informationContent = 5 * (entropy * (0.6 + 0.4 * Math.sin(seedTerm * Math.PI * 4 + entropy * 6)) + 1);

  // Bulk-property stand-in: a weighted sum over 4-symbol local windows, each window's
  // contribution shaped by a nonlinear (non-monotonic) function of its bit pattern -
  // so no single local motif is simply "better", combinations matter.
  const raw = windowScore(seq, 4, (bits) => Math.sin(bits * 1.7) * Math.cos(bits * 0.9 + 1));
  const normalized = n > 3 ? raw / (n - 3) : 0;
  const bulkModulus = BULK_MODULUS_BASELINE + 20 * normalized + 5 * Math.sin(hashSequence(seq) * 0.0000001);

  return { informationContent, bulkModulus };
}

// The additive baseline both evaluateGroundTruth's bulkModulus formula and the
// instrument-response curve below are centered on - named once so the two stay in sync.
const BULK_MODULUS_BASELINE = 50;

// Named (not just inlined in measure()'s default param) so anything describing the
// instrument's real uncertainty - e.g. the lab terminal's theory-vs-experiment
// visualization - references the actual value in use rather than a duplicated magic
// number that could silently drift out of sync if the noise model is ever retuned.
export const INFO_CONTENT_NOISE_SIGMA = 0.35;
export const BULK_MODULUS_NOISE_SIGMA_MULTIPLIER = 4;

// The bulk-modulus instrument has a genuine quadratic (not linear) response to the true
// value - readings near BULK_MODULUS_BASELINE come back close to the theoretical
// prediction, but the deviation grows quadratically the further the true value sits
// from that center, in either direction. This is a deliberate nonlinearity (a common
// real sensor-calibration motif) so the lab terminal's theory-vs-experiment parity plot
// shows a genuine curve away from the y=x line, not just noise scattered around it -
// unlike information content, which stays a direct linear+noise read.
export const BULK_MODULUS_QUADRATIC_COEFFICIENT = 0.01;

function bulkModulusInstrumentResponse(theoreticalBulkModulus: number): number {
  const deviation = theoreticalBulkModulus - BULK_MODULUS_BASELINE;
  return theoreticalBulkModulus + BULK_MODULUS_QUADRATIC_COEFFICIENT * deviation * deviation;
}

/** What an actual measurement returns: ground truth run through the instrument's
 * response curve (linear for information content, quadratic for bulk modulus - see
 * bulkModulusInstrumentResponse) plus Gaussian noise - this is the "test it" step of
 * the closed loop, and the reason repeated runs on the same config aren't perfectly
 * reproducible even though the ground truth function is. */
export function measure(config: CrystalConfig, rng: Rng, noiseSigma = INFO_CONTENT_NOISE_SIGMA): MeasuredProperties {
  const truth = evaluateGroundTruth(config);
  return {
    informationContent: truth.informationContent + gaussian(rng) * noiseSigma,
    bulkModulus: bulkModulusInstrumentResponse(truth.bulkModulus) + gaussian(rng) * noiseSigma * BULK_MODULUS_NOISE_SIGMA_MULTIPLIER,
  };
}

function gaussian(rng: Rng): number {
  // Box-Muller.
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// --- target spec / closed-loop acceptance ------------------------------------------

export interface TargetSpec {
  property: keyof MeasuredProperties;
  min?: number;
  max?: number;
  note: string;
}

export function meetsTarget(measured: MeasuredProperties, target: TargetSpec): boolean {
  const value = measured[target.property];
  if (target.min !== undefined && value < target.min) return false;
  if (target.max !== undefined && value > target.max) return false;
  return true;
}

export const DEFAULT_TARGET: TargetSpec = {
  property: "informationContent",
  min: 6,
  note:
    "Looking for stacking configurations with unusually high information content - candidates for " +
    "computational applications - without the bulk-property tradeoffs the baseline lattice shows.",
};

// --- next-candidate proposal (the "ML + classical methods" search step) -----------

export interface ScoredRun {
  config: CrystalConfig;
  measured: MeasuredProperties;
}

/** Local-search proposal: mutate/recombine the best-scoring configs seen so far,
 * biased toward the target property, with a small random-exploration rate so the
 * search doesn't collapse onto one local optimum. This stands in for the theoretical
 * scientist's "machine learning + classical methods" exploration - a simple genetic
 * local search, not a literal trained model, but a real optimization loop over real
 * accumulated data rather than a scripted/narrative-only decision. */
export function proposeNextConfig(
  history: ScoredRun[],
  target: TargetSpec,
  length: number,
  rng: Rng,
  material: Material = "SiC",
): CrystalConfig {
  if (history.length === 0) {
    return generateConfig("growth", { length, material, intensity: 0.2 }, rng);
  }

  const ranked = history
    .slice()
    .sort((a, b) => scoreTowardTarget(b.measured, target) - scoreTowardTarget(a.measured, target));
  const parents = ranked.slice(0, Math.max(1, Math.min(3, ranked.length)));

  const exploreRoll = rng();
  if (exploreRoll < 0.15) {
    // Occasional fresh exploration so the search doesn't get stuck near one optimum.
    return generateConfig("thermal", { length, material, intensity: 0.25 }, rng);
  }

  const parentA = parents[Math.floor(rng() * parents.length)].config.sequence;
  const parentB = parents[Math.floor(rng() * parents.length)].config.sequence;
  const len = Math.max(parentA.length, parentB.length, length);
  const child: StackingSymbol[] = [];
  for (let i = 0; i < len; i++) {
    const gene = rng() < 0.5 ? parentA[i % parentA.length] : parentB[i % parentB.length];
    child.push(rng() < 0.08 ? flip(gene) : gene);
  }
  return { material, sequence: child };
}

function scoreTowardTarget(measured: MeasuredProperties, target: TargetSpec): number {
  const value = measured[target.property];
  let score = 0;
  if (target.min !== undefined) score -= Math.max(0, target.min - value);
  if (target.max !== undefined) score -= Math.max(0, value - target.max);
  return score;
}

export function formatSequence(sequence: StackingSymbol[]): string {
  return sequence.join("");
}
