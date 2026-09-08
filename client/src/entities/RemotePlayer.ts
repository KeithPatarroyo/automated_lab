import Phaser from "phaser";
import type { Direction, Gender } from "@lab/shared";
import { applyDirection, DEFAULT_ZONE, PLAYER_IDLE_FRAME, playerTextureKey, type OutfitZone } from "./spriteFrames";

export class RemotePlayer {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly label: Phaser.GameObjects.Text;
  private readonly gender: Gender;
  private targetX: number;
  private targetY: number;

  constructor(scene: Phaser.Scene, x: number, y: number, username: string, gender: Gender) {
    this.targetX = x;
    this.targetY = y;
    this.gender = gender;
    this.sprite = scene.add.sprite(x, y, playerTextureKey(DEFAULT_ZONE, gender), PLAYER_IDLE_FRAME.down);
    this.sprite.setOrigin(0.5, 0.85);
    this.label = scene.add.text(x, y - 30, username, {
      fontSize: "11px",
      color: "#ffffff",
      backgroundColor: "#00000080",
      padding: { left: 3, right: 3, top: 1, bottom: 1 },
    });
    this.label.setOrigin(0.5, 1);
  }

  setTarget(x: number, y: number, dir: Direction, zone: OutfitZone, sitting: boolean): void {
    // The server broadcasts every player's position every tick regardless of whether
    // they're moving, so "moving" is inferred here from whether the snapshot actually
    // changed since the last one.
    const moving = x !== this.targetX || y !== this.targetY;
    this.targetX = x;
    this.targetY = y;
    applyDirection(this.sprite, dir, moving, zone, this.gender, sitting);
  }

  /** The server's last-known position for this player - used for other players'
   * entity-collision checks, since it's the authoritative value, not the smoothed
   * render position. */
  get x(): number {
    return this.targetX;
  }

  get y(): number {
    return this.targetY;
  }

  /** Smoothly interpolate toward the latest server snapshot instead of snapping. */
  update(): void {
    this.sprite.x = Phaser.Math.Linear(this.sprite.x, this.targetX, 0.3);
    this.sprite.y = Phaser.Math.Linear(this.sprite.y, this.targetY, 0.3);
    this.label.setPosition(this.sprite.x, this.sprite.y - 30);
  }

  destroy(): void {
    this.sprite.destroy();
    this.label.destroy();
  }
}
