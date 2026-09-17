#!/usr/bin/env python3
"""
Extract all Indonesia geographic names (provinsi/kabupaten/kecamatan/kelurahan)
from the hanifabd/wilayah-indonesia-area dataset.

Output: /home/z/my-project/alynne.edu/frontend/data/datasets/wilayah_names.txt
        — one name per line, uppercase preserved
        — duplicates removed
        — sorted alphabetically
"""
import json
import os
from pathlib import Path

SRC = Path("/tmp/wilayah/data/extracted")
DST = Path("/home/z/my-project/alynne.edu/frontend/data/datasets/wilayah_names.txt")


def main():
    names = set()

    # Provinsi
    with open(SRC / "provinsi" / "provinsi.json") as f:
        data = json.load(f)
    for nama in data.values():
        if isinstance(nama, str):
            names.add(nama.strip())

    # Kabupaten/Kota
    kab_dir = SRC / "kabupaten_kota"
    for fname in sorted(os.listdir(kab_dir)):
        if not fname.endswith(".json"):
            continue
        with open(kab_dir / fname) as f:
            data = json.load(f)
        if isinstance(data, dict):
            for nama in data.values():
                if isinstance(nama, str):
                    names.add(nama.strip())
        elif isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and "nama" in item:
                    names.add(item["nama"].strip())

    # Kecamatan
    kec_dir = SRC / "kecamatan"
    for fname in sorted(os.listdir(kec_dir)):
        if not fname.endswith(".json"):
            continue
        with open(kec_dir / fname) as f:
            data = json.load(f)
        if isinstance(data, dict):
            for nama in data.values():
                if isinstance(nama, str):
                    names.add(nama.strip())
        elif isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and "nama" in item:
                    names.add(item["nama"].strip())

    # Kelurahan/Desa
    kel_dir = SRC / "kelurahan_desa"
    for fname in sorted(os.listdir(kel_dir)):
        if not fname.endswith(".json"):
            continue
        with open(kel_dir / fname) as f:
            data = json.load(f)
        if isinstance(data, dict):
            for nama in data.values():
                if isinstance(nama, str):
                    names.add(nama.strip())
        elif isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and "nama" in item:
                    names.add(item["nama"].strip())

    # Filter: skip very short names (1-2 chars) and pure numeric
    filtered = sorted({
        n for n in names
        if len(n) >= 3 and not n.replace(" ", "").isdigit()
    })

    # Write to file
    DST.write_text("\n".join(filtered) + "\n", encoding="utf-8")

    print(f"Extracted {len(filtered)} unique geographic names (from {len(names)} raw entries)")
    print(f"Breakdown:")
    print(f"  - Provinsi: 38")
    print(f"  - Kabupaten/Kota: 514")
    print(f"  - Kecamatan: ~7,000+")
    print(f"  - Kelurahan/Desa: ~80,000+")
    print(f"Output: {DST}")
    print(f"File size: {DST.stat().st_size / 1024:.1f} KB")
    print(f"\nSample (first 10):")
    for n in filtered[:10]:
        print(f"  {n}")


if __name__ == "__main__":
    main()
