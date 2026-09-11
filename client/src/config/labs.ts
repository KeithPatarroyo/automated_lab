export interface LabDef {
  id: string;
  displayName: string;
  serverUrl: string;
  tilemapKey: string;
  tilemapPath: string;
  /** Bird's-eye screenshot shown as a clickable thumbnail in ChangeLabModal's picker -
   * see README's "Multiple labs" section for how to regenerate these (?birdseye=1). */
  previewImage: string;
  /** npcId -> Phaser texture key, overriding NPC_TEXTURE_KEYS (entities/spriteFrames.ts)
   * for this lab only - "exactly the same dynamics" everywhere except a handful of
   * per-lab cosmetic tweaks like which way a static NPC faces (see MainScene's NPC
   * creation loop). Omit entirely for a lab that has no overrides. */
  npcTextureOverrides?: Record<string, string>;
}

/** Every lab this client build knows about - each one is a fully independent server
 * process/database (see README's "Multiple labs" section), not a room within one
 * server. `VITE_SERVER_URL` stays lab_1's fallback so the deployed client keeps working
 * with zero env changes; `VITE_LAB1_SERVER_URL`/`VITE_LAB2_SERVER_URL` are the seam for
 * pointing each lab at its own deployed server later. */
export const LABS: LabDef[] = [
  {
    id: "lab_1",
    displayName: "Lab 1",
    serverUrl: import.meta.env.VITE_LAB1_SERVER_URL ?? import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001",
    tilemapKey: "lab-map",
    tilemapPath: "/assets/map/lab.json",
    previewImage: "/assets/lab-previews/lab_1.png",
  },
  {
    id: "lab_2",
    displayName: "Lab 2",
    serverUrl: import.meta.env.VITE_LAB2_SERVER_URL ?? "http://localhost:3002",
    tilemapKey: "lab-map-2",
    tilemapPath: "/assets/map/lab_2.json",
    npcTextureOverrides: { office_manager: "office_manager_npc_right" },
    previewImage: "/assets/lab-previews/lab_2.png",
  },
];

export const DEFAULT_LAB_ID = "lab_1";

/** Which lab this page load targets - the `?lab=` query param, or the default. Read
 * once per page load (see LoginScene) - switching labs is a full reload, not a live
 * scene transition (see ChangeLabModal). */
export function resolveActiveLab(): LabDef {
  const id = new URLSearchParams(window.location.search).get("lab");
  return LABS.find((l) => l.id === id) ?? LABS.find((l) => l.id === DEFAULT_LAB_ID)!;
}
