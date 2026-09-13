import type { Direction, MapMeta } from "./mapTypes.js";

export type Gender = "male" | "female";

export interface PlayerState {
  id: string;
  username: string;
  x: number;
  y: number;
  dir: Direction;
  gender: Gender;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  username: string;
  text: string;
  ts: number;
}

/** Which npcIds are LLM agents (see server/src/agents/personas.ts) rather than static
 * flavor NPCs - the single source of truth both client and server key off of, so
 * "is this NPC alive and moving, or a fixed sprite with canned lines" never drifts
 * out of sync between them. */
export const AGENT_NPC_IDS = ["lab_scientist", "theoretical_scientist"] as const;
export type AgentNpcId = (typeof AGENT_NPC_IDS)[number];

/** Minor background-flavor NPCs (2 in the Workshop, 2 in the Primary Lab, 2 in the
 * Office, 3 in the Kitchen) that intentionally have NO persistent floating name label
 * above their sprite, unlike other NPCs - meant to populate a room without drawing
 * attention the way a named character does. Still fully interactive: walking up and
 * pressing E shows a normal interaction prompt and opens canned dialogue (see
 * server/src/data/npcDialogue.ts) - only the always-visible overhead label is
 * suppressed (client/src/entities/Npc.ts's `showLabel`). Map placement (position +
 * matching `npcId` custom property) is done by hand in Tiled, same as every other NPC. */
export const BACKGROUND_NPC_IDS = [
  "workshop_worker_1",
  "workshop_worker_2",
  "lab_worker_1",
  "lab_worker_2",
  "office_worker_1",
  "office_worker_2",
  "kitchen_worker_1",
  "kitchen_worker_2",
  "kitchen_worker_3",
] as const;
export type BackgroundNpcId = (typeof BACKGROUND_NPC_IDS)[number];

export type AgentActivity = "idle" | "moving" | "running_experiment" | "analyzing_data" | "conversing";

export interface AgentNpcState {
  npcId: string;
  x: number;
  y: number;
  dir: Direction;
  activity: AgentActivity;
}

/** A line in the background agent activity feed (decisions, movement, arrivals) -
 * shown to every connected human as a timestamped log, separate from in-world chat. */
export interface AgentLogEntry {
  id: string;
  ts: number;
  npcId: string;
  text: string;
}

/** One logged experiment run, as shown on the office terminal's property-landscape
 * scatter plot. */
export interface TerminalScatterPoint {
  informationContent: number;
  bulkModulus: number;
  mechanism: string;
  meetsTarget: boolean;
}

/** The single best (highest-scoring) synthesized structure so far, shown as a layer-
 * stack diagram on the office terminal - all synthetic/fictional, see the "chaotic
 * layered crystals" science task (server/src/science/crystalDomain.ts). */
export interface TerminalStructureSnapshot {
  material: string;
  /** e.g. "HCHHCCHCHH..." - one character per layer, "H"/"C" stacking symbols. */
  sequence: string;
  mechanism: string;
  informationContent: number;
  bulkModulus: number;
  meetsTarget: boolean;
}

/** One logged run's measured properties against the noise-free theoretical prediction
 * for that exact structure (crystalDomain.ts's evaluateGroundTruth) - a real parity/
 * calibration comparison, not fabricated: the recorded `measured` value already IS
 * ground truth plus Gaussian noise (crystalDomain.ts's measure()), so this just makes
 * that existing noise model visible. Shown on the lab terminal. */
export interface TerminalCalibrationPoint {
  mechanism: string;
  meetsTarget: boolean;
  theoreticalInformationContent: number;
  experimentalInformationContent: number;
  /** The Gaussian noise sigma actually used when this was measured (see
   * crystalDomain.ts's INFO_CONTENT_NOISE_SIGMA) - the error-bar half-width. */
  informationContentUncertainty: number;
  theoreticalBulkModulus: number;
  experimentalBulkModulus: number;
  bulkModulusUncertainty: number;
}

