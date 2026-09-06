"""Shared packer for LPC-format asset folders (32x32 grid, various OGA-BY 3.0 credits -
see each source folder's Credits.txt). Downscales everything 2x to our 16x16 grid and
shelf-packs it into one sheet, so Tiled only needs one "New Tileset" entry per folder
instead of one per file. Used by the pack-lpc-*.py scripts - re-run the relevant one
after adding/removing files in its source folder.
"""
from pathlib import Path
from PIL import Image

TILE = 16  # our project's grid, after downscaling from the source's 32x32
PADDING_TILES = 1  # gap between packed items so adjacent props don't visually blend

EXCLUDE_NAMES = {"Credits.txt"}


def shelf_pack(sizes: list[tuple[Path, int, int]], sheet_width_tiles: int) -> tuple[list[tuple[Path, int, int]], int, int]:
    sheet_w = sheet_width_tiles * TILE
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


def pack_folder(source_dir: Path, out_path: Path, sheet_width_tiles: int = 20) -> None:
    sources = []
    for f in sorted(source_dir.rglob("*.png")):
        if f.name in EXCLUDE_NAMES:
            continue
        im = Image.open(f)
        sources.append((f, im.width // 2, im.height // 2))

    placements, sheet_w, sheet_h = shelf_pack(sources, sheet_width_tiles)
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))

    layout_lines = []
    for path, x, y in placements:
        im = Image.open(path).convert("RGBA")
        resized = im.resize((im.width // 2, im.height // 2), Image.NEAREST)
        sheet.paste(resized, (x, y), resized)
        rel = path.relative_to(source_dir)
        layout_lines.append(f"  {rel}: tile ({x // TILE}, {y // TILE}), size {resized.width // TILE}x{resized.height // TILE} tiles")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)
    print(f"Wrote {out_path} ({sheet_w}x{sheet_h}, {sheet_w // TILE}x{sheet_h // TILE} tiles)")
    print("Layout:")
    print("\n".join(layout_lines))
