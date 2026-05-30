#!/usr/bin/env python3
"""
Parse MegaMek .mtf unit files and extract base BV values.

Usage:
    python parse-mtf.py <folder-of-mtf-files> [output.json]

The folder is searched recursively. Each .mtf file is expected to follow
the standard MegaMek format:

    Version:1.0
    Atlas          <- chassis name (line after Version)
    AS7-D          <- model/variant (line after chassis)
    ...
    BV:1897        <- pre-computed base BV

Output is a JSON object { "Atlas AS7-D": 1897, ... } ready to drop in as
the app's bv-data.json, or to load via the "Load BV table" button.
"""

import json
import os
import sys
from pathlib import Path


def parse_mtf(path: Path):
    """Return (unit_name, bv) for a single MTF file, or (None, None) on failure."""
    try:
        text = path.read_text(encoding='utf-8', errors='replace')
    except OSError:
        return None, None

    lines = [l.strip() for l in text.splitlines()]
    non_empty = [l for l in lines if l]

    chassis = None
    model = None
    bv = None

    # Locate the Version: line; chassis and model follow immediately after.
    for i, line in enumerate(non_empty):
        if line.lower().startswith('version:'):
            if i + 1 < len(non_empty):
                chassis = non_empty[i + 1]
            if i + 2 < len(non_empty):
                candidate = non_empty[i + 2]
                # Model line should not look like a key:value field
                if ':' not in candidate or candidate.split(':')[0].strip().isdigit():
                    model = candidate
            break

    # Fallback: no Version line — assume first two non-empty lines are chassis/model
    if chassis is None and len(non_empty) >= 2:
        chassis = non_empty[0]
        model = non_empty[1] if ':' not in non_empty[1] else None

    # Extract BV field (case-insensitive)
    for line in lines:
        lo = line.lower()
        if lo.startswith('bv:'):
            try:
                bv = int(line.split(':', 1)[1].strip())
            except ValueError:
                pass
            break

    if not chassis or not model or bv is None:
        return None, None

    # Skip lines that look like key:value fields leaking into the name position
    if ':' in chassis or ':' in model:
        return None, None

    unit_name = f"{chassis} {model}".strip()
    return unit_name, bv


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    folder = Path(sys.argv[1])
    output_path = sys.argv[2] if len(sys.argv) > 2 else 'bv-data.json'

    if not folder.is_dir():
        print(f"Error: '{folder}' is not a directory.", file=sys.stderr)
        sys.exit(1)

    bv_data = {}
    total = skipped = duplicates = 0

    for path in sorted(folder.rglob('*.mtf')):
        total += 1
        name, bv = parse_mtf(path)

        if name is None:
            skipped += 1
            continue

        if name in bv_data:
            # Keep the first occurrence; report if BV differs
            if bv_data[name] != bv:
                print(f"  Duplicate (BV differs): {name} — keeping {bv_data[name]}, ignoring {bv}")
            duplicates += 1
        else:
            bv_data[name] = bv

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(bv_data, f, indent=2, sort_keys=True)

    matched = total - skipped
    print(f"Scanned : {total} MTF files")
    print(f"Matched : {matched}  ({duplicates} duplicates collapsed)")
    print(f"Skipped : {skipped}  (no BV field or unrecognised format)")
    print(f"Written : {output_path}  ({len(bv_data)} unique units)")


if __name__ == '__main__':
    main()