/** Everything a computer terminal's data panel needs to render - sent with
 * computer_opened and refreshed on every computer_response so the panel stays current
 * as the human keeps the session open (live mode only meaningfully changes between
 * messages; in replay mode it's a fixed snapshot of the recorded day).
 *
 * The office terminal ("characterization") shows the theorist's high-level view - best
 * structure so far, overall property landscape. The lab terminal ("calibration") shows
 * the experimentalist's raw-measurement view - how individual readings compare to the
 * underlying theoretical prediction, with real instrument uncertainty. Both are built
 * from the exact same underlying experiment log (see server/src/science/terminalVisualization.ts). */
export type TerminalVisualization =
  | {
      kind: "characterization";
      headline: string;
      structure: TerminalStructureSnapshot | null;
      scatter: {
        points: TerminalScatterPoint[];
        targetProperty: "informationContent" | "bulkModulus";
        targetMin?: number;
        targetMax?: number;
      };
    }
  | {
      kind: "calibration";
      headline: string;
      points: TerminalCalibrationPoint[];
    };

/** This lab's productivity dashboard - two counts derived from real recorded data
 * (agent-to-agent chat lines, successful human joins/logins), two labels currently
 * hardcoded server-side rather than computed (see server/src/socket/handlers.ts's
 * productivity_open handler). */
export interface ProductivityStats {
  agentInteractionCount: number;
  humanAccessCount: number;
  productivityScoreLabel: string;
  efficiencyScoreLabel: string;
  simulationMatchLabel: string;
}

// Client -> Server events
export interface ClientToServerEvents {
  join: (payload: { username: string; gender: Gender }) => void;
  login: (payload: { username: string; password: string }) => void;
  move: (payload: { seq: number; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }) => void;
  chat_message: (payload: { text: string }) => void;
  npc_interact: (payload: { npcId: string }) => void;
  computer_open: (payload: { computerId: string }) => void;
  computer_message: (payload: { sessionId: string; text: string }) => void;
  computer_close: (payload: { sessionId: string }) => void;
  npc_chat_open: (payload: { npcId: string }) => void;
  npc_chat_message: (payload: { sessionId: string; text: string }) => void;
  npc_chat_close: (payload: { sessionId: string }) => void;
  productivity_open: () => void;
}

// Server -> Client events
export interface ServerToClientEvents {
  join_ack: (payload: {
    playerId: string;
    players: PlayerState[];
    mapMeta: MapMeta;
    chatLogTail: ChatMessage[];
    agents: AgentNpcState[];
    agentLogTail: AgentLogEntry[];
  }) => void;
  login_error: (payload: { message: string }) => void;
  join_error: (payload: { message: string }) => void;
  state_sync: (payload: { tick: number; players: PlayerState[]; agents: AgentNpcState[] }) => void;
  player_joined: (payload: { player: PlayerState }) => void;
  player_left: (payload: { playerId: string }) => void;
  chat_message: (payload: ChatMessage) => void;
  npc_dialogue: (payload: { npcId: string; lines: string[] }) => void;
  computer_opened: (payload: { computerId: string; sessionId: string; visualization: TerminalVisualization }) => void;
  computer_response: (payload: { sessionId: string; text: string; visualization: TerminalVisualization }) => void;
  computer_error: (payload: { sessionId: string; message: string }) => void;
  npc_chat_opened: (payload: { npcId: string; sessionId: string }) => void;
  npc_chat_response: (payload: { sessionId: string; text: string }) => void;
  npc_chat_error: (payload: { sessionId: string; message: string }) => void;
  agent_log: (payload: AgentLogEntry) => void;
  productivity_data: (payload: ProductivityStats) => void;
}

export const TICK_RATE_HZ = 20;
export const INTERACT_RANGE_TILES = 1.5;
export const PLAYER_SPEED_PX_PER_SEC = 110;

/** Tile layers whose non-zero tiles block movement (checked by both client and server
 * against their own copy of the map, same as PLAYER_SPEED/collision box above -
 * "ground" is deliberately excluded, it's just floor). A map without one of these
 * layers (e.g. no "pc" layer) simply contributes nothing to collision.
 *
 * "chairs" is NOT here on purpose - standing on a chair tile doesn't block movement,
 * it triggers a seated pose instead (see SITTABLE_LAYER_NAME / the sit sprite). */
export const COLLISION_LAYER_NAMES = ["walls", "furniture", "pc"];
export const SITTABLE_LAYER_NAME = "chairs";
