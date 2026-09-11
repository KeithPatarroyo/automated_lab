import Phaser from "phaser";
import type { Direction, PlayerState } from "@lab/shared";
import {
  AGENT_NPC_IDS,
  BACKGROUND_NPC_IDS,
  COLLISION_LAYER_NAMES,
  entitiesOverlap,
  INTERACT_RANGE_TILES,
  resolveMove,
  resolveZone,
  SITTABLE_LAYER_NAME,
} from "@lab/shared";
import type { JoinAck } from "../net/SocketClient";
import { socketClient } from "../net/SocketClient";
import { LocalPlayer } from "../entities/LocalPlayer";
import { RemotePlayer } from "../entities/RemotePlayer";
import { Npc } from "../entities/Npc";
import { AgentNpc } from "../entities/AgentNpc";
import { DEFAULT_GENDER, DEFAULT_ZONE, type OutfitZone } from "../entities/spriteFrames";
import { MAP_TILESETS } from "./mapTilesets";
import { ChatPanel } from "../ui/ChatPanel";
import { AgentLogPanel } from "../ui/AgentLogPanel";
import { DialogueBox } from "../ui/DialogueBox";
import { ComputerModal } from "../ui/ComputerModal";
import { InteractionPrompt } from "../ui/InteractionPrompt";
import { HelpModal } from "../ui/HelpModal";
import { ViewToggleButton } from "../ui/ViewToggleButton";

const NPC_DISPLAY_NAMES: Record<string, string> = {
  workshop_tech: "Workshop Tech",
  lab_scientist: "Lab Scientist",
  kitchen_cook: "Kitchen Cook",
  office_manager: "Office Manager",
  theoretical_scientist: "Theoretical Scientist",
  workshop_worker_1: "Machinist",
  workshop_worker_2: "Workshop Intern",
  lab_worker_1: "Lab Technician",
  lab_worker_2: "Research Assistant",
  office_worker_1: "Office Assistant",
  office_worker_2: "Data Analyst",
  kitchen_worker_1: "Facilities Coordinator",
  kitchen_worker_2: "Lab Safety Officer",
  kitchen_worker_3: "Operations Administrator",
};

const COMPUTER_DISPLAY_NAMES: Record<string, string> = {
  lab_terminal: "Lab Terminal",
  office_terminal: "Office Terminal",
};

const AGENT_NPC_ID_SET: ReadonlySet<string> = new Set(AGENT_NPC_IDS);
const BACKGROUND_NPC_ID_SET: ReadonlySet<string> = new Set(BACKGROUND_NPC_IDS);

interface InteractTarget {
  kind: "npc" | "computer" | "agent_npc";
  id: string;
  label: string;
  x: number;
  y: number;
}

function directionFromVector(dx: number, dy: number, fallback: Direction): Direction {
  if (dy < 0) return "up";
  if (dy > 0) return "down";
  if (dx < 0) return "left";
  if (dx > 0) return "right";
  return fallback;
}

function isFacingTarget(px: number, py: number, tx: number, ty: number, facing: Direction): boolean {
  const dx = tx - px;
  const dy = ty - py;
  switch (facing) {
    case "up":
      return dy < 0 && Math.abs(dy) >= Math.abs(dx);
    case "down":
      return dy > 0 && Math.abs(dy) >= Math.abs(dx);
    case "left":
      return dx < 0 && Math.abs(dx) >= Math.abs(dy);
    case "right":
      return dx > 0 && Math.abs(dx) >= Math.abs(dy);
  }
}

export class MainScene extends Phaser.Scene {
  private joinAck!: JoinAck;
  private username!: string;

  private localPlayer!: LocalPlayer;
  private remotePlayers = new Map<string, RemotePlayer>();
  private agentNpcs = new Map<string, AgentNpc>();
  private interactTargets: InteractTarget[] = [];

  private facing: Direction = "down";
  private lastSentInput = { dx: 0 as -1 | 0 | 1, dy: 0 as -1 | 0 | 1 };
  private seq = 0;
  private serverSelf: { x: number; y: number } | null = null;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyInteract!: Phaser.Input.Keyboard.Key;

  private collisionLayers: Phaser.Tilemaps.TilemapLayer[] = [];
  private chairsLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private npcPixelPositions: { x: number; y: number }[] = [];
  private mapWidthTiles = 0;
  private mapHeightTiles = 0;
  private tileWidth = 16;
  private tileHeight = 16;

