#!/usr/bin/env python3
"""Packs lab_sketch/lpc_small_items_source/ into
client/public/assets/tilesets/lpc_small_items_16px/. See lpc_pack_common.py for how,
and that source folder's Credits.txt for per-item license/credit (OGA-BY 3.0 - mainly
Eliza Wyatt, Lanea Zimmerman, BlueCarrot16, Richard Kettering)."""
from pathlib import Path
from lpc_pack_common import pack_folder

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = REPO_ROOT / "lab_sketch" / "lpc_small_items_source"
OUT_PATH = REPO_ROOT / "client" / "public" / "assets" / "tilesets" / "lpc_small_items_16px" / "lpc_small_items_packed.png"

if __name__ == "__main__":
    pack_folder(SOURCE_DIR, OUT_PATH, sheet_width_tiles=20)
