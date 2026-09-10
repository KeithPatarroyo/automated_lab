import Phaser from "phaser";
import type { AgentActivity, AgentNpcId, Direction } from "@lab/shared";
import { agentTextureKey, applyAgentDirection, DEFAULT_ZONE, PLAYER_IDLE_FRAME, type OutfitZone } from "./spriteFrames";

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
  private readonly npcId: AgentNpcId;
  private targetX: number;
  private targetY: number;
  private activity: AgentActivity = "idle";

  constructor(scene: Phaser.Scene, npcId: string, displayName: string, x: number, y: number) {
    this.displayName = displayName;
    this.npcId = npcId as AgentNpcId;
    this.targetX = x;
    this.targetY = y;
    this.sprite = scene.add.sprite(x, y, agentTextureKey(this.npcId, DEFAULT_ZONE), PLAYER_IDLE_FRAME.down);
    this.sprite.setOrigin(0.5, 0.85);
    this.label = scene.add.text(x, y - 30, displayName, {
      fontSize: "11px",
      color: "#00e5ff",
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
    applyAgentDirection(this.sprite, dir, moving, zone, this.npcId);
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
