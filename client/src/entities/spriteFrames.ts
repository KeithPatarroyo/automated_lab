import type { Direction, Gender } from "@lab/shared";

// Each zone-outfit texture (client/public/assets/sprites/player-walk-<zone>[-female].png)
// is a 9-frame walk cycle per direction, extracted from the user's custom LPC-format
// spritesheets (client/scripts/extract-player-sprite.py) and cropped/downscaled to a
// 4-row x 9-col, 32x32-per-cell sheet. Row order: up, left, down, right. Every
// zone/gender combo shares this exact layout, so switching either is just switching
// texture key + keeping the same frame index.
export type OutfitZone = "lab" | "outside";
export const DEFAULT_ZONE: OutfitZone = "outside";
export const DEFAULT_GENDER: Gender = "male";

const TEXTURE_KEY: Record<OutfitZone, Record<Gender, string>> = {
  lab: { male: "player_lab_male", female: "player_lab_female" },
  outside: { male: "player_outside_male", female: "player_outside_female" },
};

// The sit sheet (client/scripts/extract-player-sprite.py, LPC template rows 30-33) is
// a single static frame per direction, same row order as walk: up, left, down, right.
const SIT_TEXTURE_KEY: Record<OutfitZone, Record<Gender, string>> = {
  lab: { male: "player_sit_lab_male", female: "player_sit_lab_female" },
  outside: { male: "player_sit_outside_male", female: "player_sit_outside_female" },
};

export function playerTextureKey(zone: OutfitZone, gender: Gender): string {
  return TEXTURE_KEY[zone][gender];
}

const WALK_FRAME_COUNT = 9;
const DIRECTION_ROW: Record<Direction, number> = {
  up: 0,
  left: 1,
  down: 2,
  right: 3,
};

function walkFrames(dir: Direction): number[] {
  const row = DIRECTION_ROW[dir];
  return Array.from({ length: WALK_FRAME_COUNT }, (_, col) => row * WALK_FRAME_COUNT + col);
}

// First frame of each direction's cycle doubles as its idle/standing pose.
export const PLAYER_IDLE_FRAME: Record<Direction, number> = {
  up: DIRECTION_ROW.up * WALK_FRAME_COUNT,
  left: DIRECTION_ROW.left * WALK_FRAME_COUNT,
  down: DIRECTION_ROW.down * WALK_FRAME_COUNT,
  right: DIRECTION_ROW.right * WALK_FRAME_COUNT,
};

// The sit sheet is 1 column per row, so the frame index for a direction is just its row.
export const PLAYER_SIT_FRAME: Record<Direction, number> = {
  up: DIRECTION_ROW.up,
  left: DIRECTION_ROW.left,
  down: DIRECTION_ROW.down,
  right: DIRECTION_ROW.right,
};

function animKey(zone: OutfitZone, gender: Gender, dir: Direction): string {
  return `player-${zone}-${gender}-walk-${dir}`;
}

export function createPlayerAnimations(scene: Phaser.Scene): void {
  for (const zone of Object.keys(TEXTURE_KEY) as OutfitZone[]) {
    for (const gender of Object.keys(TEXTURE_KEY[zone]) as Gender[]) {
      const textureKey = TEXTURE_KEY[zone][gender];
      for (const dir of Object.keys(DIRECTION_ROW) as Direction[]) {
        const key = animKey(zone, gender, dir);
        if (scene.anims.exists(key)) continue;
        scene.anims.create({
          key,
          frames: walkFrames(dir).map((frame) => ({ key: textureKey, frame })),
          frameRate: 10,
          repeat: -1,
        });
      }
    }
  }
}

// Most NPCs use the Kenney placeholder tileset - unrelated to the player sprite above.
export const NPC_FRAMES: Record<string, number> = {
  lab_scientist: 347,
  kitchen_cook: 104,
  office_manager: 430,
};

export const DEFAULT_NPC_FRAME = 24;
export const DEFAULT_NPC_TEXTURE_KEY = "characters";

// NPCs whose sprite comes from their own dedicated single-frame texture (loaded in
// BootScene.ts) instead of a frame index into the shared Kenney "characters" sheet.
// Frame is always 0 for these - see client/scripts/extract-npc-sprite.py.
export const NPC_TEXTURE_KEYS: Record<string, string> = {
  workshop_tech: "workshop_woman",
};

type DirectionalSprite = Phaser.GameObjects.Sprite | Phaser.Physics.Arcade.Sprite;

/** Applies a facing direction, walk animation (if moving), zone-appropriate outfit,
 * chosen gender's spritesheet, and a seated pose instead of all of that when standing
 * on a chair tile. */
export function applyDirection(
  sprite: DirectionalSprite,
  dir: Direction,
  moving: boolean,
  zone: OutfitZone,
  gender: Gender,
  sitting: boolean,
): void {
  if (sitting) {
    sprite.anims.stop();
    sprite.setTexture(SIT_TEXTURE_KEY[zone][gender], PLAYER_SIT_FRAME[dir]);
    return;
  }
  if (moving) {
    sprite.play(animKey(zone, gender, dir), true);
  } else {
    sprite.anims.stop();
    sprite.setTexture(TEXTURE_KEY[zone][gender], PLAYER_IDLE_FRAME[dir]);
  }
}
