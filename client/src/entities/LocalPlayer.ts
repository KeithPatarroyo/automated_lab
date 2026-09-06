import Phaser from "phaser";
import type { Direction } from "@lab/shared";
import { applyDirection, DEFAULT_ZONE, PLAYER_IDLE_FRAME, type OutfitZone } from "./spriteFrames";

export class LocalPlayer {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly label: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, y: number, username: string) {
    this.sprite = scene.add.sprite(x, y, `player_${DEFAULT_ZONE}`, PLAYER_IDLE_FRAME.down);
    // The sprite is 32px (2 floor tiles) tall; anchor near the feet so x/y - the
    // point movement/collision is computed against - lines up with where the
    // character visually stands, not its center.
    this.sprite.setOrigin(0.5, 0.85);
    this.label = scene.add.text(x, y - 30, username, {
      fontSize: "11px",
      color: "#ffffff",
      backgroundColor: "#00000080",
      padding: { left: 3, right: 3, top: 1, bottom: 1 },
    });
    this.label.setOrigin(0.5, 1);
  }

  setDirection(dir: Direction, moving: boolean, zone: OutfitZone, sitting: boolean): void {
    applyDirection(this.sprite, dir, moving, zone, sitting);
  }

  setPosition(x: number, y: number): void {
    this.sprite.setPosition(x, y);
  }

  setLabelVisible(visible: boolean): void {
    this.label.setVisible(visible);
  }

  update(): void {
    this.label.setPosition(this.sprite.x, this.sprite.y - 30);
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }
}
