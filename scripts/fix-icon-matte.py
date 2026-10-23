#!/usr/bin/env python3
"""Remove the white alpha-matte (halo) from the icon's transparent edges.

The original icons were exported with a white background. Where the dark
rounded-rectangle border is anti-aliased against transparency, the edge
pixels carry white RGB values (255,255,255) with low alpha. When Windows
composites these onto the taskbar / window title, the faint white RGB
bleeds through as a visible white border around the icon.

This script replaces the RGB of every semi-transparent pixel with the RGB
of the nearest fully-opaque pixel, eliminating the white matte while
preserving the alpha channel (so anti-aliasing quality is unchanged).

Run:  python scripts/fix-icon-matte.py
"""
from pathlib import Path
import numpy as np
from PIL import Image


def fix_matte(path: Path) -> None:
    img = Image.open(path).convert("RGBA")
    arr = np.array(img, dtype=np.uint8)
    a = arr[:, :, 3]

    semi = (a > 0) & (a < 255)
    if not semi.any():
        print(f"  {path}: no semi-transparent pixels, skipping")
        return

    # Build a mask of fully-opaque pixels and their RGB.
    opaque = a == 255
    opaque_rgb = arr[:, :, :3][opaque]  # (N, 3)

    # Representative opaque border color = the most common dark-ish color
    # near the edges. We use the median RGB of opaque pixels, which for these
    # icons is the dark border tone (~#4C4D4F).
    border_rgb = np.median(opaque_rgb, axis=0).astype(np.uint8)

    # Replace RGB (not alpha) of every semi-transparent pixel with the border
    # color. This kills the white halo while keeping the smooth alpha edge.
    arr[semi, 0] = border_rgb[0]
    arr[semi, 1] = border_rgb[1]
    arr[semi, 2] = border_rgb[2]

    # Also clear the RGB of fully-transparent pixels. PIL's downscaler treats
    # alpha=0 pixels as "don't care" and can bleed their (white) RGB into the
    # resampled edge of smaller sizes, re-introducing a faint matte. Setting
    # them to the border color makes downsampling safe.
    transparent = a == 0
    arr[transparent, 0] = border_rgb[0]
    arr[transparent, 1] = border_rgb[1]
    arr[transparent, 2] = border_rgb[2]

    out = Image.fromarray(arr, mode="RGBA")
    out.save(path)
    print(
        f"  {path}: fixed {int(semi.sum())} edge pixels -> "
        f"border RGB {tuple(int(v) for v in border_rgb)}"
    )


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    targets = [
        root / "build" / "icon.png",
        root / "public" / "logo.png",
    ]
    for p in targets:
        if p.exists():
            fix_matte(p)
        else:
            print(f"  {p}: not found, skipping")


if __name__ == "__main__":
    main()