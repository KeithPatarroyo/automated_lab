# Automated Lab

![Bird's-eye view of the lab](docs/lab-birdseye.png)

A browser-based, top-down 2D "virtual lab" - Pokémon-style movement and dialogue -
loosely inspired by the *Generative Agents* paper (`Paper/2304.03442v2.pdf`) and Andrew
White's drugcrow.ai concept. Two autonomous LLM-agent scientists (`lab_scientist`,
`theoretical_scientist`) run a real closed-loop science task around the clock - walking
between rooms, running experiments, analyzing data, and occasionally chatting with each
other - while any number of human visitors can log in, walk around, watch, and talk to
them or to the in-world computer terminals. The screenshot above is the whole map at
once (`?birdseye=1`, see below): Workshop top-left, Primary Lab top-right, Kitchen
bottom-left, Office bottom-right, every character - the two agents, the three named
flavor NPCs, and all 9 background workers - now rendered with its own distinct sprite
rather than a shared placeholder tile.

See `lab_sketch/SKETCH.png` for the real floor-plan this loosely riffs on.

## Quick start

```bash
# Node 20+ needed; if you don't have one:
conda create -n automated_lab -c conda-forge nodejs=22 -y
conda activate automated_lab

npm install
cp server/.env.example server/.env   # fill in GEMINI_API_KEY (free at aistudio.google.com)
npm run dev                          # client (Vite, :5173) + server (Socket.IO, :3001)
```

Open http://localhost:5173. The login screen offers **Visitor** (pick a name and a
male/female character, then you're in) or **Log In** (a username/password form with no
real account system behind it yet - it's a placeholder for future auth work). Without
`GEMINI_API_KEY` set, everything else still works - the computer terminals and talking
to the two agents will show a visible error instead of crashing.

## Two ways to run it: simulation vs. display-only

The two agents' behavior is controlled by `SIMULATION_MODE` in `server/.env`:

- **`live` (the default)** - the real thing. Each agent runs its own decision loop
  (~every 2 minutes) backed by Gemini: choosing what to do next, running experiments,
  analyzing data, walking the map with real pathfinding, occasionally talking to each
  other. This is genuinely evolving - new experiment data, new memory, new conversation
  every time - but it costs LLM tokens continuously for as long as the server runs.
- **`replay`** - a fixed recorded session (baked from the database's most recent `live`
  run) loops on repeat with **no background decision loop running at all**, so the two
  agents cost zero LLM tokens no matter how long it plays. Useful for a public demo or
  just leaving the tab open without burning API credits. A human's own chat with the
  terminals or the two agents still calls Gemini normally in either mode - replay only
  affects the two background agents' own behavior, not human interaction.

## The world & characters

