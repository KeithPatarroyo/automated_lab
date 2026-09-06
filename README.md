# Automated Lab (v1)

A browser-based, top-down 2D multiplayer "virtual lab" - Pokémon-style movement and
dialogue - loosely inspired by the *Generative Agents* paper (`Paper/2304.03442v2.pdf`)
and Andrew White's drugcrow.ai concept. Multiple people log in and control avatars in
real time across four rooms (Workshop, Primary Lab, Kitchen/Corridor, Office), talk to
fixed-position NPCs for canned dialogue, chat with each other, and use in-world
"computer" terminals to talk to a real AI agent (Gemini 2.5 Flash) via a server proxy.

See `lab_sketch/SKETCH.png` for the real floor-plan this loosely riffs on.

## Why this lives here and not on the network share

This repo was originally meant to live under the group's `/mnt/scapa/...` network
drive, but that share is CIFS-mounted with `chmod`/symlinks disabled, which breaks both
`git` and `npm` workspaces (npm symlinks workspace packages into `node_modules`). So the
actual working repo lives on local disk. The `Paper/` and `lab_sketch/` reference files
were copied in from the network share at project start.

## Prerequisites

Node.js wasn't installed system-wide in this environment, so it was installed into a
dedicated conda environment:

```bash
conda create -n automated_lab -c conda-forge nodejs=22 -y
conda activate automated_lab
```

Any Node 20+ works fine if you already have one available elsewhere.

## Setup

```bash
npm install
cp server/.env.example server/.env   # then fill in GEMINI_API_KEY (free at aistudio.google.com) to enable the computer terminal
npm run dev                          # runs client (Vite, :5173) + server (Socket.IO, :3001) together
```

Open http://localhost:5173 in two or more browser tabs/windows (or one normal + one
incognito) with different names to see multiplayer movement, chat, NPC dialogue, and the
computer terminal.

Without `GEMINI_API_KEY` set, everything else works; the computer terminal will
reply with a visible in-modal error instead of crashing.

## Editing the map