  private chatPanel!: ChatPanel;
  private agentLogPanel!: AgentLogPanel;
  private dialogueBox!: DialogueBox;
  private computerModal!: ComputerModal;
  private interactionPrompt!: InteractionPrompt;
  private helpModal!: HelpModal;
  private viewToggle!: ViewToggleButton;
  private inputLocked = false;
  private activeSessionId: string | null = null;

  constructor() {
    super("MainScene");
  }

  init(data: { joinAck: JoinAck; username: string }): void {
    this.joinAck = data.joinAck;
    this.username = data.username;
  }

  create(): void {
    const map = this.make.tilemap({ key: "lab-map" });
    // Every layer can contain tiles from any of the map's tilesets, so all of them are
    // passed to every createLayer call - Phaser resolves each tile's GID against
    // whichever tileset it actually belongs to.
    const tilesets = MAP_TILESETS.map((t) => map.addTilesetImage(t.tiledName, t.textureKey)!);
    // Render every tile layer the map actually has (in file order, so stacking stays
    // correct), rather than a hardcoded list - a new layer added in Tiled just shows up
    // automatically instead of silently not rendering.
    for (const layerData of map.layers) {
      const layer = map.createLayer(layerData.name, tilesets, 0, 0)!;
      if (COLLISION_LAYER_NAMES.includes(layerData.name)) {
        this.collisionLayers.push(layer);
      }
      if (layerData.name === SITTABLE_LAYER_NAME) {
        this.chairsLayer = layer;
      }
    }

    this.mapWidthTiles = map.width;
    this.mapHeightTiles = map.height;
    this.tileWidth = map.tileWidth;
    this.tileHeight = map.tileHeight;
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    const birdsEye = new URLSearchParams(window.location.search).get("birdseye") === "1";
    this.cameras.main.setZoom(
      birdsEye
        ? Math.min(this.scale.width / map.widthInPixels, this.scale.height / map.heightInPixels)
        : 2
    );

    const self = this.joinAck.players.find((p) => p.id === this.joinAck.playerId);
    const spawnX = self?.x ?? 100;
    const spawnY = self?.y ?? 100;
    this.localPlayer = new LocalPlayer(this, spawnX, spawnY, this.username, self?.gender ?? DEFAULT_GENDER);
    if (birdsEye) {
      this.cameras.main.centerOn(map.widthInPixels / 2, map.heightInPixels / 2);
      this.localPlayer.setLabelVisible(false);
      this.localPlayer.sprite.setVisible(false);
      document.body.classList.add("birdseye");
    } else {
      this.cameras.main.startFollow(this.localPlayer.sprite, true, 0.15, 0.15);
    }

    for (const p of this.joinAck.players) {
      if (p.id === this.joinAck.playerId) continue;
      this.remotePlayers.set(p.id, new RemotePlayer(this, p.x, p.y, p.username, p.gender));
    }

    for (const npc of this.joinAck.mapMeta.npcs) {
      // Agent-driven NPCs (lab_scientist, theoretical_scientist) move at runtime and are
      // spawned from the live agent snapshot below instead of their static map position.
      if (AGENT_NPC_ID_SET.has(npc.npcId)) continue;
      const label = NPC_DISPLAY_NAMES[npc.npcId] ?? npc.npcId;
      const x = npc.x * map.tileWidth;
      const y = npc.y * map.tileHeight;
      new Npc(this, npc.npcId, label, x, y, !BACKGROUND_NPC_ID_SET.has(npc.npcId));
      this.interactTargets.push({ kind: "npc", id: npc.npcId, label, x, y });
      this.npcPixelPositions.push({ x, y });
    }

    for (const agent of this.joinAck.agents) {
      const label = NPC_DISPLAY_NAMES[agent.npcId] ?? agent.npcId;
      this.agentNpcs.set(agent.npcId, new AgentNpc(this, agent.npcId, label, agent.x, agent.y));
    }

    // Computer objects are an invisible interaction marker only - the visual is
    // whatever tile you paint on the furniture/ground layer in Tiled at this spot
    // (e.g. one of the laptop icons from the LPC office tileset), not drawn by code.
    for (const computer of this.joinAck.mapMeta.computers) {
      const x = computer.x * map.tileWidth;
      const y = computer.y * map.tileHeight;
      const label = COMPUTER_DISPLAY_NAMES[computer.computerId] ?? computer.computerId;
      this.interactTargets.push({ kind: "computer", id: computer.computerId, label, x, y });
      this.add
        .text(x, y - 14, label, {
          fontSize: "10px",
          color: "#ff5c5c",
          backgroundColor: "#00000080",
          padding: { left: 3, right: 3, top: 1, bottom: 1 },
        })
        .setOrigin(0.5, 1);
    }

    // Spawn points are otherwise invisible (server picks one at random for a new
    // player's starting position, see server/src/data/mapMeta.ts's randomSpawn) - only
    // marked in birdseye/screenshot mode (docs/lab-birdseye.png), not during normal
    // live play, where they'd just be visual clutter.
    if (birdsEye) {
      for (const spawn of this.joinAck.mapMeta.spawns) {
        const tileX = Math.floor(spawn.x) * map.tileWidth;
        const tileY = Math.floor(spawn.y) * map.tileHeight;
        this.add
          .rectangle(tileX + map.tileWidth / 2, tileY + map.tileHeight / 2, map.tileWidth, map.tileHeight)
          .setStrokeStyle(1, 0x4fd8ff, 1)
          .setFillStyle(0x4fd8ff, 0.15);
        this.add
          .text(spawn.x * map.tileWidth, spawn.y * map.tileHeight - 14, "Spawn", {
            fontSize: "9px",
            color: "#4fd8ff",
            backgroundColor: "#00000080",
            padding: { left: 3, right: 3, top: 1, bottom: 1 },
          })
          .setOrigin(0.5, 1);
      }
    }

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyW = this.input.keyboard!.addKey("W");
    this.keyA = this.input.keyboard!.addKey("A");
    this.keyS = this.input.keyboard!.addKey("S");
    this.keyD = this.input.keyboard!.addKey("D");
    this.keyInteract = this.input.keyboard!.addKey("E");

    this.chatPanel = new ChatPanel((text) => socketClient.socket?.emit("chat_message", { text }));
    for (const msg of this.joinAck.chatLogTail) this.chatPanel.addMessage(msg);

    this.agentLogPanel = new AgentLogPanel(this.joinAck.agentLogTail);

    this.dialogueBox = new DialogueBox();
    this.computerModal = new ComputerModal();
    this.interactionPrompt = new InteractionPrompt();
    this.viewToggle = new ViewToggleButton((birdsEye) => this.setBirdsEyeCamera(birdsEye));
    this.helpModal = new HelpModal();

    this.registerSocketListeners();
  }

