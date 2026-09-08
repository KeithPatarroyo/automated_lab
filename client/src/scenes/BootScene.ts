import Phaser from "phaser";
import { createPlayerAnimations } from "../entities/spriteFrames";
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
    this.load.tilemapTiledJSON("lab-map", "/assets/map/lab.json");
  }

  create(): void {
    createPlayerAnimations(this);
    this.scene.start("LoginScene");
  }
}
