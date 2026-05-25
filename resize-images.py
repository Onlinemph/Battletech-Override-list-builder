"""
resize-images.py — Resize mech images for web use and copy into images/

Usage:
    python resize-images.py <path-to-your-image-folder>

Reads images from the source folder (subfolders = categories), resizes
each to at most 500x500px, and writes them to images/<Category>/<name>.png
in the current directory. Preserves transparency.

Requires Pillow:
    pip install pillow
"""

import os
import sys
from pathlib import Path
from PIL import Image

MAX_SIZE  = 500
VALID_EXT = {'.png', '.jpg', '.jpeg', '.webp'}
OUT_DIR   = Path('images')

def main():
    if len(sys.argv) < 2:
        print("Usage: python resize-images.py <path-to-your-image-folder>")
        sys.exit(1)

    src_root = Path(sys.argv[1]).resolve()
    if not src_root.is_dir():
        print(f"Not a directory: {src_root}")
        sys.exit(1)

    # Collect all image files
    image_files = [
        p for p in src_root.rglob('*')
        if p.is_file() and p.suffix.lower() in VALID_EXT
    ]

    total = len(image_files)
    print(f"Found {total} images in {src_root}")
    print(f"Resizing to max {MAX_SIZE}px and writing to {OUT_DIR.resolve()}/\n")

    done = 0
    skipped = 0
    errors = 0

    for src_path in image_files:
        # Derive category from the immediate subfolder under src_root
        rel = src_path.relative_to(src_root)
        parts = rel.parts
        if len(parts) == 1:
            category = 'Uncategorized'
        else:
            category = parts[0]

        dst_path = OUT_DIR / category / (src_path.stem + '.png')

        # Skip if already done (allows resuming interrupted runs)
        if dst_path.exists():
            skipped += 1
            done += 1
            if done % 500 == 0:
                print(f"  {done}/{total}...")
            continue

        try:
            dst_path.parent.mkdir(parents=True, exist_ok=True)
            with Image.open(src_path) as img:
                img = img.convert('RGBA') if img.mode in ('RGBA', 'LA', 'P') else img.convert('RGB')
                img.thumbnail((MAX_SIZE, MAX_SIZE), Image.LANCZOS)
                if img.mode == 'RGBA':
                    img.save(dst_path, 'PNG', optimize=True)
                else:
                    # Save RGB as PNG without transparency
                    img.save(dst_path, 'PNG', optimize=True)
            done += 1
        except Exception as e:
            print(f"  ERROR {src_path.name}: {e}")
            errors += 1
            done += 1

        if done % 500 == 0:
            print(f"  {done}/{total}...")

    print(f"\nDone! {done - errors - skipped} resized, {skipped} already existed, {errors} errors.")

    # Report output size
    total_bytes = sum(f.stat().st_size for f in OUT_DIR.rglob('*') if f.is_file())
    print(f"Output size: {total_bytes / 1_000_000:.1f} MB in {OUT_DIR.resolve()}/")
    print("\nNext step: run  python generate-manifest.py  to update manifest.json")

if __name__ == '__main__':
    main()
