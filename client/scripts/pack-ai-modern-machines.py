#!/usr/bin/env python3
"""Extracts individual icons from lab_sketch/ai_generated_source/modern_machines.png (an
AI-generated reference sheet - solid black background, irregular sizes/spacing, NOT a
uniform grid like the LPC packs) into a single packed 16x16-grid sheet.

Unlike the LPC packers, this one has to *find* each icon first: connected-component
detection on a "not near-black" mask, with a small dilation pass to merge an icon's own
disconnected parts (e.g. a dark screen bezel touching the black background) without
merging adjacent icons together. The same brightness mask becomes each icon's alpha
channel, since the source has no transparency of its own.

Re-run after replacing/updating the source image. If the detected item count looks
wrong, check ITEM_NAMES still matches reading order (row by row, left to right) as
printed - the script fails loudly if the counts don't match.
"""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE = REPO_ROOT / "lab_sketch" / "ai_generated_source" / "modern_machines.png"
OUT_PATH = REPO_ROOT / "client" / "public" / "assets" / "tilesets" / "modern_machines_16px" / "modern_machines_packed.png"

TILE = 16
SHEET_WIDTH_TILES = 20
PADDING_TILES = 1
BRIGHTNESS_THRESHOLD = 18  # anything darker than this counts as background
DILATE_ITERATIONS = 6  # merges an icon's own gaps without merging neighboring icons
MIN_COMPONENT_PIXELS = 100
SCALE = 1 / 6  # ~190px machines -> ~32px (2 tiles); half of each dimension vs. the first pass

# Per-item tweaks applied after the normal auto-sizing above: pads the item's own canvas
# to `extra_height_tiles` taller and shifts the artwork down by `y_offset_px` within it
# (the rest stays transparent). Used to give an item more empty space below/above itself
# for stamping purposes without changing how large the artwork itself renders.
OVERRIDES = {
    "printer_3d_resin": {"extra_height_tiles": 1, "y_offset_px": 8},
}

# Reading order: row by row (top to bottom), left to right within each row.
ITEM_NAMES = [
    "cnc_mill", "cnc_lathe", "cnc_machine", "cnc_router", "printer_3d_fdm", "printer_3d_resin",
    "laser_cutter", "scanner_3d", "sandblast_cabinet", "drill_press", "band_saw", "bench_grinder",
    "workbench_vise", "pegboard_tools", "tool_chest", "shelf_bins", "storage_cabinet", "parts_bin_wall",
    "air_compressor", "shop_vacuum", "fume_extractor", "welder", "gas_cylinders", "sink", "eyewash_station",
    "tool_pickaxe", "tool_calipers", "tool_hammer", "tool_screwdriver", "tool_wrench", "tool_allen_key",
    "tool_pliers_red", "tool_pliers_blue", "tool_drill_bit_small", "tool_drill_bit_large",
    "mat_metal_block", "mat_aluminum_extrusion", "mat_sheet_metal", "mat_wood_light", "mat_wood_dark",
    "mat_white_block", "filament_white", "filament_orange", "filament_black", "filament_blue",
    "monitor", "laptop", "blueprint", "clipboard", "whiteboard", "fire_extinguisher", "first_aid_kit",
    "sign_laser_warning", "sign_safety_glasses", "sign_hazard_stripe",
]


def detect_boxes(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    dilated = ndimage.binary_dilation(mask, iterations=DILATE_ITERATIONS)
    labeled, num = ndimage.label(dilated, structure=np.ones((3, 3)))

    boxes = []
    pad = 3
    for i in range(1, num + 1):
        region_mask = (labeled == i) & mask
        ys, xs = np.where(region_mask)
        if len(xs) < MIN_COMPONENT_PIXELS:
            continue
        x0 = max(int(xs.min()) - pad, 0)
        x1 = min(int(xs.max()) + pad, mask.shape[1] - 1)
        y0 = max(int(ys.min()) - pad, 0)
        y1 = min(int(ys.max()) + pad, mask.shape[0] - 1)
        boxes.append((x0, y0, x1, y1))

    # Reading order: cluster into rows by y0 proximity, then sort each row by x0.
    boxes.sort(key=lambda b: b[1])
    rows: list[list[tuple[int, int, int, int]]] = [[boxes[0]]]
    for b in boxes[1:]:
        if b[1] - rows[-1][-1][1] < 40:
            rows[-1].append(b)
        else:
            rows.append([b])
    for row in rows:
        row.sort(key=lambda b: b[0])
    return [b for row in rows for b in row]


def round_up_16(n: int) -> int:
    return max(16, round(n / TILE) * TILE)


def shelf_pack(images: dict[str, Image.Image]) -> tuple[list[tuple[str, int, int]], int, int]:
    sheet_w = SHEET_WIDTH_TILES * TILE
    x = 0
    y = 0
    row_h = 0
    placements = []
    for name, im in sorted(images.items(), key=lambda kv: -kv[1].height):
        w, h = im.size
        if x + w > sheet_w:
            x = 0
            y += row_h + PADDING_TILES * TILE
            row_h = 0
        placements.append((name, x, y))
        x += w + PADDING_TILES * TILE
        row_h = max(row_h, h)
    return placements, sheet_w, y + row_h


def main() -> None:
    im = Image.open(SOURCE).convert("RGB")
    arr = np.array(im)
    mask = arr.max(axis=2) > BRIGHTNESS_THRESHOLD

    boxes = detect_boxes(mask)
    if len(boxes) != len(ITEM_NAMES):
        raise SystemExit(
            f"Detected {len(boxes)} icons but ITEM_NAMES has {len(ITEM_NAMES)} - "
            "update the name list to match (print box crops to check reading order)."
        )

    alpha_full = (mask * 255).astype(np.uint8)
    rgba_full = np.dstack([arr, alpha_full])
    full_im = Image.fromarray(rgba_full, "RGBA")

    item_images: dict[str, Image.Image] = {}
    for name, (x0, y0, x1, y1) in zip(ITEM_NAMES, boxes):
        w, h = x1 - x0 + 1, y1 - y0 + 1
        target_w = round_up_16(int(w * SCALE))
        target_h = round_up_16(int(h * SCALE))
        resized = full_im.crop((x0, y0, x1 + 1, y1 + 1)).resize((target_w, target_h), Image.LANCZOS)

        override = OVERRIDES.get(name)
        if override:
            canvas_h = target_h + override["extra_height_tiles"] * TILE
            canvas = Image.new("RGBA", (target_w, canvas_h), (0, 0, 0, 0))
            canvas.paste(resized, (0, override["y_offset_px"]), resized)
            resized = canvas

        item_images[name] = resized

    placements, sheet_w, sheet_h = shelf_pack(item_images)

    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    layout_lines = []
    for name, x, y in placements:
        im_item = item_images[name]
        sheet.paste(im_item, (x, y), im_item)
        layout_lines.append(
            f"  {name}: tile ({x // TILE}, {y // TILE}), size {im_item.width // TILE}x{im_item.height // TILE} tiles"
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_PATH)
    print(f"Wrote {OUT_PATH} ({sheet_w}x{sheet_h}, {sheet_w // TILE}x{sheet_h // TILE} tiles)")
    print("Layout:")
    print("\n".join(layout_lines))


if __name__ == "__main__":
    main()
