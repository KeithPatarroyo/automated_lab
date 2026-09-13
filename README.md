# Automated Lab

![Bird's-eye view of Lab 1 (left) and Lab 2 (right)](docs/lab-birdseye.png)

A 2D virtual lab for measuring human-machine teaming configurations with LLM-backed
agents doing autonomous science - a browser-based, role-playing videogame-style top-down world,
inspired by the *Generative Agents* paper (`Paper/2304.03442v2.pdf`) and Andrew
White's drugcrow.ai concept. Two autonomous LLM-agent scientists (`lab_scientist`,
`theoretical_scientist`) run a real closed-loop science task around the clock - walking
between rooms, running experiments, analyzing data, and occasionally chatting with each
other - while any number of human visitors can log in, walk around, watch, and talk to
them or to the in-world computer terminals. Each screenshot above is one lab's whole map
at once (`?birdseye=1`, see below) - Workshop top-left, Primary Lab top-right, Kitchen
bottom-left, Office bottom-right in both - every character - the two agents, the three
named flavor NPCs, and all 9 background workers - rendered with its own distinct sprite
rather than a shared placeholder tile. See "Multiple labs" below for what having two of
these actually means.

See `lab_sketch/SKETCH.png` for the real floor-plan this loosely riffs on.

## Contents