`client/public/assets/map/lab.json` is now a **hand-edited Tiled map**, not generated
code - edit it directly in the [Tiled](https://www.mapeditor.org/) app. The original
generator, `client/scripts/generate-map.mjs`, produced the very first version (a 40x30
tile world, four quadrants, door gaps) but **must not be re-run now** - it would
silently overwrite every manual edit since. Keep it around only as a reference for the
original layout constants.

Workflow for picking up a new edit: copy the edited file over
`client/public/assets/map/lab.json`, then before trusting it, sanity-check that walls
didn't accidentally cut off a room -

```bash
python3 - <<'EOF'
import json
from collections import deque
m = json.load(open('client/public/assets/map/lab.json'))
walls = next(l for l in m['layers'] if l['name']=='walls')
W, H = walls['width'], walls['height']
data = walls['data']
blocked = lambda x,y: x<0 or x>=W or y<0 or y>=H or data[y*W+x]!=0
seen = {(3,17)}
q = deque(seen)
while q:
    x,y = q.popleft()
    for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]:
        if (x+dx,y+dy) not in seen and not blocked(x+dx,y+dy):
            seen.add((x+dx,y+dy)); q.append((x+dx,y+dy))
npcs = next(l for l in m['layers'] if l['name']=='npcs')
computers = next(l for l in m['layers'] if l['name']=='computers')
for o in npcs['objects'] + computers['objects']:
    tx, ty = int(o['x']//16), int(o['y']//16)
    print(o['name'], 'reachable' if any((tx+dx,ty+dy) in seen for dx in (-1,0,1) for dy in (-1,0,1)) else '** UNREACHABLE **')
EOF
```

then run `npm run test` (the connectivity test in `server/src/game/collision.test.ts`
does the same check automatically) and restart the server, since it reads the map file
once at boot (`server/src/data/mapMeta.ts`).

### Adding a new tileset

Add it in Tiled (New Tileset, 16x16, margin 0, spacing 0), save the map, then register
it in `client/src/scenes/mapTilesets.ts` (Tiled tileset name -> Phaser texture key ->
image path) and drop the image under `client/public/assets/tilesets/`. Every tile layer
in the map renders automatically (`MainScene.ts` loops over `map.layers`), so no other
code changes are needed - a layer or tileset that isn't registered there is the most
common cause of "some tiles aren't showing up."

If a tileset's source art isn't already on a 16x16 grid, downscale/pack it first - see
`client/scripts/pack-lpc-office.py` (and `lpc_pack_common.py`) for the pattern. **Never
regenerate an already-in-use packed sheet** without diffing the output first: which
files get excluded/included changes every item's position in the packed sheet, which
silently breaks any tiles already placed against the old layout in the live map.

## Movement & collision

Both the server (authoritative) and the client (local prediction) call the *same*
`resolveMove` function from `shared/src/collision.ts` against their own copy of the
"walls" tile layer - not just similar logic, the literal same code. It rejects a move
outright if the destination overlaps a wall tile, rather than moving into it and
separating back out (which is what Phaser's Arcade-physics colliders do by default, and
what the player-controlled sprite used before - it produced a visible "creep into the
wall, then get shoved back" feel). Keep it this way: if client and server ever run
different collision logic again, they will eventually visually disagree near a wall
boundary, however subtly.

## Tests

```bash
npm run test       # server-side vitest: collision/movement, join, chat broadcast+cap,
                    # NPC proximity gating, computer-terminal error path
npm run typecheck   # all three workspaces
```

There's no browser automation (Playwright etc.) in v1 - verify the actual gameplay
manually with multiple browser tabs. Worth checking each time you touch movement/UI:

- Walking into walls in all four rooms doesn't clip through them, but the door gaps
  between rooms do let you through.
- Two+ tabs see each other move smoothly; closing a tab removes that player for
  everyone else.
- Walking up to an NPC (facing it) shows an interact prompt; talking opens a dialogue
  box and blocks movement until closed; other players are unaffected.
- Chat messages appear in every connected tab; a newly-joined tab sees recent history.
- Using a computer terminal round-trips through the server only - check the browser's
  network tab and confirm there is never a direct request to `generativelanguage.googleapis.com`, only
  same-origin Socket.IO traffic.

## Known v1 limitations (by design, not bugs)

- **No database.** Player positions, chat history, and computer-terminal sessions are
  all in-memory on the server and reset on restart. NPC dialogue and the map are static
  files in the repo.
- **Username-only login**, no passwords or accounts. Fine for a trusted-network
  prototype; revisit before exposing this beyond that.
- **NPCs are static and scripted**, not LLM-backed. That's deliberately deferred to
  later work (see the Generative Agents paper for where this could go).
- **Mixed art sources.** The original 4-room shell and NPC sprites are Kenney's CC0
  "RPG Urban Pack"; the player character uses the user's own custom LPC-format
  spritesheets (`lab_sketch/character-spritesheet_male_*.png` -> real per-direction walk
  cycles, no flipping tricks). Room decoration is a mix of several LPC-family packs (see
  Art & asset credits below) plus a sci-fi lab pack - see `client/src/scenes/mapTilesets.ts`
  for the full registry.

## Art & asset credits

Everything below is used under its stated license; keep this list in sync with
`client/src/scenes/mapTilesets.ts` and `client/public/assets/sprites/` when adding more.

| Asset | License | Credit |
|---|---|---|
| Kenney "RPG Urban Pack" (base tiles, NPC sprites, computer-terminal props) | CC0 | Kenney (kenney.nl) |
| Cute RPG World - RPG Maker MZ (16x16) (kitchen dressing) | Free (personal/commercial, no resale) | PixyMoon (pixymoon.itch.io) |
| Land of Pixels "Laboratory tileset PixelArt 16px" (lab floor/props) | CC-BY 4.0 | Land of Pixels |
| [LPC] The Office (office props) | OGA-BY 3.0 | Eliza Wyatt (DeathsDarling), Lanea Zimmerman (Sharm) |
| LPC Furniture pack (general furniture, Smithing/workshop props) | OGA-BY 3.0 | Lanea Zimmerman (Sharm), Eliza Wyatt (DeathsDarling), BlueCarrot16, YuriNikolai |
| LPC Small Items pack (tools, ores, clutter, food) | OGA-BY 3.0 | Eliza Wyatt (DeathsDarling), Lanea Zimmerman (Sharm), BlueCarrot16, Richard Kettering (Jetrel) |
| [LPC] Alchemy (chemistry-lab glassware/apparatus) | CC-BY-SA 3.0 / 4.0 | bluecarrot16, Lanea Zimmerman (Sharm), PriorBlue, Jerom, Wolthera van Hövell tot Westerflier (TheraHedwig); commissioned by MedicineStorm |
| Factory Tileset (workshop machines, conveyor belt, server racks/monitors) | CC0 | OpenGameArt.org, made for KeyserEX |
| Modern Machines (CNC mill/lathe/router, 3D printers, laser cutter, workshop tools/materials/signage - 55 icons auto-extracted from a reference sheet via `client/scripts/pack-ai-modern-machines.py`) | User-provided (Keith), AI-generated | - |
| Automated Lab (analytical/wet-lab instruments, glassware, tools, fittings, monitor/signage icons, GHS hazard diamonds - 70 icons auto-extracted from a reference sheet via `client/scripts/pack-ai-automated-lab.py`) | User-provided (Keith), AI-generated | - |
| Glassware (flasks, beakers, test tubes, funnels, condensers, stoppers/joints, retort stands/clamps, small hardware - 312 icons auto-extracted from a reference sheet via `client/scripts/pack-ai-glassware.py`) | User-provided (Keith), AI-generated | - |
| Player character spritesheets | User-provided (Keith) | - |
