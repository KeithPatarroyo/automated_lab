#!/usr/bin/env python3
"""Extracts individual icons from lab_sketch/ai_generated_source/glassware.png (an
AI-generated reference sheet - solid black background, dense grid-ish rows of glassware/
labware, NOT a uniform grid like the LPC packs) into a single packed 16x16-grid sheet.

Same pipeline as pack-ai-modern-machines.py / pack-ai-automated-lab.py: connected-
component detection on a "not near-black" mask, dilated slightly to merge each icon's
own disconnected parts without merging neighboring icons. The same brightness mask
becomes each icon's alpha channel, since the source has no transparency of its own.

This sheet has ~300 items, many of them near-identical variants (a row of the same
flask in a dozen liquid colors, a row of the same cap in a dozen colors, etc.), so unlike
the other two AI packs, items aren't given fully bespoke names - CATEGORIES assigns each
detected box (in reading order) a category label, and ITEM_NAMES is derived by
numbering repeats within each category (flask_erlenmeyer_01, _02, ...). This keeps
names meaningful without requiring one bespoke identification per near-duplicate.

Re-run after replacing/updating the source image. If the detected box count no longer
matches len(CATEGORIES), the script fails loudly - re-derive CATEGORIES against the
printed row/box order (see client/scripts/_detect_glassware_boxes.py for how this was
originally worked out, row by row).
"""
from pathlib import Path
from collections import defaultdict
import numpy as np
from PIL import Image
from scipy import ndimage

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE = REPO_ROOT / "lab_sketch" / "ai_generated_source" / "glassware.png"
OUT_PATH = REPO_ROOT / "client" / "public" / "assets" / "tilesets" / "glassware_16px" / "glassware_packed.png"

TILE = 16
SHEET_WIDTH_TILES = 24
PADDING_TILES = 1
BRIGHTNESS_THRESHOLD = 18  # anything darker than this counts as background
DILATE_ITERATIONS = 2  # lower than the other AI packs - items here sit closer together
MIN_COMPONENT_PIXELS = 30  # some items (pins, rings) are much smaller than the other sheets
SCALE = 1 / 3  # keeps most small glassware at 1 tile, larger flasks at 2-3 tiles tall

# Applied on top of SCALE, within each item's already-tile-aligned canvas: since most
# items are floored to a 1-tile canvas by round_up_16 below, shrinking SCALE further
# wouldn't actually make them look smaller (the content is resized to fill whatever
# canvas it's given). This shrinks the rendered artwork itself and centers it in the
# same canvas, so items look smaller without changing any tile footprint/GID layout.
CONTENT_SCALE = 0.5

OVERRIDES: dict[str, dict[str, int]] = {}

