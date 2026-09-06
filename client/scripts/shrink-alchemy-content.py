#!/usr/bin/env python3
"""Shrinks the artwork *inside* every cell of the alchemy tileset (32 cols x 128 rows,
16x16px cells) to a given fraction of its size, WITHOUT moving it - each tile's actual
non-transparent content is cropped to its own tight bounding box first, shrunk, and
pasted back centered on that same bounding box's original center point.

This matters because alchemy.png is a genuine tileset of modular pieces (pipes,
connectors) whose art is deliberately positioned at specific edges/corners of each
16x16 cell so adjacent tiles line up when placed next to each other. An earlier version
of this script naively shrank and re-centered the *whole* 16x16 cell, which moved every
tile's content to dead-center regardless of where it originally sat - breaking any tile
that relied on touching a particular edge. Shrinking around each tile's own bbox center
instead preserves that alignment as closely as possible.

Keeps the sheet's overall size, cell grid, and every tile's GID/position completely
unchanged (safe to rerun even if the tileset is already placed in a live map).

Always reads from the pristine, never-shrunk copy in lab_sketch/ and writes the result
to the deployed tileset - so re-running with a different SHRINK_FACTOR always starts
fresh from full size instead of compounding shrinkage on top of a previous run.
"""
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE = REPO_ROOT / "lab_sketch" / "lpc_alchemy_source" / "alchemy.png"
TARGET = REPO_ROOT / "client" / "public" / "assets" / "tilesets" / "lpc_alchemy_16px" / "alchemy.png"

CELL = 16
SHRINK_FACTOR = 0.5  # each dimension halved -> ~25% of the current on-screen area


def main() -> None:
    im = Image.open(SOURCE).convert("RGBA")
    cols, rows = im.width // CELL, im.height // CELL
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))

    for row in range(rows):
        for col in range(cols):
            ox, oy = col * CELL, row * CELL
            cell = im.crop((ox, oy, ox + CELL, oy + CELL))
            bbox = cell.getbbox()
            if not bbox:  # fully transparent cell, nothing to do
                continue

            content = cell.crop(bbox)
            cw, ch = content.size
            new_w = max(1, round(cw * SHRINK_FACTOR))
            new_h = max(1, round(ch * SHRINK_FACTOR))
            shrunk = content.resize((new_w, new_h), Image.LANCZOS)

            # Keep the shrunk content centered on the same point its own bounding
            # box was centered on, so it stays roughly where it was (e.g. touching
            # the same edge/corner) instead of jumping to the cell's center.
            center_x = (bbox[0] + bbox[2]) / 2
            center_y = (bbox[1] + bbox[3]) / 2
            paste_x = round(center_x - new_w / 2)
            paste_y = round(center_y - new_h / 2)
            out.paste(shrunk, (ox + paste_x, oy + paste_y), shrunk)

    out.save(TARGET)
    print(f"Shrunk each tile's content (in place) to {int(SHRINK_FACTOR * 100)}% and saved over {TARGET}")


if __name__ == "__main__":
    main()
