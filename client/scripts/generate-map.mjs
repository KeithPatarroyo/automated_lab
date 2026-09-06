// Procedurally generates client/public/assets/map/lab.json (Tiled JSON format).
// Re-run with `node client/scripts/generate-map.mjs` after tweaking constants below.
// The map can also be opened/edited in the real Tiled app afterward - this script
// just avoids hand-typing a large tile array for the v1 placeholder layout.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.resolve(__dirname, "../public/assets/map/lab.json");

const TILE_SIZE = 16;
const WIDTH = 40;
const HEIGHT = 30;
const MID_X = 20;
const MID_Y = 15;

// Tile GIDs from kenney_rpg-urban-pack tilemap_packed.png (27 cols x 18 rows, firstgid=1)
const T = {
  FLOOR_WORKSHOP: 1,   // idx 0: teal mat
  FLOOR_LAB: 9,        // idx 8: gray mat
  FLOOR_KITCHEN: 109,  // idx 108: tan/wood mat
  FLOOR_OFFICE: 15,    // idx 14: pale lavender stone
  WALL: 42,            // idx 41: plain flat gray
  BENCH_WORKSHOP: 276, // idx 275: brown drawer/chest ("workbench")
  TOOL_SIGN: 311,      // idx 310: wrench/tool icon
  LAB_SCREEN: 361,     // idx 360: big light monitor/screen panel
  LAB_CROSS: 403,      // idx 402: cross symbol marker
  KITCHEN_TABLE: 222,  // idx 221: orange table with legs
  KITCHEN_BENCH: 224,  // idx 223: small orange bench
  OFFICE_DESK: 335,    // idx 334: gray filing cabinet / desk-like block
  COMPUTER: 361,       // idx 360: reuse lab screen tile as the interactable computer sprite
  DOOR_MARKER: 61,     // idx 60: teal ring/mat - stamped on doorway floor tiles so gaps are visible, not guesswork
};

function emptyGrid(fill = 0) {
  return Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(fill));
}

function setRect(grid, x0, y0, x1, y1, value) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (y >= 0 && y < HEIGHT && x >= 0 && x < WIDTH) grid[y][x] = value;
    }
  }
}

function flatten(grid) {
  return grid.flat();
}

// --- ground layer: one floor tile per quadrant ---
const ground = emptyGrid(T.FLOOR_KITCHEN);
setRect(ground, 0, 0, MID_X - 1, MID_Y - 1, T.FLOOR_WORKSHOP); // top-left
setRect(ground, MID_X, 0, WIDTH - 1, MID_Y - 1, T.FLOOR_LAB); // top-right
setRect(ground, 0, MID_Y, MID_X - 1, HEIGHT - 1, T.FLOOR_KITCHEN); // bottom-left
setRect(ground, MID_X, MID_Y, WIDTH - 1, HEIGHT - 1, T.FLOOR_OFFICE); // bottom-right

// --- walls layer: doubles as the authoritative collision source (any non-zero = blocked) ---
const walls = emptyGrid(0);
// outer border
setRect(walls, 0, 0, WIDTH - 1, 0, T.WALL);
setRect(walls, 0, HEIGHT - 1, WIDTH - 1, HEIGHT - 1, T.WALL);
setRect(walls, 0, 0, 0, HEIGHT - 1, T.WALL);
setRect(walls, WIDTH - 1, 0, WIDTH - 1, HEIGHT - 1, T.WALL);
// internal cross dividing the 4 rooms
setRect(walls, MID_X, 0, MID_X, HEIGHT - 1, T.WALL); // vertical divider
setRect(walls, 0, MID_Y, WIDTH - 1, MID_Y, T.WALL); // horizontal divider

// Doorway gaps: 8 tiles wide (up from an earlier 4-tile version that play-testing
// showed was too easy to miss entirely - the wall reads the same as open floor next
// to it, so a narrow unmarked gap in a 300+px wall felt like being trapped). Each
// gap also gets a DOOR_MARKER tile stamped on the furniture layer below so the
// opening is visible, not something you have to hug the wall to stumble into.
const DOORWAYS = [
  { axis: "vertical", fixed: MID_X, from: 2, to: 9 }, // Workshop <-> Lab
  { axis: "horizontal", fixed: MID_Y, from: 2, to: 9 }, // Workshop <-> Kitchen
  { axis: "horizontal", fixed: MID_Y, from: 30, to: 37 }, // Lab <-> Office
  { axis: "vertical", fixed: MID_X, from: 20, to: 27 }, // Kitchen <-> Office
];

for (const d of DOORWAYS) {
  if (d.axis === "vertical") setRect(walls, d.fixed, d.from, d.fixed, d.to, 0);
  else setRect(walls, d.from, d.fixed, d.to, d.fixed, 0);
}

// --- furniture layer: decorative only, does not block movement in v1 ---
const furniture = emptyGrid(0);
// Workshop: a row of workbenches
for (let x = 3; x <= 16; x += 2) furniture[4][x] = T.BENCH_WORKSHOP;
furniture[6][3] = T.TOOL_SIGN;
// Primary Lab: benches with monitors
for (let x = 23; x <= 36; x += 2) furniture[4][x] = T.LAB_SCREEN;
furniture[7][37] = T.LAB_CROSS;
// Kitchen: table + bench cluster
setRect(furniture, 8, 20, 11, 20, T.KITCHEN_TABLE);
furniture[22][9] = T.KITCHEN_BENCH;
furniture[22][12] = T.KITCHEN_BENCH;
// Office: rows of desks
for (let x = 23; x <= 36; x += 3) {
  furniture[18][x] = T.OFFICE_DESK;
  furniture[25][x] = T.OFFICE_DESK;
}