# One category per detected box, in reading order (row by row, top to bottom, left to
# right within a row). Repeats within a category get numbered in ITEM_NAMES below.
CATEGORIES = [
    "flask_round_bottom", "flask_round_bottom",
    "flask_erlenmeyer", "flask_erlenmeyer", "flask_erlenmeyer", "flask_erlenmeyer",
    "flask_erlenmeyer", "flask_erlenmeyer", "flask_erlenmeyer", "flask_erlenmeyer", "flask_erlenmeyer",
    "bottle_reagent", "bottle_reagent", "bottle_reagent", "bottle_reagent",
    "bottle_reagent", "bottle_reagent", "bottle_reagent", "bottle_reagent",
    "vial_small", "vial_small", "vial_small",
    "graduated_cylinder", "graduated_cylinder", "graduated_cylinder",
    "graduated_cylinder", "graduated_cylinder", "graduated_cylinder",
    "beaker", "beaker", "beaker", "beaker", "beaker", "beaker",
    "bottle_reagent", "bottle_reagent", "bottle_reagent", "bottle_reagent",
    "bottle_reagent", "bottle_reagent", "bottle_reagent", "bottle_reagent",
    # test tubes (open, colored liquid, and capped variants)
    "test_tube", "test_tube", "test_tube", "test_tube", "test_tube", "test_tube",
    "test_tube", "test_tube", "test_tube", "test_tube", "test_tube", "test_tube",
    "test_tube", "test_tube", "test_tube", "test_tube", "test_tube", "test_tube",
    "test_tube", "test_tube", "test_tube", "test_tube", "test_tube", "test_tube",
    "test_tube", "test_tube", "test_tube", "test_tube", "test_tube", "test_tube",
    "test_tube", "test_tube", "test_tube", "test_tube", "test_tube", "test_tube",
    "test_tube", "test_tube",
    "funnel", "funnel", "funnel", "funnel", "funnel", "funnel", "funnel",
    "separatory_funnel", "separatory_funnel", "separatory_funnel", "separatory_funnel",
    "flask_round_bottom", "flask_erlenmeyer", "flask_round_bottom",
    "dropper", "dropper", "dropper", "dropper", "dropper",
    "burette",
    "condenser", "condenser", "condenser", "condenser",
    "dropping_funnel", "dropping_funnel",
    "flask_round_bottom", "flask_round_bottom", "flask_round_bottom", "flask_round_bottom",
    "flask_round_bottom", "flask_round_bottom", "flask_round_bottom", "flask_round_bottom",
    "flask_round_bottom", "flask_round_bottom", "flask_round_bottom", "flask_round_bottom",
    # ground-glass joints / stopcocks / adapters - too varied/small to name individually
    "glass_fitting", "glass_fitting", "glass_fitting", "glass_fitting", "glass_fitting",
    "glass_fitting", "glass_fitting", "glass_fitting", "glass_fitting", "glass_fitting",
    "glass_fitting", "glass_fitting", "glass_fitting", "glass_fitting", "glass_fitting",
    "glass_fitting", "glass_fitting", "glass_fitting", "glass_fitting", "glass_fitting",
    "glass_fitting", "glass_fitting", "glass_fitting",
    "petri_dish", "petri_dish",
    "crucible", "crucible",
    "mortar", "mortar",
    "crucible",
    "mortar",
    "mortar_pestle",
    "vial_small", "vial_small", "vial_small",
    "dropper", "dropper", "dropper",
    "vial_small",
    "pipette_tube", "pipette_tube", "pipette_tube", "pipette_tube", "pipette_tube", "pipette_tube",
    "gasket_ring",
    "vial_capped", "vial_capped", "vial_capped",
    "cap_stopper",
    "vial_capped",
    "flask_small",
    "vial_capped", "vial_capped",
    "cap_stopper",
    "vial_capped",
    "cap_stopper",
    "vial_capped", "vial_capped", "vial_capped", "vial_capped", "vial_capped",
    "vial_capped", "vial_capped", "vial_capped", "vial_capped", "vial_capped",
    "vial_capped", "vial_capped", "vial_capped", "vial_capped", "vial_capped",
    "dropper", "vial_capped", "dropper", "vial_capped", "dropper", "vial_capped",
    "dropper", "vial_capped", "dropper", "vial_capped", "dropper",
    "vial_capped", "dropper", "dropper", "vial_capped",
    "cap_stopper",
    "vial_capped", "dropper", "vial_capped", "dropper", "vial_capped",
    "small_dish",
    "vial_capped", "vial_capped",
    "cap_stopper", "vial_capped", "cap_stopper", "vial_capped",
    "cap_stopper", "cap_stopper", "cap_stopper", "cap_stopper", "cap_stopper",
    "vial_capped",
    "cap_stopper", "cap_stopper", "cap_stopper", "cap_stopper", "cap_stopper",
    "hardware_clip",
    "hardware_bolt", "hardware_bolt", "hardware_bolt", "hardware_bolt", "hardware_bolt",
    "hardware_bolt", "hardware_bolt", "hardware_bolt", "hardware_bolt", "hardware_bolt",
    "hardware_bolt", "hardware_bolt", "hardware_bolt", "hardware_bolt",
    "hardware_fitting", "hardware_fitting", "hardware_fitting",
    "hardware_bolt", "hardware_bolt", "hardware_bolt", "hardware_bolt",
    "hardware_pin", "hardware_pin", "hardware_pin", "hardware_pin", "hardware_pin", "hardware_pin",
    "vial_capped",
    "hardware_pin", "hardware_pin",
    "lab_tool", "lab_tool",
    "stirring_rod",
    "lab_tool",
    "stirring_rod", "stirring_rod",
    "lab_tool",
    "stirring_rod",
    "lab_tool",
    "stirring_rod", "stirring_rod", "stirring_rod", "stirring_rod", "stirring_rod",
    "o_ring", "o_ring",
    "rubber_bulb",
    "tubing", "tubing", "tubing",
    "clamp_part", "clamp_part", "clamp_part", "clamp_part", "clamp_part",
    "clamp_part", "clamp_part", "clamp_part", "clamp_part", "clamp_part",
    "retort_clamp", "retort_clamp", "retort_clamp", "retort_clamp", "retort_clamp",
    "retort_clamp", "retort_clamp", "retort_clamp", "retort_clamp", "retort_clamp",
    "retort_clamp",
    "ring_stand", "ring_stand",
    "stand_rod",
    "ring_stand",
    "stand_rod",
    "ring_stand", "ring_stand",
    "stand_rod", "stand_rod",
    "clamp_part",
    "ring_fitting",
]


def build_item_names(categories: list[str]) -> list[str]:
    counts: dict[str, int] = defaultdict(int)
    totals: dict[str, int] = defaultdict(int)
    for c in categories:
        totals[c] += 1
    names = []
    for c in categories:
        if totals[c] == 1:
            names.append(c)
            continue
        counts[c] += 1
        names.append(f"{c}_{counts[c]:02d}")
    return names


def detect_boxes(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    dilated = ndimage.binary_dilation(mask, iterations=DILATE_ITERATIONS)
    labeled, num = ndimage.label(dilated, structure=np.ones((3, 3)))

    boxes = []
    pad = 2
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
    if len(boxes) != len(CATEGORIES):
        raise SystemExit(
            f"Detected {len(boxes)} icons but CATEGORIES has {len(CATEGORIES)} - "
            "update the category list to match (see _detect_glassware_boxes.py to re-derive)."
        )
    item_names = build_item_names(CATEGORIES)

    alpha_full = (mask * 255).astype(np.uint8)
    rgba_full = np.dstack([arr, alpha_full])
    full_im = Image.fromarray(rgba_full, "RGBA")

    item_images: dict[str, Image.Image] = {}
    for name, (x0, y0, x1, y1) in zip(item_names, boxes):
        w, h = x1 - x0 + 1, y1 - y0 + 1
        target_w = round_up_16(int(w * SCALE))
        target_h = round_up_16(int(h * SCALE))
        content_w = max(1, round(target_w * CONTENT_SCALE))
        content_h = max(1, round(target_h * CONTENT_SCALE))
        content = full_im.crop((x0, y0, x1 + 1, y1 + 1)).resize((content_w, content_h), Image.LANCZOS)
        resized = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
        resized.paste(content, ((target_w - content_w) // 2, (target_h - content_h) // 2), content)

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
