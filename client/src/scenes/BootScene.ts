import Phaser from "phaser";
import { createAgentAnimations, createPlayerAnimations } from "../entities/spriteFrames";
import { MAP_TILESETS } from "./mapTilesets";

const CHARACTERS_SHEET_PATH = "/assets/tilesets/kenney_rpg-urban-pack/Tilemap/tilemap_packed.png";
const PLAYER_LAB_MALE_SHEET_PATH = "/assets/sprites/player-walk-lab.png";
const PLAYER_OUTSIDE_MALE_SHEET_PATH = "/assets/sprites/player-walk-outside.png";
const PLAYER_SIT_LAB_MALE_SHEET_PATH = "/assets/sprites/player-sit-lab.png";
const PLAYER_SIT_OUTSIDE_MALE_SHEET_PATH = "/assets/sprites/player-sit-outside.png";
// Placeholder art (a copy of the male sheets) until real female-outfit source art is
// exported and client/scripts/extract-player-sprite.py is re-run to overwrite these -
// see that script's OUTFITS dict.
const PLAYER_LAB_FEMALE_SHEET_PATH = "/assets/sprites/player-walk-lab-female.png";
const PLAYER_OUTSIDE_FEMALE_SHEET_PATH = "/assets/sprites/player-walk-outside-female.png";
const PLAYER_SIT_LAB_FEMALE_SHEET_PATH = "/assets/sprites/player-sit-lab-female.png";
const PLAYER_SIT_OUTSIDE_FEMALE_SHEET_PATH = "/assets/sprites/player-sit-outside-female.png";
const WORKSHOP_WOMAN_SHEET_PATH = "/assets/sprites/workshop-woman.png";
const LAB_NPC_1_SHEET_PATH = "/assets/sprites/lab-npc-1.png";
const LAB_NPC_2_SHEET_PATH = "/assets/sprites/lab-npc-2.png";
const WORKSHOP_NPC_1_SHEET_PATH = "/assets/sprites/workshop-npc-1.png";
const WORKSHOP_NPC_2_SHEET_PATH = "/assets/sprites/workshop-npc-2.png";
const KITCHEN_COOK_SHEET_PATH = "/assets/sprites/kitchen-cook.png";
const KITCHEN_NPC_FACILITIES_COORDINATOR_SHEET_PATH = "/assets/sprites/kitchen-npc-facilities-coordinator.png";
const KITCHEN_NPC_LAB_SAFETY_OFFICER_SHEET_PATH = "/assets/sprites/kitchen-npc-lab-safety-officer.png";
const KITCHEN_NPC_OPERATIONS_ADMINISTRATOR_SHEET_PATH = "/assets/sprites/kitchen-npc-operations-administrator.png";
const OFFICE_MANAGER_SHEET_PATH = "/assets/sprites/office-manager.png";
const OFFICE_NPC_1_SHEET_PATH = "/assets/sprites/office-npc-1.png";
const OFFICE_NPC_2_SHEET_PATH = "/assets/sprites/office-npc-2.png";
// The two LLM-agent scientists (server/src/agents/personas.ts) - full zone-switching
// walk cycles, same layout as the player sheets above (client/scripts/extract-player-sprite.py).
const AGENT_LAB_SCIENTIST_LAB_SHEET_PATH = "/assets/sprites/agent-lab-scientist-walk-lab.png";
const AGENT_LAB_SCIENTIST_OUTSIDE_SHEET_PATH = "/assets/sprites/agent-lab-scientist-walk-outside.png";
const AGENT_THEORETICAL_SCIENTIST_LAB_SHEET_PATH = "/assets/sprites/agent-theoretical-scientist-walk-lab.png";
const AGENT_THEORETICAL_SCIENTIST_OUTSIDE_SHEET_PATH = "/assets/sprites/agent-theoretical-scientist-walk-outside.png";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload(): void {
    for (const t of MAP_TILESETS) this.load.image(t.textureKey, t.path);
    // NPCs/computers still render from the Kenney sheet's frames specifically, loaded
    // separately as a spritesheet (the "tiles" load above only registers it as a plain image).
    this.load.spritesheet("characters", CHARACTERS_SHEET_PATH, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet("player_lab_male", PLAYER_LAB_MALE_SHEET_PATH, { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet("player_outside_male", PLAYER_OUTSIDE_MALE_SHEET_PATH, { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet("player_sit_lab_male", PLAYER_SIT_LAB_MALE_SHEET_PATH, { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet("player_sit_outside_male", PLAYER_SIT_OUTSIDE_MALE_SHEET_PATH, {
      frameWidth: 32,
      frameHeight: 32,
    });
    this.load.spritesheet("player_lab_female", PLAYER_LAB_FEMALE_SHEET_PATH, { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet("player_outside_female", PLAYER_OUTSIDE_FEMALE_SHEET_PATH, {
      frameWidth: 32,
      frameHeight: 32,
    });
    this.load.spritesheet("player_sit_lab_female", PLAYER_SIT_LAB_FEMALE_SHEET_PATH, {
      frameWidth: 32,
      frameHeight: 32,
    });
    this.load.spritesheet("player_sit_outside_female", PLAYER_SIT_OUTSIDE_FEMALE_SHEET_PATH, {
      frameWidth: 32,
      frameHeight: 32,
    });
    // Single static portrait frame (client/scripts/extract-npc-sprite.py), not a multi-frame
    // sheet - loaded as a plain image so frame 0 is the whole picture.
    this.load.image("workshop_woman", WORKSHOP_WOMAN_SHEET_PATH);
    this.load.image("lab_npc_1", LAB_NPC_1_SHEET_PATH);
    this.load.image("lab_npc_2", LAB_NPC_2_SHEET_PATH);
    this.load.image("workshop_npc_1", WORKSHOP_NPC_1_SHEET_PATH);
    this.load.image("workshop_npc_2", WORKSHOP_NPC_2_SHEET_PATH);
    this.load.image("kitchen_cook_npc", KITCHEN_COOK_SHEET_PATH);
    this.load.image("kitchen_npc_facilities_coordinator", KITCHEN_NPC_FACILITIES_COORDINATOR_SHEET_PATH);
    this.load.image("kitchen_npc_lab_safety_officer", KITCHEN_NPC_LAB_SAFETY_OFFICER_SHEET_PATH);
    this.load.image("kitchen_npc_operations_administrator", KITCHEN_NPC_OPERATIONS_ADMINISTRATOR_SHEET_PATH);
    this.load.image("office_manager_npc", OFFICE_MANAGER_SHEET_PATH);
    this.load.image("office_npc_1", OFFICE_NPC_1_SHEET_PATH);
    this.load.image("office_npc_2", OFFICE_NPC_2_SHEET_PATH);
    this.load.spritesheet("agent_lab_scientist_lab", AGENT_LAB_SCIENTIST_LAB_SHEET_PATH, {
      frameWidth: 32,
      frameHeight: 32,
    });
    this.load.spritesheet("agent_lab_scientist_outside", AGENT_LAB_SCIENTIST_OUTSIDE_SHEET_PATH, {
      frameWidth: 32,
      frameHeight: 32,
    });
    this.load.spritesheet("agent_theoretical_scientist_lab", AGENT_THEORETICAL_SCIENTIST_LAB_SHEET_PATH, {
      frameWidth: 32,
      frameHeight: 32,
    });
    this.load.spritesheet("agent_theoretical_scientist_outside", AGENT_THEORETICAL_SCIENTIST_OUTSIDE_SHEET_PATH, {
      frameWidth: 32,
      frameHeight: 32,
    });
    this.load.tilemapTiledJSON("lab-map", "/assets/map/lab.json");
  }

  create(): void {
    createPlayerAnimations(this);
    createAgentAnimations(this);
    this.scene.start("LoginScene");
  }
}