  private registerSocketListeners(): void {
    const socket = socketClient.socket;
    if (!socket) return;

    socket.on("state_sync", ({ players, agents }) => {
      for (const p of players) {
        if (p.id === this.joinAck.playerId) {
          this.serverSelf = { x: p.x, y: p.y };
          continue;
        }
        const remote = this.remotePlayers.get(p.id);
        if (remote) remote.setTarget(p.x, p.y, p.dir, this.zoneAt(p.x, p.y), this.isSittingAt(p.x, p.y));
      }
      for (const a of agents) {
        this.agentNpcs.get(a.npcId)?.setTarget(a.x, a.y, a.dir, this.zoneAt(a.x, a.y), a.activity);
      }
    });

    socket.on("player_joined", ({ player }: { player: PlayerState }) => {
      if (player.id === this.joinAck.playerId) return;
      if (this.remotePlayers.has(player.id)) return;
      this.remotePlayers.set(player.id, new RemotePlayer(this, player.x, player.y, player.username, player.gender));
    });

    socket.on("player_left", ({ playerId }) => {
      this.remotePlayers.get(playerId)?.destroy();
      this.remotePlayers.delete(playerId);
    });

    socket.on("chat_message", (msg) => this.chatPanel.addMessage(msg));
    socket.on("agent_log", (entry) => this.agentLogPanel.addEntry(entry));

    socket.on("npc_dialogue", ({ npcId, lines }) => {
      const label = NPC_DISPLAY_NAMES[npcId] ?? npcId;
      this.inputLocked = true;
      this.dialogueBox.open(label, lines, () => {
        this.inputLocked = false;
      });
    });

    socket.on("computer_opened", ({ sessionId, visualization }) => {
      this.activeSessionId = sessionId;
      this.inputLocked = true;
      this.computerModal.open(
        (text) => socket.emit("computer_message", { sessionId, text }),
        () => {
          socket.emit("computer_close", { sessionId });
          this.activeSessionId = null;
          this.inputLocked = false;
        },
        "LAB TERMINAL",
        "Terminal ready. Type a message and press Enter.",
        visualization,
      );
    });

    socket.on("computer_response", ({ sessionId, text, visualization }) => {
      if (sessionId !== this.activeSessionId) return;
      this.computerModal.addResponse(text, visualization);
    });

    socket.on("computer_error", ({ sessionId, message }) => {
      if (sessionId !== this.activeSessionId) return;
      this.computerModal.addError(message);
    });

    socket.on("npc_chat_opened", ({ npcId, sessionId }) => {
      const label = NPC_DISPLAY_NAMES[npcId] ?? npcId;
      this.activeSessionId = sessionId;
      this.inputLocked = true;
      this.computerModal.open(
        (text) => socket.emit("npc_chat_message", { sessionId, text }),
        () => {
          socket.emit("npc_chat_close", { sessionId });
          this.activeSessionId = null;
          this.inputLocked = false;
        },
        label,
        `${label} looks up.`,
      );
    });

    socket.on("npc_chat_response", ({ sessionId, text }) => {
      if (sessionId !== this.activeSessionId) return;
      this.computerModal.addResponse(text);
    });

    socket.on("npc_chat_error", ({ sessionId, message }) => {
      if (sessionId !== this.activeSessionId) return;
      this.computerModal.addError(message);
    });
  }

