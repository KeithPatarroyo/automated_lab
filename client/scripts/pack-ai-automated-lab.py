#!/usr/bin/env python3
"""Extracts individual icons from lab_sketch/ai_generated_source/automated_lab.png (an
AI-generated reference sheet - solid black background, irregular sizes/spacing, NOT a
uniform grid like the LPC packs) into a single packed 16x16-grid sheet.

Same pipeline as pack-ai-modern-machines.py: connected-component detection on a "not
near-black" mask, with a dilation pass to merge an icon's own disconnected parts (e.g. a
dark screen bezel touching the black background) without merging adjacent icons. The
same brightness mask becomes each icon's alpha channel, since the source has no
transparency of its own.

Note DILATE_ITERATIONS is lower here (4, vs. 6 for modern_machines) - at 6 the three
GHS hazard diamonds near the bottom-right (flammable/health/corrosive) sit close enough
together that dilation bridges them into a single blob; 4 still merges every machine's
own internal gaps correctly (verified by comparing box counts/labels at several dilation
values) while keeping those three diamonds as separate components.

Re-run after replacing/updating the source image. If the detected item count looks
wrong, check ITEM_NAMES still matches reading order (row by row, left to right) as
printed - the script fails loudly if the counts don't match.
"""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE = REPO_ROOT / "lab_sketch" / "ai_generated_source" / "automated_lab.png"
OUT_PATH = REPO_ROOT / "client" / "public" / "assets" / "tilesets" / "automated_lab_16px" / "automated_lab_packed.png"

TILE = 16
SHEET_WIDTH_TILES = 20
PADDING_TILES = 1
BRIGHTNESS_THRESHOLD = 18  # anything darker than this counts as background
DILATE_ITERATIONS = 4  # merges an icon's own gaps without merging neighboring icons
MIN_COMPONENT_PIXELS = 100
SCALE = 1 / 6  # matches modern_machines_packed.png's current on-screen scale

OVERRIDES: dict[str, dict[str, int]] = {}

# Reading order: row by row (top to bottom), left to right within each row.
ITEM_NAMES = [
    "liquid_handler_robot", "liquid_handler_compact", "hydraulic_press", "glovebox",
    "fume_hood", "biosafety_cabinet",
    "rotovap", "distillation_column", "gas_manifold", "solvent_delivery_system", "hplc",
    "mass_spectrometer", "ultra_low_freezer",
    "cryo_dewar", "cabinet_with_pc_terminal", "gc_autosampler", "lab_analyzer_module",
    "spectra_workstation", "analytical_balance", "centrifuge",
    "incubator_oven", "vacuum_pump", "chiller", "stir_plate_with_flask", "muffle_furnace",
    "hot_plate", "magnetic_stirrer", "dry_bath_heating_block",
    "flask_erlenmeyer", "flask_round_bottom", "flask_volumetric", "beaker",
    "graduated_cylinder_tall", "graduated_cylinder_short", "vial_small_clear",
    "bottle_amber", "bottle_blue_cap", "microplate_96well", "pipette_tip_a",
    "pipette_tip_b", "pipette_tip_c", "pipette_tip_d", "pipette_tip_e",
    "pipette_tip_box", "centrifuge_tube",
    "syringe", "multichannel_pipette", "spatula", "tweezers", "syringe_needle",
    "tubing_coil", "valve_fitting", "pipe_cross_fitting", "pressure_regulator",
    "inline_filter_valve", "filter_cartridge", "valve_manifold",
    "monitor_spectrum", "laptop_molecule", "notebook_molecule", "control_panel",
    "icon_check", "icon_cold_storage", "icon_fragile", "icon_nitrogen", "icon_ventilation",
    "hazard_flammable", "hazard_health", "hazard_corrosive", "hazard_electrical",
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
