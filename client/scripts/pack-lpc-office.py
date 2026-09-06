#!/usr/bin/env python3
"""Downscales the individually-named LPC "The Office" PNGs (32x32 grid, OGA-BY 3.0,
credit Eliza Wyatt / Lanea Zimmerman - see lab_sketch/lpc_the_office_source/Credits.txt)
2x to match our 16x16 grid, then packs them into a single sheet so Tiled only needs one
"New Tileset" entry instead of fifteen. Re-run after adding/removing source files.

NOTE: this pack's layout is already live in the map (laptop tiles placed by hand in
Tiled reference specific tile positions in the packed sheet) - don't change
SHEET_WIDTH_TILES, the exclude list, or switch this to the shared lpc_pack_common
packer without re-checking every placed tile, or existing placements will silently
point at different art.
"""
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = REPO_ROOT / "lab_sketch" / "lpc_the_office_source"
OUT_PATH = REPO_ROOT / "client" / "public" / "assets" / "tilesets" / "lpc_office_16px" / "lpc_office_packed.png"

TILE = 16  # our project's grid, after downscaling from the source's 32x32
SHEET_WIDTH_TILES = 14
PADDING_TILES = 1  # gap between packed items so adjacent props don't visually blend

EXCLUDE = {"_ Liberated Palette Ramps.png"}


def shelf_pack(sizes: list[tuple[str, int, int]]) -> tuple[list[tuple[str, int, int]], int, int]:
    """Simple shelf/row bin-packing in tile units. Returns placements plus sheet size."""
    sheet_w = SHEET_WIDTH_TILES * TILE
    x = 0
    y = 0
    row_h = 0
    placements = []
    for name, w, h in sorted(sizes, key=lambda s: -s[2]):  # tallest first, a bit denser
        if x + w > sheet_w:
            x = 0
            y += row_h + PADDING_TILES * TILE
            row_h = 0
        placements.append((name, x, y))
        x += w + PADDING_TILES * TILE
        row_h = max(row_h, h)
    sheet_h = y + row_h
    return placements, sheet_w, sheet_h


def main() -> None:
    sources = []
    for f in sorted(SOURCE_DIR.glob("*.png")):
        if f.name in EXCLUDE:
            continue
        im = Image.open(f)
        w, h = im.width // 2, im.height // 2
        sources.append((f.name, w, h))

    placements, sheet_w, sheet_h = shelf_pack(sources)
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))

    layout_lines = []
    for name, x, y in placements:
        im = Image.open(SOURCE_DIR / name).convert("RGBA")
        resized = im.resize((im.width // 2, im.height // 2), Image.NEAREST)
        sheet.paste(resized, (x, y), resized)
        layout_lines.append(f"  {name}: tile ({x // TILE}, {y // TILE}), size {resized.width // TILE}x{resized.height // TILE} tiles")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_PATH)
    print(f"Wrote {OUT_PATH} ({sheet_w}x{sheet_h}, {sheet_w // TILE}x{sheet_h // TILE} tiles)")
    print("Layout:")
    print("\n".join(layout_lines))


if __name__ == "__main__":
    main()
