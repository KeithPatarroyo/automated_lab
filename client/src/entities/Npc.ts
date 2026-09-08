import Phaser from "phaser";
import { DEFAULT_NPC_FRAME, DEFAULT_NPC_TEXTURE_KEY, NPC_FRAMES, NPC_TEXTURE_KEYS } from "./spriteFrames";

export class Npc {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly npcId: string;
  readonly displayName: string;
  readonly x: number;
  readonly y: number;

  /** `showLabel = false` skips the persistent floating nameplate - for minor background
   * "worker" NPCs meant to blend into a room rather than draw attention (see
   * shared/src/protocol.ts's BACKGROUND_NPC_IDS). They're still fully interactive -
   * walking up and pressing E still shows an interaction prompt with their name and
   * opens canned dialogue - this only affects the always-visible overhead label. */
  constructor(scene: Phaser.Scene, npcId: string, displayName: string, x: number, y: number, showLabel = true) {
    this.npcId = npcId;
    this.displayName = displayName;
    this.x = x;
    this.y = y;
    const textureKey = NPC_TEXTURE_KEYS[npcId] ?? DEFAULT_NPC_TEXTURE_KEY;
    const frame = textureKey === DEFAULT_NPC_TEXTURE_KEY ? (NPC_FRAMES[npcId] ?? DEFAULT_NPC_FRAME) : 0;
    this.sprite = scene.add.sprite(x, y, textureKey, frame);
    if (showLabel) {
      scene.add
        .text(x, y - 14, displayName, {
          fontSize: "10px",
          color: "#ffe08a",
          backgroundColor: "#00000080",
          padding: { left: 3, right: 3, top: 1, bottom: 1 },
        })
        .setOrigin(0.5, 1);
    }

    // Small idle bob so the room doesn't feel completely frozen.
    scene.tweens.add({
      targets: this.sprite,
      y: y - 2,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }
}
