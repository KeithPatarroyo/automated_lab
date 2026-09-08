#!/usr/bin/env python3
"""Extracts a single static portrait frame from a full LPC-format character
spritesheet (lab_sketch/*.png - 832x3456px, 64x64 cells, 13 cols x 54 rows, standard
"Revised Universal Animation Template" layout) for use as a static NPC sprite, unlike
extract-player-sprite.py which pulls the full walk/sit animation blocks for the
player character. Downscaled 2x to match the player sprite's on-screen scale (32x32).

Frame chosen: walk-cycle row "down", column 0 - a neutral standing/mid-stride pose
facing the viewer, same row/column extract-player-sprite.py treats as representative.
"""
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
LAB_SKETCH = REPO_ROOT / "lab_sketch"
SPRITES_OUT = REPO_ROOT / "client" / "public" / "assets" / "sprites"

CELL = 64
WALK_START_ROW = 8  # LPC template: rows 8-11 = walk cycle, up/left/down/right
DOWN_ROW_OFFSET = 2  # up/left/down/right -> down is the 3rd row in the block
OUT_CELL = 32  # 2x downscale, matches player sprite scale

# source filename (in lab_sketch/) -> output filename (in client/public/assets/sprites/)
NPC_PORTRAITS = {
    "character-spritesheet_workshop_woman.png": "workshop-woman.png",
}


def extract_frame(im: Image.Image, row: int, col: int, dest: Path) -> None:
    box = (col * CELL, row * CELL, (col + 1) * CELL, (row + 1) * CELL)
    crop = im.crop(box)
    out = crop.resize((OUT_CELL, OUT_CELL), Image.NEAREST)
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest)
    print(f"Wrote {dest} ({out.size[0]}x{out.size[1]})")


def main() -> None:
    for source_name, out_name in NPC_PORTRAITS.items():
        im = Image.open(LAB_SKETCH / source_name)
        extract_frame(im, WALK_START_ROW + DOWN_ROW_OFFSET, 0, SPRITES_OUT / out_name)


if __name__ == "__main__":
    main()
