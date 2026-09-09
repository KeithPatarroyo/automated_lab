#!/usr/bin/env python3
"""Extracts the walk-cycle and sit-pose rows from the user's LPC-format character
spritesheets (lab_sketch/*.png - 832x3456px, 64x64 cells, 13 cols x 54 rows, standard
"Revised Universal Animation Template" layout) into compact per-outfit sheets under
client/public/assets/sprites/, downscaled 2x so the character reads as ~2 of our 16px
floor tiles tall instead of 4x oversized. Re-run after regenerating/replacing any
source spritesheet.

Walk -> a 9-col x 4-row (up/left/down/right) sheet, one walk-cycle animation per row.
Sit -> a 1-col x 4-row (up/left/down/right) sheet, one static seated frame per row
(the template's sit block has 3 columns - a sit-down transition; column 0 is used here
since it's a clean, normally-proportioned seated pose in every direction, unlike some of
the later columns).
"""
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
LAB_SKETCH = REPO_ROOT / "lab_sketch"
SPRITES_OUT = REPO_ROOT / "client" / "public" / "assets" / "sprites"

CELL = 64
WALK_START_ROW = 8  # LPC template: rows 8-11 = walk cycle, up/left/down/right
WALK_ROWS = 4
WALK_COLS = 9
SIT_START_ROW = 30  # LPC template: rows 30-33 = sit, up/left/down/right
SIT_ROWS = 4
SIT_COLS = 1
OUT_CELL = 32  # 2x downscale

# source filename (in lab_sketch/) -> (walk output filename, sit output filename), both
# written to client/public/assets/sprites/
#
# female_lab.txt / female_outside.txt in lab_sketch/ are LPC-generator save-configs, not
# exported images yet - character-spritesheet_female_lab.png / _female_outside.png don't
# exist until those configs are loaded into the generator and exported. Until then, the
# player-walk/sit-*-female.png outputs below are placeholder copies of the male sheets
# (see BootScene.ts's comment) - re-run this script once the real source PNGs land in
# lab_sketch/ and it'll overwrite the placeholders with the real art, no code changes needed.
OUTFITS = {
    "character-spritesheet_male_lab.png": ("player-walk-lab.png", "player-sit-lab.png"),
    "character-spritesheet_male_outside.png": ("player-walk-outside.png", "player-sit-outside.png"),
    "character-spritesheet_female_lab.png": ("player-walk-lab-female.png", "player-sit-lab-female.png"),
    "character-spritesheet_female_outside.png": ("player-walk-outside-female.png", "player-sit-outside-female.png"),
    # The two LLM-agent scientists (server/src/agents/personas.ts) - "office" here is the
    # user's name for the same default/non-lab OutfitZone the player calls "outside".
    "character-spritesheet_lab_agent_lab.png": ("agent-lab-scientist-walk-lab.png", "agent-lab-scientist-sit-lab.png"),
    "character-spritesheet_lab_agent_office.png": (
        "agent-lab-scientist-walk-outside.png",
        "agent-lab-scientist-sit-outside.png",
    ),
    "character-spritesheet_theory_agent_lab.png": (
        "agent-theoretical-scientist-walk-lab.png",
        "agent-theoretical-scientist-sit-lab.png",
    ),
    "character-spritesheet_theory_agent_office.png": (
        "agent-theoretical-scientist-walk-outside.png",
        "agent-theoretical-scientist-sit-outside.png",
    ),
}


def extract_block(im: Image.Image, start_row: int, rows: int, cols: int, dest: Path) -> None:
    crop = im.crop((0, start_row * CELL, cols * CELL, (start_row + rows) * CELL))
    out = crop.resize((cols * OUT_CELL, rows * OUT_CELL), Image.NEAREST)
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest)
    print(f"Wrote {dest} ({out.size[0]}x{out.size[1]})")


def main() -> None:
    for source_name, (walk_name, sit_name) in OUTFITS.items():
        source_path = LAB_SKETCH / source_name
        if not source_path.exists():
            print(f"Skipping {source_name} - not exported yet")
            continue
        im = Image.open(source_path)
        extract_block(im, WALK_START_ROW, WALK_ROWS, WALK_COLS, SPRITES_OUT / walk_name)
        extract_block(im, SIT_START_ROW, SIT_ROWS, SIT_COLS, SPRITES_OUT / sit_name)


if __name__ == "__main__":
    main()
