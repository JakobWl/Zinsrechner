#!/usr/bin/env python3
"""Verify that no favicon.ico / icon.ico sub-image still contains the white
alpha-matte on its transparent edges."""
import io
import struct
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
ICOS = [ROOT / "build" / "icon.ico", ROOT / "public" / "favicon.ico"]

for ico in ICOS:
    data = ico.read_bytes()
    count = struct.unpack("<H", data[4:6])[0]
    print(f"{ico.name}: {count} sub-images")
    for i in range(count):
        base = 6 + i * 16
        w = data[base]
        w = 256 if w == 0 else w
        off = struct.unpack("<I", data[base + 12 : base + 16])[0]
        size = struct.unpack("<I", data[base + 8 : base + 12])[0]
        png = data[off : off + size]
        img = Image.open(io.BytesIO(png)).convert("RGBA")
        arr = np.array(img)
        a = arr[:, :, 3]
        semi = (a > 0) & (a < 255)
        rgb = arr[:, :, :3]
        white = (rgb[:, :, 0] > 200) & (rgb[:, :, 1] > 200) & (rgb[:, :, 2] > 200)
        n = int((semi & white).sum())
        status = "OK" if n == 0 else "WHITE MATTE!"
        print(f"  {w}x{w}: semi-transparent white pixels = {n}  [{status}]")