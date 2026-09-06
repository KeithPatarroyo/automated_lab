// Every tileset image the Tiled map (client/public/assets/map/lab.json) can reference.
// `tiledName` must exactly match that tileset's "name" field in the map JSON;
// `textureKey` is the Phaser texture key it's loaded under. Add a row here (and load
// the image alongside it under public/assets/tilesets/) whenever a new tileset is
// painted into the map - no other code needs to change.
export interface MapTilesetDef {
  tiledName: string;
  textureKey: string;
  path: string;
}

const CUTE_RPG_DIR = "/assets/tilesets/cute_rpg_world_16x16/Cute RPG World - RPG Maker MZ 16x16/tilesets";

export const MAP_TILESETS: MapTilesetDef[] = [
  {
    tiledName: "kenney_rpg_urban",
    textureKey: "tiles",
    path: "/assets/tilesets/kenney_rpg-urban-pack/Tilemap/tilemap_packed.png",
  },
  {
    tiledName: "CuteRPG_Castle_B",
    textureKey: "cute_castle_b",
    path: `${CUTE_RPG_DIR}/CuteRPG_Castle_B.png`,
  },
  {
    tiledName: "CuteRPG_Interior_B",
    textureKey: "cute_interior_b",
    path: `${CUTE_RPG_DIR}/CuteRPG_Interior_B.png`,
  },
  {
    tiledName: "CuteRPG_Interior_C",
    textureKey: "cute_interior_c",
    path: `${CUTE_RPG_DIR}/CuteRPG_Interior_C.png`,
  },
  {
    tiledName: "tilesFloor",
    textureKey: "lab_floor",
    path: "/assets/tilesets/land_of_pixels_lab_16px/tilesFloor.png",
  },
  {
    tiledName: "lpc_office_packed",
    textureKey: "lpc_office",
    path: "/assets/tilesets/lpc_office_16px/lpc_office_packed.png",
  },
  {
    tiledName: "lpc_furniture_packed",
    textureKey: "lpc_furniture",
    path: "/assets/tilesets/lpc_furniture_16px/lpc_furniture_packed.png",
  },
  {
    tiledName: "lpc_small_items_packed",
    textureKey: "lpc_small_items",
    path: "/assets/tilesets/lpc_small_items_16px/lpc_small_items_packed.png",
  },
  {
    tiledName: "alchemy",
    textureKey: "lpc_alchemy",
    path: "/assets/tilesets/lpc_alchemy_16px/alchemy.png",
  },
  {
    tiledName: "modern_machines_packed",
    textureKey: "modern_machines",
    path: "/assets/tilesets/modern_machines_16px/modern_machines_packed.png",
  },
  {
    tiledName: "automated_lab_packed",
    textureKey: "automated_lab",
    path: "/assets/tilesets/automated_lab_16px/automated_lab_packed.png",
  },
  {
    tiledName: "glassware_packed",
    textureKey: "glassware",
    path: "/assets/tilesets/glassware_16px/glassware_packed.png",
  },
];
