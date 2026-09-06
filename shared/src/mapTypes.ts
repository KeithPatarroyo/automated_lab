export type Direction = "up" | "down" | "left" | "right";

export interface SpawnPoint {
  x: number;
  y: number;
}

export interface NpcSpawn {
  npcId: string;
  x: number;
  y: number;
}

export interface ComputerSpawn {
  computerId: string;
  x: number;
  y: number;
}

/** A rectangular area (in pixels) used to decide which outfit/behavior applies where. */
export interface ZoneRect {
  zoneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which zone (if any) a pixel position falls inside - used to switch player outfits. */
export function resolveZone(zones: ZoneRect[], x: number, y: number): string | undefined {
  return zones.find((z) => x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height)?.zoneId;
}

export interface MapMeta {
  tileWidth: number;
  tileHeight: number;
  widthTiles: number;
  heightTiles: number;
  spawns: SpawnPoint[];
  npcs: NpcSpawn[];
  computers: ComputerSpawn[];
  zones: ZoneRect[];
}
