import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { COLLISION_LAYER_NAMES, type MapMeta } from "@lab/shared";
import { MAP_FILE } from "../env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_PATH = path.resolve(__dirname, "../../../client/public/assets/map", MAP_FILE);

interface TiledTileLayer {
  type: "tilelayer";
  name: string;
  width: number;
  height: number;
  data: number[];
}

interface TiledProperty {
  name: string;
  value: string | number;
}

interface TiledObject {
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: TiledProperty[];
}

interface TiledObjectLayer {
  type: "objectgroup";
  name: string;
  objects: TiledObject[];
}

type TiledLayer = TiledTileLayer | TiledObjectLayer;

interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
}

function prop(obj: TiledObject, name: string): string {
  const p = obj.properties?.find((p) => p.name === name);
  if (p === undefined) throw new Error(`Map object "${obj.name}" missing property "${name}"`);
  return String(p.value);
}

function loadRawMap(): TiledMap {
  const raw = readFileSync(MAP_PATH, "utf-8");
  return JSON.parse(raw) as TiledMap;
}

const rawMap = loadRawMap();

function findTileLayer(name: string): TiledTileLayer {
  const layer = rawMap.layers.find((l): l is TiledTileLayer => l.type === "tilelayer" && l.name === name);
  if (!layer) throw new Error(`Map is missing tile layer "${name}"`);
  return layer;
}

function findTileLayerOptional(name: string): TiledTileLayer | undefined {
  return rawMap.layers.find((l): l is TiledTileLayer => l.type === "tilelayer" && l.name === name);
}

function findObjectLayer(name: string): TiledObjectLayer {
  const layer = rawMap.layers.find((l): l is TiledObjectLayer => l.type === "objectgroup" && l.name === name);
  if (!layer) throw new Error(`Map is missing object layer "${name}"`);
  return layer;
}

const wallsLayer = findTileLayer("walls");
const spawnsLayer = findObjectLayer("spawns");
const npcsLayer = findObjectLayer("npcs");
const computersLayer = findObjectLayer("computers");
const zonesLayer = findObjectLayer("zones");

// Any non-zero GID in one of shared's COLLISION_LAYER_NAMES blocks movement - "walls"
// doubles as both the visual wall dressing and (part of) the collision source, and
// furniture/pc props block too (a desk or machine you painted in Tiled should stop
// you, not just the walls).
const collisionLayers = COLLISION_LAYER_NAMES.map(findTileLayerOptional).filter((l): l is TiledTileLayer => !!l);

export const collisionGrid: boolean[][] = [];
for (let y = 0; y < wallsLayer.height; y++) {
  const row: boolean[] = [];
  for (let x = 0; x < wallsLayer.width; x++) {
    const blocked = collisionLayers.some((layer) => layer.data[y * layer.width + x] !== 0);
    row.push(blocked);
  }
  collisionGrid.push(row);
}

export function isBlocked(tileX: number, tileY: number): boolean {
  if (tileY < 0 || tileY >= collisionGrid.length) return true;
  const row = collisionGrid[tileY];
  if (tileX < 0 || tileX >= row.length) return true;
  return row[tileX];
}

export const TILE_WIDTH = rawMap.tilewidth;
export const TILE_HEIGHT = rawMap.tileheight;

function toTile(px: number, py: number) {
  return { x: px / TILE_WIDTH, y: py / TILE_HEIGHT };
}

export const mapMeta: MapMeta = {
  tileWidth: rawMap.tilewidth,
  tileHeight: rawMap.tileheight,
  widthTiles: rawMap.width,
  heightTiles: rawMap.height,
  spawns: spawnsLayer.objects.map((o) => toTile(o.x, o.y)),
  npcs: npcsLayer.objects.map((o) => ({ npcId: prop(o, "npcId"), ...toTile(o.x, o.y) })),
  computers: computersLayer.objects.map((o) => ({ computerId: prop(o, "computerId"), ...toTile(o.x, o.y) })),
  zones: zonesLayer.objects.map((o) => ({
    zoneId: prop(o, "zoneId"),
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
  })),
};

export function randomSpawn() {
  const s = mapMeta.spawns[Math.floor(Math.random() * mapMeta.spawns.length)];
  return { x: s.x * TILE_WIDTH, y: s.y * TILE_HEIGHT };
}