Four rooms - Workshop, Primary Lab, Kitchen/Corridor, Office - connected by door gaps,
real-time multiplayer movement, and a shared collision system (see below). Every
character now has its own sprite, extracted from LPC-format character sheets generated
via the [Universal LPC Spritesheet Character Generator](https://liberatedpixelcup.github.io/)
(`client/scripts/extract-npc-sprite.py` for static NPCs, `extract-player-sprite.py` for
the player and the two agents), each posed at a specific facing direction (and, for
three of them, seated) chosen per-character:

- **The two LLM agents** - `lab_scientist` (experimentalist, based at the Primary Lab
  terminal) and `theoretical_scientist` (theorist, based at the Office desk) - have a
  full walk cycle each that switches outfit between the Lab and every other room, not
  just a static portrait.
- **3 named flavor NPCs** with canned dialogue - `workshop_tech`, `kitchen_cook`,
  `office_manager`.
- **9 background worker NPCs** (2 Workshop, 2 Lab, 2 Office, 3 Kitchen - e.g.
  "Machinist", "Lab Safety Officer") with their own 2-line canned dialogue and no
  floating name label, meant to populate a room without drawing attention the way a
  named character does. All three Kitchen workers are seated, each facing a different
  direction.
- **The player character** - pick male or female at login; both are full LPC-format
  walk/sit cycles that switch outfit by room (Lab vs. everywhere else), for both your
  own view and everyone else's.

The two in-world computer terminals (Lab, Office) each have a floating name label so
they're identifiable without walking up to them. Loading the client with `?birdseye=1`
(e.g. `http://localhost:5173/?birdseye=1`) zooms the camera out to fit the whole map,
hides the chat/agent-log panels and your own sprite/nametag, and additionally marks
every spawn point with a highlighted tile + label - useful for regenerating
`docs/lab-birdseye.png` after a map edit; none of that spawn-point marking shows up
during normal play. Log in as usual; the view switches once the map scene starts.

## The science task

The two agents' work (`server/src/science/crystalDomain.ts`, `experimentLog.ts`) is a
fictional but internally-consistent "chaotic layered crystals" domain, loosely modeled
on real SiC/ZnS polytype stacking-fault physics: a material is a sequence of "H"/"C"
stacking symbols, and the search space grows as 2^N, so the task has no ceiling. Each
measurement carries realistic synthetic instrument noise (bulk modulus has a genuine
quadratic instrument-response curve to ground truth, not just linear+noise).

The two computer terminals are grounded in this real data
(`server/src/science/terminalVisualization.ts`): the Lab terminal renders a
theory-vs-experiment parity plot with real measurement uncertainty, the Office terminal
renders a structure diagram plus an information-content/bulk-modulus scatter plot across
recent runs, and both terminals' chat (and chatting with either agent directly) is
grounded in the actual experiment log and that agent's own memory instead of a generic
prompt.

**Not yet done:** the theorist's analysis doesn't feed back into the experimentalist's
next configuration choice - each agent's decision loop runs independently.

## Persistence

`server/src/db/index.ts` opens a SQLite database at `server/data/lab.sqlite`
(git-ignored; `:memory:` under the test runner) that backs agent memory, the experiment
log/target, the activity feed, and each agent's position - all of it survives a server
restart, and is what `replay` mode bakes its loop from. The human player is deliberately
**not** persisted; a visitor is an observer, not part of the simulated lab's history, and
starts fresh every time they join.

## Editing the map

`client/public/assets/map/lab.json` is a **hand-edited Tiled map**, not generated code -
edit it directly in the [Tiled](https://www.mapeditor.org/) app. The original generator,
`client/scripts/generate-map.mjs`, produced the very first version (a 40x30 tile world,
four quadrants, door gaps) but **must not be re-run now** - it would silently overwrite
every manual edit since. Keep it around only as a reference for the original layout
constants.

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
separating back out (which is what Phaser's Arcade-physics colliders do by default).
Keep it this way: if client and server ever run different collision logic again, they
will eventually visually disagree near a wall boundary, however subtly.

## Tests

```bash
npm run test       # server-side vitest: collision/movement, join (incl. gender),
                    # chat broadcast+cap, NPC proximity gating, terminal error path
npm run typecheck   # all three workspaces
```

There's no browser automation in this repo - verify actual gameplay manually with
multiple browser tabs. Worth checking each time you touch movement/UI:

- Walking into walls in all four rooms doesn't clip through them, but the door gaps
  between rooms do let you through.
- Two+ tabs see each other move smoothly, with the correct male/female sprite for each;
  closing a tab removes that player for everyone else.
- Walking up to an NPC or either agent (facing it) shows an interact prompt; talking
  opens a dialogue box and blocks movement until closed; other players are unaffected.
- Chat messages appear in every connected tab; a newly-joined tab sees recent history.
- Using a computer terminal round-trips through the server only - check the browser's
  network tab and confirm there is never a direct request to
  `generativelanguage.googleapis.com`, only same-origin Socket.IO traffic.

## Known limitations (by design, not bugs)

- **Human player state isn't persisted.** Position, chat, and login are in-memory and
  reset on restart - only the two LLM agents' state lives in SQLite (see Persistence
  above).
- **Username-only login**, no passwords or accounts. The "Log In" option on the login
  screen is a UI placeholder only - picking it shows a form but submitting does nothing.
  Fine for a trusted-network prototype; revisit before exposing this beyond that.
- **Not publicly deployed yet.** `replay` mode makes this affordable to host publicly
  (zero ongoing agent LLM spend), but no hosting has been set up.
- **No inter-agent handoff.** The theorist's analysis doesn't yet feed the
  experimentalist's next configuration choice - see "The science task" above.

## Art & asset credits

Everything below is used under its stated license; keep this list in sync with
`client/src/scenes/mapTilesets.ts` and `client/public/assets/sprites/` when adding more.

| Asset | License | Credit |
|---|---|---|
| Kenney "RPG Urban Pack" (base tiles, computer-terminal props) | CC0 | Kenney (kenney.nl) |
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
| Player character spritesheets (male + female, Lab/outside outfits, full walk+sit cycles) | CC-BY-SA 3.0 / GPL 3.0 (per the generator's combined assets) | Generated via the [Universal LPC Spritesheet Character Generator](https://liberatedpixelcup.github.io/); Liberated Pixel Cup / OpenGameArt contributors |
| The two LLM agents' character spritesheets (Lab/outside outfits, full walk cycles) | CC-BY-SA 3.0 / GPL 3.0 (per the generator's combined assets) | Generated via the [Universal LPC Spritesheet Character Generator](https://liberatedpixelcup.github.io/); Liberated Pixel Cup / OpenGameArt contributors |
| All 12 static NPC portraits (3 named + 9 background workers, one static pose each) | CC-BY-SA 3.0 / GPL 3.0 (per the generator's combined assets) | Generated via the [Universal LPC Spritesheet Character Generator](https://liberatedpixelcup.github.io/); Liberated Pixel Cup / OpenGameArt contributors |
