import Phaser from "phaser";
import type { AgentActivity, Direction } from "@lab/shared";
import { applyDirection, DEFAULT_ZONE, PLAYER_IDLE_FRAME, type OutfitZone } from "./spriteFrames";

// No dedicated art for the two LLM-agent characters yet, so they reuse the player walk
// cycle (same animation system as RemotePlayer) with a tint to read as distinct
// characters rather than another human player. Swap for real sprites once available.
const AGENT_TINTS: Record<string, number> = {
  lab_scientist: 0x8fd0ff,
  theoretical_scientist: 0xffb37a,
};

const ACTIVITY_SUFFIX: Record<AgentActivity, string> = {
  idle: "",
  moving: "",
  running_experiment: " (running experiment)",
  analyzing_data: " (analyzing data)",
  conversing: " (talking)",
};

export class AgentNpc {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly label: Phaser.GameObjects.Text;
  private readonly displayName: string;
  private targetX: number;
  private targetY: number;
  private activity: AgentActivity = "idle";

  constructor(scene: Phaser.Scene, npcId: string, displayName: string, x: number, y: number) {
    this.displayName = displayName;
    this.targetX = x;
    this.targetY = y;
    this.sprite = scene.add.sprite(x, y, `player_${DEFAULT_ZONE}`, PLAYER_IDLE_FRAME.down);
    this.sprite.setOrigin(0.5, 0.85);
    this.sprite.setTint(AGENT_TINTS[npcId] ?? 0xcccccc);
    this.label = scene.add.text(x, y - 30, displayName, {
      fontSize: "11px",
      color: "#ffe08a",
      backgroundColor: "#00000080",
      padding: { left: 3, right: 3, top: 1, bottom: 1 },
    });
    this.label.setOrigin(0.5, 1);
  }

  setTarget(x: number, y: number, dir: Direction, zone: OutfitZone, activity: AgentActivity): void {
    const moving = x !== this.targetX || y !== this.targetY;
    this.targetX = x;
    this.targetY = y;
    this.activity = activity;
    applyDirection(this.sprite, dir, moving, zone, false);
    this.label.setText(this.displayName + ACTIVITY_SUFFIX[activity]);
  }

  get x(): number {
    return this.targetX;
  }

  get y(): number {
    return this.targetY;
  }

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
