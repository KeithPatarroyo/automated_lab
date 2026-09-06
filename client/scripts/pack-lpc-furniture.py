#!/usr/bin/env python3
"""Downscales the individually-named LPC "Furniture" PNGs (32x32 grid, OGA-BY 3.0 -
see lab_sketch/lpc_furniture_source/**/Credits.txt for per-item artist credit: mainly
Lanea Zimmerman, Eliza Wyatt, and BlueCarrot16) 2x to match our 16x16 grid, then packs
them all (including the Beds/Rugs/Seating/Sewing & Weaving/Smithing subfolders) into a
single sheet so Tiled only needs one "New Tileset" entry. Re-run after adding/removing
source files.
"""
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = REPO_ROOT / "lab_sketch" / "lpc_furniture_source"
OUT_PATH = REPO_ROOT / "client" / "public" / "assets" / "tilesets" / "lpc_furniture_16px" / "lpc_furniture_packed.png"

TILE = 16  # our project's grid, after downscaling from the source's 32x32
SHEET_WIDTH_TILES = 20
PADDING_TILES = 1  # gap between packed items so adjacent props don't visually blend

EXCLUDE_NAMES = {"Credits.txt"}


def shelf_pack(sizes: list[tuple[Path, int, int]]) -> tuple[list[tuple[Path, int, int]], int, int]:
    sheet_w = SHEET_WIDTH_TILES * TILE
    x = 0
    y = 0
    row_h = 0
    placements = []
    for path, w, h in sorted(sizes, key=lambda s: -s[2]):  # tallest first, a bit denser
        if x + w > sheet_w:
            x = 0
            y += row_h + PADDING_TILES * TILE
            row_h = 0
        placements.append((path, x, y))
        x += w + PADDING_TILES * TILE
        row_h = max(row_h, h)
    sheet_h = y + row_h
    return placements, sheet_w, sheet_h


def main() -> None:
    sources = []
    for f in sorted(SOURCE_DIR.rglob("*.png")):
        if f.name in EXCLUDE_NAMES:
            continue
        im = Image.open(f)
        sources.append((f, im.width // 2, im.height // 2))

    placements, sheet_w, sheet_h = shelf_pack(sources)
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))

    layout_lines = []
    for path, x, y in placements:
        im = Image.open(path).convert("RGBA")
        resized = im.resize((im.width // 2, im.height // 2), Image.NEAREST)
        sheet.paste(resized, (x, y), resized)
        rel = path.relative_to(SOURCE_DIR)
        layout_lines.append(f"  {rel}: tile ({x // TILE}, {y // TILE}), size {resized.width // TILE}x{resized.height // TILE} tiles")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_PATH)
    print(f"Wrote {OUT_PATH} ({sheet_w}x{sheet_h}, {sheet_w // TILE}x{sheet_h // TILE} tiles)")
    print("Layout:")
    print("\n".join(layout_lines))


if __name__ == "__main__":
    main()
