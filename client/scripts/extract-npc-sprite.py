#!/usr/bin/env python3
"""Extracts a single static portrait frame from a full LPC-format character
spritesheet (lab_sketch/*.png - 832x3456px, 64x64 cells, 13 cols x 54 rows, standard
"Revised Universal Animation Template" layout) for use as a static NPC sprite, unlike
extract-player-sprite.py which pulls the full walk/sit animation blocks for the
player character. Downscaled 2x to match the player sprite's on-screen scale (32x32).

Each NPC gets a fixed facing direction and pose (standing or seated) chosen per-NPC
below (column 0 of the relevant row - a clean, normally-proportioned pose in every
direction/pose combination, same choice extract-player-sprite.py makes for column 0
of the sit block). There's no in-game direction switching for these - they're static
decoration, so whatever's picked here is permanent until this script is re-run with a
different direction/pose.
"""
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
LAB_SKETCH = REPO_ROOT / "lab_sketch"
SPRITES_OUT = REPO_ROOT / "client" / "public" / "assets" / "sprites"

CELL = 64
WALK_START_ROW = 8  # LPC template: rows 8-11 = walk cycle, up/left/down/right
SIT_START_ROW = 30  # LPC template: rows 30-33 = sit, up/left/down/right
DIRECTION_ROW_OFFSET = {"up": 0, "left": 1, "down": 2, "right": 3}
OUT_CELL = 32  # 2x downscale, matches player sprite scale

# source filename (in lab_sketch/) -> list of (output filename, facing direction, pose)
# - usually one variant per source, but a source can produce more than one (e.g. a
# lab-specific alternate facing for the same NPC).
NPC_PORTRAITS = {
    # workshop_tech
    "character-spritesheet_workshop_woman.png": [("workshop-woman.png", "left", "stand")],
    # lab_worker_1 "Lab Technician" / lab_worker_2 "Research Assistant"
    "character-spritesheet_lab_npc_1.png": [("lab-npc-1.png", "up", "stand")],
    "character-spritesheet_lab_npc_2.png": [("lab-npc-2.png", "up", "stand")],
    # workshop_worker_1 "Machinist" / workshop_worker_2 "Workshop Intern"
    # workshop_npc_1's source sheet is a different size (1152x3968, more equipment
    # columns/rows than the standard 832x3456 export) - the walk/sit blocks' position
    # is unaffected since the generator always emits universal animations first in a
    # fixed layout, extra content only appends columns/rows after it.
    "character-spritesheet_workshop_npc_1.png": [("workshop-npc-1.png", "up", "stand")],
    "character-spritesheet_workshop_npc_2.png": [("workshop-npc-2.png", "right", "stand")],
    # kitchen_cook - position not specified by Keith, left as a standing down-facing default
    "character-spritesheet_kitchen_cook_npc.png": [("kitchen-cook.png", "down", "stand")],
    # kitchen_worker_1 "Facilities Coordinator" / kitchen_worker_2 "Lab Safety Officer" /
    # kitchen_worker_3 "Operations Administrator" - all three seated
    "character-spritesheet_npc_facilities_coordinator.png": [
        ("kitchen-npc-facilities-coordinator.png", "up", "sit"),
    ],
    "character-spritesheet_npc_lab_safety_officer.png": [("kitchen-npc-lab-safety-officer.png", "left", "sit")],
    "character-spritesheet_npc_operations_administrator.png": [
        ("kitchen-npc-operations-administrator.png", "right", "sit"),
    ],
    # office_manager "Office Manager" / office_worker_1 "Office Assistant" /
    # office_worker_2 "Data Analyst" - office-manager-right.png is a lab_2-only
    # alternate facing (see client/src/config/labs.ts's npcTextureOverrides), lab_1
    # keeps the "up" default.
    "character-spritesheet_office_manager_npc.png": [
        ("office-manager.png", "up", "stand"),
        ("office-manager-right.png", "right", "stand"),
    ],
    "character-spritesheet_office_npc_1.png": [("office-npc-1.png", "up", "stand")],
    "character-spritesheet_office_npc_2.png": [("office-npc-2.png", "up", "stand")],
}


def extract_frame(im: Image.Image, row: int, col: int, dest: Path) -> None:
    box = (col * CELL, row * CELL, (col + 1) * CELL, (row + 1) * CELL)
    crop = im.crop(box)
    out = crop.resize((OUT_CELL, OUT_CELL), Image.NEAREST)
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest)
    print(f"Wrote {dest} ({out.size[0]}x{out.size[1]})")


def main() -> None:
    for source_name, variants in NPC_PORTRAITS.items():
        im = Image.open(LAB_SKETCH / source_name)
        for out_name, direction, pose in variants:
            start_row = SIT_START_ROW if pose == "sit" else WALK_START_ROW
            row = start_row + DIRECTION_ROW_OFFSET[direction]
            extract_frame(im, row, 0, SPRITES_OUT / out_name)


if __name__ == "__main__":
    main()