  update(_time: number, deltaMs: number): void {
    const uiBlocksMovement = this.inputLocked || this.chatPanel.isFocused || this.helpModal.isOpen;

    let dx: -1 | 0 | 1 = 0;
    let dy: -1 | 0 | 1 = 0;
    if (!uiBlocksMovement) {
      if (this.cursors.left.isDown || this.keyA.isDown) dx = -1;
      else if (this.cursors.right.isDown || this.keyD.isDown) dx = 1;
      if (this.cursors.up.isDown || this.keyW.isDown) dy = -1;
      else if (this.cursors.down.isDown || this.keyS.isDown) dy = 1;
    }

    if (dx !== this.lastSentInput.dx || dy !== this.lastSentInput.dy) {
      this.lastSentInput = { dx, dy };
      this.seq++;
      socketClient.socket?.emit("move", { seq: this.seq, dx, dy });
    }

    const isMoving = dx !== 0 || dy !== 0;
    if (isMoving) {
      // Reject-if-blocked, not move-then-separate: this is the exact same function
      // the server runs against the exact same "walls" data, so the client can't
      // ever visually creep past a wall the server would also block - a real hard
      // stop instead of Arcade physics' bump-then-push-back.
      const dt = deltaMs / 1000;
      const { x: nx, y: ny } = resolveMove(
        this.localPlayer.x,
        this.localPlayer.y,
        dx,
        dy,
        dt,
        this.tileWidth,
        this.tileHeight,
        (tx, ty) => this.isWallBlocked(tx, ty),
        (x, y) => this.isEntityBlocked(x, y),
      );
      this.localPlayer.setPosition(nx, ny);
      this.facing = directionFromVector(dx, dy, this.facing);
    } else if (this.serverSelf) {
      // Idle: gently reconcile toward the server's authoritative position to correct
      // any small floating-point/timing drift (client integrates every render frame,
      // server every fixed tick) - not a structural mismatch anymore, just noise.
      this.localPlayer.setPosition(
        Phaser.Math.Linear(this.localPlayer.x, this.serverSelf.x, 0.2),
        Phaser.Math.Linear(this.localPlayer.y, this.serverSelf.y, 0.2),
      );
    }
    const isSitting = this.isSittingAt(this.localPlayer.x, this.localPlayer.y);
    this.localPlayer.setDirection(this.facing, isMoving, this.zoneAt(this.localPlayer.x, this.localPlayer.y), isSitting);

    this.localPlayer.update();
    for (const remote of this.remotePlayers.values()) remote.update();
    for (const agent of this.agentNpcs.values()) agent.update();

    this.updateInteraction(uiBlocksMovement, deltaMs);
  }