- [Quick start](#quick-start)
- [Two ways to run it: simulation vs. display-only](#two-ways-to-run-it-simulation-vs-display-only)
- [The world & characters](#the-world--characters)
- [The science task](#the-science-task)
- [Login & human accounts](#login--human-accounts)
- [Persistence](#persistence)
- [Metrics dashboard](#metrics-dashboard)
- [Deployment](#deployment)
- [Multiple labs](#multiple-labs)
- [Editing the map](#editing-the-map)
  - [Adding a new tileset](#adding-a-new-tileset)
- [Movement & collision](#movement--collision)
- [Mobile touch controls](#mobile-touch-controls)
- [Tests](#tests)
- [Art & asset credits](#art--asset-credits)

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
male/female character - ephemeral, no persistence) or **Log In** (two named accounts
only, password-protected and persisted - see "Login & human accounts" below). Without
`GEMINI_API_KEY` set, everything else still works - the computer terminals and talking
to the two agents will show a visible error instead of crashing.

## Two ways to run it: simulation vs. display-only

The two agents' behavior is controlled by `SIMULATION_MODE` in `server/.env`:

- **`live` (the default)** - the real thing. Each agent runs its own decision loop
  (~every 2 minutes) backed by Gemini: choosing what to do next, running experiments,
  analyzing data, walking the map with real pathfinding, occasionally talking to each
  other. This is genuinely evolving - new experiment data, new memory, new conversation
  every time - but it costs LLM tokens continuously for as long as the server runs.
- **`replay`** - a fixed recorded session loops on repeat with **no background decision
  loop running at all**, so the two agents cost zero LLM tokens no matter how long it
  plays. Useful for a public demo or just leaving the tab open without burning API
  credits. A human's own chat with the terminals or the two agents still calls Gemini
  normally in either mode - replay only affects the two background agents' own
  behavior, not human interaction. By default it bakes the database's most recent
  `live` session; set `REPLAY_WINDOW_START` (ISO-8601) and `REPLAY_WINDOW_HOURS`
  together to pin it to a specific recorded window instead (see
  `server/.env.example`) - e.g. the live deployment currently replays a 3.5-hour
  window (Lab 1 from `2026-09-11T07:00:42.955Z`, Lab 2 from
  `2026-09-12T07:00:53.656Z` - each lab's own `fly.*.toml`), which bakes down to
  roughly 20 minutes of actual loop playback (each recorded decision holds for 10s -
  see `HOLD_DURATION_MS` in `server/src/replay/replayEngine.ts` - rather than the ~2
  real minutes it took live) before repeating. The **Metrics** dashboard's
  Agent-to-agent interactions count resets every time a replay loop wraps back to the
  start - see Metrics dashboard below.

## The world & characters

Four rooms - Workshop, Primary Lab, Kitchen/Corridor, Office - connected by door gaps,
real-time multiplayer movement, and a shared collision system (see below). Every
character now has its own sprite, extracted from LPC-format character sheets generated
via the [Universal LPC Spritesheet Character Generator](https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator)
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
(e.g. `http://localhost:5173/?birdseye=1`, or `?lab=lab_2&birdseye=1` for the other lab)
zooms the camera out to fit the whole map, hides the chat/agent-log panels, the top-bar
buttons, and your own sprite/nametag, and additionally marks every spawn point with a
highlighted tile + label - useful for regenerating `docs/lab-birdseye.png` after a map
edit; none of that spawn-point marking shows up during normal play. Log in as usual; the
view switches once the map scene starts. `docs/lab-birdseye.png` itself is the two labs'
screenshots placed side by side with a small "Lab 1"/"Lab 2" label header - there's no
script for this yet, it was assembled by hand from the two individual captures.

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

## Login & human accounts

The login screen (`client/src/ui/LoginForm.ts`) offers two paths:

- **Visitor** - any name except one of the two reserved account names (any case -
  rejected with an inline error so no one can impersonate a real account) plus a
  male/female pick. Fully ephemeral: fresh random spawn every time, own state never
  persisted.
- **Log In** - the two named accounts only, real username/password
  (`server/src/accounts/humanAccounts.ts`), checked against a password env var per
  account (see `server/.env.example` for the exact names) - a plain equality check,
  not hashed - fine for a small trusted group, not a real auth system. A wrong
  password, or logging in as an account that's already connected elsewhere (**single
  session per account** - no two sockets can represent the same identity), shows an
  inline error and leaves the form open rather than failing silently.

A successful login resumes at that account's last known position/facing instead of a
random spawn - see Persistence below for exactly what's saved.

**Capacity:** at most `MAX_CONNECTED_HUMANS` (20, see `server/src/game/state.ts`)
people - Visitors and named accounts counted together - can be connected at once, since
this is served from a single small always-on VM (see Deployment below). Once full, both
a Visitor join and a Log In attempt are refused with an inline "the lab is full" message
on the login screen rather than silently degrading performance for everyone already in.

## Persistence

`server/src/db/index.ts` opens a SQLite database at `server/data/lab.sqlite`
(git-ignored; `:memory:` under the test runner) that backs agent memory, the experiment
log/target, the activity feed, and each agent's position - all of it survives a server
restart, and is what `replay` mode bakes its loop from.

The two named accounts (see Login & human accounts above) get their own table too:
`human_snapshot` (last known x/y/facing, one row per account, overwritten - not a
movement history) - a Visitor's position is never saved. `human_interaction_log` is
different: it records **everyone's** own turns in an NPC-agent chat or on a computer
terminal, a named account or a Visitor alike (a Visitor's rows keyed by their transient
username instead of a stable account key) - backs the **Metrics** dashboard's
"Human-Agent interaction" count below.

The **public chat log** (`public_chat_log` table) is different from both: it records
everything said by anyone - a named account or a Visitor (labeled `"<name> (visitor)"`),
plus a `"<name> (visitor) has left."` system notice on a Visitor's disconnect - and
survives a restart regardless of who sent it. A newly-joined Visitor only sees chat sent
after they arrive (nothing retroactive); logging in as a named account instead loads the
whole persisted history.

An `access_log` table records every *successful* join/login (never a rejected one, e.g.
capacity or a bad password) - one row per person per session, not deduplicated by name -
backing the **Metrics** dashboard below.

## Metrics dashboard

The **Metrics** button (top-right, next to Bird's-eye/Change Lab/Help) opens a
snapshot of this lab's stats, fetched fresh from the server each time it's opened
(`productivity_open`/`productivity_data` in `shared/src/protocol.ts`):

- **Agent-to-Agent interactions** - in `live` mode, a real cumulative count: every line
  of agent-to-agent dialogue ever logged (`agents/runtime.ts`'s decision loop tags each
  side of an exchange with a "💬 " marker in `agent_log`;
  `db.countAgentConversationLines()` counts those rows). In `replay` mode there's no
  "cumulative" to count - replay never writes to the database - so this is instead a
  live counter of chat lines played back **since the current loop started**, which
  resets to 0 the instant the loop wraps back to the beginning
  (`getReplayConversationCount()` in `agents/runtime.ts`, driven by
  `ReplayPlayer.tick()`'s `looped` flag).
- **Human-Agent interaction** - a real count of `human_interaction_log` rows
  (`db.countHumanInteractionLogEntries()`) - every message (both sides) of anyone's
  conversation with a computer terminal or directly with one of the two agents, a
  named account or a Visitor alike (see Persistence above). A Visitor's turns are
  logged under their own transient username rather than a stable account key, so
  `loadRecentHumanInteractionLog`'s per-account lookups still only ever return a real
  named account's own history.
- **Number of visitors** - a real count of `access_log` rows (`db.countAccessLogEntries()`)
  - every *successful* join or login, Visitors and named accounts alike (see
  Persistence above); despite the name, this also counts named-account logins, not
  only anonymous Visitors.
- **Productivity score** and **Efficiency score** - qualitative snapshots that aim to
  capture how the lab_scientist (experimentalist) and theoretical_scientist agents'
  actual results are trending.
- **Simulation vs experiment** - also fixed for now (`SIMULATION_MATCH_LABEL` in
  `server/src/env.ts`). A placeholder for a future metric: once this task has a real
  physical experiment to compare against (rather than the synthetic instrument model
  in `server/src/science/`), this would become an actual agreement score between the
  simulation's results and real measurements, instead of a fixed percentage.

Each lab's counts are independent, same as everything else in Persistence - they only
reflect that lab's own database (and, in replay mode, that lab's own loop).

## Deployment

Live at **https://automated-lab.vercel.app** (one client) talking to **two**
independent Fly.io server apps, one per lab - **https://automated-lab.fly.dev** (Lab 1)
and **https://automated-lab-2.fly.dev** (Lab 2). Client and servers deploy separately
since each server needs a long-lived WebSocket process and a persistent disk (neither
fits a serverless host), while the client is a static Vite build. See Multiple labs
below for why each lab is a fully separate Fly app rather than one process serving both.

- **Servers (Fly.io), one app per lab:**
  - `automated-lab` (Lab 1): volume `lab_data` mounted at `server/data`, running
    `SIMULATION_MODE=replay` pinned to a 3.5h window from `2026-09-11T07:00:42.955Z`
    (`fly.toml`'s `[env]` block). Redeploy: `flyctl deploy --app automated-lab` from
    the repo root.
  - `automated-lab-2` (Lab 2): its own volume `lab2_data`, `MAP_FILE=lab_2.json`,
    `DB_FILE=lab_2_v2.sqlite`, also `SIMULATION_MODE=replay` pinned to its own 3.5h
    window from `2026-09-12T07:00:53.656Z` (`fly.lab2.toml` - a second, separate
    fly.toml since flyctl only reads one config per app by default). Redeploy:
    `flyctl deploy --config fly.lab2.toml --app automated-lab-2` from the repo root.
  - Both run the exact same unmodified `Dockerfile` (`@lab/server` straight from
    TypeScript via `tsx` - no build step, since `shared` has no build script and is
    meant to be consumed as source by both `tsx` and Vite), just parameterized
    differently. Each app's volume means agent memory/experiment history, the two
    named accounts' own state, and the public chat log (see Persistence above) all
    survive a redeploy of that lab - and redeploying one lab's app never touches the
    other's data.
  - Secrets (`GEMINI_API_KEY`, `CLIENT_ORIGIN`, and the two account password env vars)
    live in Fly secrets, not in git - **set independently per app**, since Fly secrets
    can't be copied between apps or read back once set
    (`flyctl secrets set KEY=value --app <app-name>`). Non-secret config
    (`SIMULATION_MODE`, `MAP_FILE`, `DB_FILE`, `REPLAY_WINDOW_START`,
    `REPLAY_WINDOW_HOURS` - see "Two ways to run it" and "Multiple labs" above) lives
    directly in each app's `[env]` block instead, since there's nothing sensitive
    about them.
- **Client (Vercel):** project root directory is set to `client/` (via
  `vercel project update automated-lab --root-directory client`, not
  `vercel.json` - a bare `rootDirectory` key there fails schema validation), so `npm
  install` still runs at the repo root and resolves the `@lab/shared` workspace
  correctly. Two production env vars point it at both servers: `VITE_SERVER_URL`
  (Lab 1, kept under its original name for backward compatibility) and
  `VITE_LAB2_SERVER_URL` (Lab 2) - see `client/src/config/labs.ts`.
  Redeploy with `vercel --prod --yes` from the repo root.
- Changing a server's URL means updating the other side: a new client URL needs
  `flyctl secrets set CLIENT_ORIGIN=<url> --app <app-name>` (CORS) on **both** server
  apps, and a new server URL needs the matching `VITE_SERVER_URL`/`VITE_LAB2_SERVER_URL`
  env var updated in the Vercel project and redeployed.

## Multiple labs

The point of having more than one lab isn't just a tech demo of running two at once -
it's a testbed for comparing different human-agent environment configurations against
each other (different map layouts, agent placements, or house rules) and seeing
whether metrics like the Metrics dashboard's productivity, efficiency, and cooperation
(agent-to-agent interactions) numbers actually come out higher in one configuration
than another - see Metrics dashboard above.

A "lab" is a full map + database + agent simulation - not a room inside one server.
Running more than one means running more than one **server process**, each an
unmodified copy of the same codebase pointed at its own map/database via env vars
(`MAP_FILE`, `DB_FILE` - see `server/.env.example`; `PORT`/`SIMULATION_MODE` already
existed). There's no single-process multi-tenancy here on purpose - `mapMeta.ts`,
`db/singleton.ts`, `game/state.ts`'s player list, and `agents/runtime.ts`'s agent state
are all plain module-level singletons, so a second lab is simplest as a second OS
process rather than a rewrite of all four into instantiable classes. This is exactly
how production runs too, just as two separate Fly apps instead of two local processes -
see Deployment above.

**Local:**

```bash
npm run dev:labs   # lab 1 (existing map/db) in replay mode on :3001,
                    # lab 2 (lab_2.json, a separate lab_2.sqlite) live on :3002,
                    # one shared Vite client on :5173
```

The client (`client/src/config/labs.ts`) knows about both by default for local dev
(`http://localhost:3001`/`:3002`) with no env vars needed.

**Production:** the client instead resolves each lab's `serverUrl` from
`VITE_SERVER_URL` (Lab 1, the original single-lab env var - kept as-is so it never
needed renaming) and `VITE_LAB2_SERVER_URL` (Lab 2), pointing at
`automated-lab.fly.dev` and `automated-lab-2.fly.dev` respectively - two fully
independent Fly apps, each with its own volume/database and its own secrets (see
Deployment above). Adding a third lab means: a new Fly app + volume, a new
`fly.<lab>.toml`, a new entry in `client/src/config/labs.ts` with a
`VITE_LAB<N>_SERVER_URL` env var, and that var set in Vercel.

The **Change Lab** button (top-right, next to Bird's-eye/Help) opens a picker; choosing
a different lab does a full page reload to `?lab=<id>` rather than an in-place scene
switch - `MainScene`'s socket listeners and every top-bar UI class have no teardown
path today, and a reload gets a clean reconnect for free from the browser instead of
needing one built. Since each lab has its own accounts/database, switching labs always
lands you back on that lab's own login screen - nothing about your session carries over.

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

## Mobile touch controls

`client/src/ui/TouchControls.ts` detects touch capability
(`"ontouchstart" in window || navigator.maxTouchPoints > 0`) and, only on a touch
device, renders a d-pad (four direction buttons plus a fifth "E"/interact button in
the grid's empty center cell) into the black letterboxed strip Phaser's `Scale.FIT`
leaves below the fixed 640x480 canvas on most phones - not floating on top of the game
view. It exposes the same held-direction booleans (and an interact button that fires
once per tap, like `Phaser.Input.Keyboard.JustDown`) that `MainScene` already reads off
the keyboard every frame, so touch just combines into the existing movement/interact
logic rather than needing its own path; on desktop it's a complete no-op. The chat and
Agent Activity panels (normally anchored to the viewport's bottom edge, where the d-pad
now lives) reposition above the reserved strip via a `--lab-touch-controls-height` CSS
variable TouchControls publishes at runtime, and are both roughly half their desktop
footprint on a touch device (`body.lab-touch-active` in `ui.css`) to leave more room on
a small screen. This is demo-quality, not a full mobile redesign - good enough to hand
someone a phone for a quick look, not tuned for every screen size/orientation.

## Tests

```bash
npm run test       # server-side vitest: collision/movement, join/login (incl. gender,
                    # reserved names, wrong password, concurrent-session rejection,
                    # position resume), chat broadcast + persistence scoping, visitor
                    # departure announcement, NPC proximity gating, terminal error path
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
- Chat messages appear in every connected tab. A newly-joined Visitor tab starts with
  an empty log (no retroactive history); logging in as a named account instead shows
  the full persisted history immediately.
- Using a computer terminal round-trips through the server only - check the browser's
  network tab and confirm there is never a direct request to
  `generativelanguage.googleapis.com`, only same-origin Socket.IO traffic.

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
| Player character spritesheets (male + female, Lab/outside outfits, full walk+sit cycles) | CC-BY-SA 3.0 / GPL 3.0 (per the generator's combined assets) | Generated via the [Universal LPC Spritesheet Character Generator](https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator); Liberated Pixel Cup / OpenGameArt contributors |
| The two LLM agents' character spritesheets (Lab/outside outfits, full walk cycles) | CC-BY-SA 3.0 / GPL 3.0 (per the generator's combined assets) | Generated via the [Universal LPC Spritesheet Character Generator](https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator); Liberated Pixel Cup / OpenGameArt contributors |
| All 12 static NPC portraits (3 named + 9 background workers, one static pose each) | CC-BY-SA 3.0 / GPL 3.0 (per the generator's combined assets) | Generated via the [Universal LPC Spritesheet Character Generator](https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator); Liberated Pixel Cup / OpenGameArt contributors |
