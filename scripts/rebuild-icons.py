#!/usr/bin/env python3
"""Rebuild build/icon.ico, build/icon.icns and public/favicon.ico from
build/icon.png (which has had its white matte removed).

PIL writes every ICO sub-image as a PNG, which preserves the 32-bit alpha
channel — no white matte is re-introduced.
"""
import io
import shutil
import struct
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PNG = ROOT / "build" / "icon.png"
ICO = ROOT / "build" / "icon.ico"
ICNS = ROOT / "build" / "icon.icns"
FAVICO = ROOT / "public" / "favicon.ico"

ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

# Dark border tone of these icons — used to replace any residual white RGB in
# semi-transparent / transparent edge pixels after downscaling.
BORDER_RGB = (46, 48, 52)


def strip_matte(img: Image.Image) -> Image.Image:
    """Replace RGB of every non-fully-opaque pixel with the border color so
    that PIL's downscaling cannot re-introduce a white halo."""
    arr = np.array(img.convert("RGBA"), dtype=np.uint8)
    a = arr[:, :, 3]
    nonopaque = a < 255
    arr[nonopaque, 0] = BORDER_RGB[0]
    arr[nonopaque, 1] = BORDER_RGB[1]
    arr[nonopaque, 2] = BORDER_RGB[2]
    return Image.fromarray(arr, mode="RGBA")


def main() -> None:
    img = Image.open(PNG).convert("RGBA")

    # Build each sub-image by downscaling the master PNG, then strip any
    # residual white matte introduced by resampling. Each sub-image is stored
    # as PNG so the 32-bit alpha channel is preserved.
    png_blobs = []
    for (w, h) in ICO_SIZES:
        sub = img.resize((w, h), Image.LANCZOS)
        sub = strip_matte(sub)
        buf = io.BytesIO()
        sub.save(buf, format="PNG")
        png_blobs.append(buf.getvalue())

    # Hand-assemble the ICO container (ICONDIR + ICONDIRENTRY[] + PNG data).
    count = len(ICO_SIZES)
    header = struct.pack("<HHH", 0, 1, count)
    entries = []
    offset = 6 + count * 16
    for (w, h), blob in zip(ICO_SIZES, png_blobs):
        wbyte = 0 if w == 256 else w
        hbyte = 0 if h == 256 else h
        entries.append(
            struct.pack(
                "<BBBBHHII",
                wbyte, hbyte, 0, 0, 1, 32, len(blob), offset,
            )
        )
        offset += len(blob)
    ICO.write_bytes(header + b"".join(entries) + b"".join(png_blobs))
    print(f"  wrote {ICO} ({count} PNG sub-images)")

    # Rebuild the .icns (macOS)
    img.save(ICNS, format="ICNS")
    print(f"  wrote {ICNS}")

    # Copy the fixed .ico to public/favicon.ico (used by the BrowserWindow)
    shutil.copy2(ICO, FAVICO)
    print(f"  copied -> {FAVICO}")


if __name__ == "__main__":
    main()