  /** Toggled by ViewToggleButton - only the camera changes (zoom + follow-vs-centered),
   * unlike the `?birdseye=1` boot-time screenshot mode, which also hides the player's
   * own sprite/nametag and the chat/agent-log panels. Movement stays live either way. */
  private setBirdsEyeCamera(enabled: boolean): void {
    const mapWidthPx = this.mapWidthTiles * this.tileWidth;
    const mapHeightPx = this.mapHeightTiles * this.tileHeight;
    if (enabled) {
      this.cameras.main.stopFollow();
      this.cameras.main.setZoom(Math.min(this.scale.width / mapWidthPx, this.scale.height / mapHeightPx));
      this.cameras.main.centerOn(mapWidthPx / 2, mapHeightPx / 2);
    } else {
      this.cameras.main.setZoom(2);
      this.cameras.main.startFollow(this.localPlayer.sprite, true, 0.15, 0.15);
    }
  }

  private isWallBlocked(tileX: number, tileY: number): boolean {
    if (tileX < 0 || tileX >= this.mapWidthTiles || tileY < 0 || tileY >= this.mapHeightTiles) return true;
    return this.collisionLayers.some((layer) => layer.getTileAt(tileX, tileY) !== null);
  }

  // Other players' positions are only known approximately here (periodic server
  // broadcasts), so this can't agree with the server as precisely as wall collision
  // does - it's best-effort local prediction; the server is still authoritative and
  // the idle-reconciliation above corrects any drift.
  private isEntityBlocked(x: number, y: number): boolean {
    for (const remote of this.remotePlayers.values()) {
      if (entitiesOverlap(x, y, remote.x, remote.y)) return true;
    }
    if (this.npcPixelPositions.some((npc) => entitiesOverlap(x, y, npc.x, npc.y))) return true;
    for (const agent of this.agentNpcs.values()) {
      if (entitiesOverlap(x, y, agent.x, agent.y)) return true;
    }
    return false;
  }

  private isSittingAt(x: number, y: number): boolean {
    if (!this.chairsLayer) return false;
    const tileX = Math.floor(x / this.tileWidth);
    const tileY = Math.floor(y / this.tileHeight);
    return this.chairsLayer.getTileAt(tileX, tileY) !== null;
  }

  private zoneAt(x: number, y: number): OutfitZone {
    const zoneId = resolveZone(this.joinAck.mapMeta.zones, x, y);
    return zoneId === "lab" || zoneId === "outside" ? zoneId : DEFAULT_ZONE;
  }

  private updateInteraction(uiBlocksMovement: boolean, _deltaMs: number): void {
    if (uiBlocksMovement) {
      this.interactionPrompt.hide();
      return;
    }
    const rangePx = INTERACT_RANGE_TILES * 16;
    const px = this.localPlayer.x;
    const py = this.localPlayer.y;

    const agentTargets: InteractTarget[] = Array.from(this.agentNpcs.entries()).map(([id, agent]) => ({
      kind: "agent_npc",
      id,
      label: NPC_DISPLAY_NAMES[id] ?? id,
      x: agent.x,
      y: agent.y,
    }));

    let nearest: InteractTarget | null = null;
    let nearestDist = Infinity;
    for (const target of [...this.interactTargets, ...agentTargets]) {
      const dist = Phaser.Math.Distance.Between(px, py, target.x, target.y);
      if (dist > rangePx) continue;
      if (!isFacingTarget(px, py, target.x, target.y, this.facing)) continue;
      if (dist < nearestDist) {
        nearest = target;
        nearestDist = dist;
      }
    }

    if (nearest) {
      const verb = nearest.kind === "computer" ? `use ${nearest.label}` : `talk to ${nearest.label}`;
      this.interactionPrompt.show(`Press E to ${verb}`);
      if (Phaser.Input.Keyboard.JustDown(this.keyInteract)) {
        if (nearest.kind === "npc") {
          socketClient.socket?.emit("npc_interact", { npcId: nearest.id });
        } else if (nearest.kind === "agent_npc") {
          socketClient.socket?.emit("npc_chat_open", { npcId: nearest.id });
        } else {
          socketClient.socket?.emit("computer_open", { computerId: nearest.id });
        }
      }
    } else {
      this.interactionPrompt.hide();
    }
  }
}