// Doorway markers: a visually distinct mat across the full width of every gap so
// each opening is obvious to a player walking along the wall, not just theoretically
// walkable.
for (const d of DOORWAYS) {
  if (d.axis === "vertical") {
    for (let y = d.from; y <= d.to; y++) furniture[y][d.fixed] = T.DOOR_MARKER;
  } else {
    for (let x = d.from; x <= d.to; x++) furniture[d.fixed][x] = T.DOOR_MARKER;
  }
}

function layer(id, name, data, extra = {}) {
  return {
    id,
    name,
    type: "tilelayer",
    width: WIDTH,
    height: HEIGHT,
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    data: flatten(data),
    ...extra,
  };
}

function objectLayer(id, name, objects) {
  return {
    id,
    name,
    type: "objectgroup",
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    draworder: "topdown",
    objects,
  };
}

function tileCenter(tx, ty) {
  return { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
}

let nextObjId = 1;
function pointObject(tx, ty, name, type, properties) {
  const { x, y } = tileCenter(tx, ty);
  return {
    id: nextObjId++,
    name,
    type,
    x,
    y,
    width: 0,
    height: 0,
    visible: true,
    properties: Object.entries(properties).map(([n, v]) => ({
      name: n,
      type: typeof v === "number" ? "int" : "string",
      value: v,
    })),
  };
}

function rectObject(x0, y0, x1, y1, name, type, properties) {
  return {
    id: nextObjId++,
    name,
    type,
    x: x0 * TILE_SIZE,
    y: y0 * TILE_SIZE,
    width: (x1 - x0 + 1) * TILE_SIZE,
    height: (y1 - y0 + 1) * TILE_SIZE,
    visible: true,
    properties: Object.entries(properties).map(([n, v]) => ({
      name: n,
      type: typeof v === "number" ? "int" : "string",
      value: v,
    })),
  };
}

// Two zones covering the whole map (no gaps) so the client can tell which outfit a
// player should be wearing: Workshop+Lab count as "lab", Kitchen+Office as "outside".
const zones = objectLayer(8, "zones", [
  rectObject(0, 0, WIDTH - 1, MID_Y - 1, "Lab Zone", "zone", { zoneId: "lab" }),
  rectObject(0, MID_Y, WIDTH - 1, HEIGHT - 1, "Outside Zone", "zone", { zoneId: "outside" }),
]);

// Clustered inside the Kitchen/corridor quadrant (the connective hub), clear of
// the border wall (x=0/y=29), the room divider (x=20/y=15), and the furniture above.
const spawns = objectLayer(5, "spawns", [
  pointObject(3, 17, "spawn1", "spawn", {}),
  pointObject(3, 19, "spawn2", "spawn", {}),
  pointObject(3, 21, "spawn3", "spawn", {}),
  pointObject(3, 23, "spawn4", "spawn", {}),
  pointObject(3, 25, "spawn5", "spawn", {}),
  pointObject(3, 27, "spawn6", "spawn", {}),
]);

const npcs = objectLayer(6, "npcs", [
  pointObject(10, 8, "Workshop Tech", "npc", { npcId: "workshop_tech" }),
  pointObject(30, 8, "Lab Scientist", "npc", { npcId: "lab_scientist" }),
  pointObject(9, 24, "Kitchen Cook", "npc", { npcId: "kitchen_cook" }),
  pointObject(30, 24, "Office Manager", "npc", { npcId: "office_manager" }),
]);

const computers = objectLayer(7, "computers", [
  pointObject(25, 10, "Lab Terminal", "computer", { computerId: "lab_terminal" }),
  pointObject(35, 21, "Office Terminal", "computer", { computerId: "office_terminal" }),
]);

const map = {
  compressionlevel: -1,
  width: WIDTH,
  height: HEIGHT,
  infinite: false,
  orientation: "orthogonal",
  renderorder: "right-down",
  tiledversion: "1.10.2",
  tilewidth: TILE_SIZE,
  tileheight: TILE_SIZE,
  type: "map",
  version: "1.10",
  nextlayerid: 9,
  nextobjectid: nextObjId,
  tilesets: [
    {
      firstgid: 1,
      name: "kenney_rpg_urban",
      image: "../tilesets/kenney_rpg-urban-pack/Tilemap/tilemap_packed.png",
      imagewidth: 432,
      imageheight: 288,
      tilewidth: TILE_SIZE,
      tileheight: TILE_SIZE,
      margin: 0,
      spacing: 0,
      columns: 27,
      tilecount: 486,
    },
  ],
  layers: [
    layer(1, "ground", ground),
    layer(2, "walls", walls),
    layer(3, "furniture", furniture),
    spawns,
    npcs,
    computers,
    zones,
  ],
};

writeFileSync(OUT_PATH, JSON.stringify(map, null, 2));
console.log(`Wrote ${OUT_PATH}`);
