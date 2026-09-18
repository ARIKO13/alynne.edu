#!/usr/bin/env python3
"""
Phase 2 — augment existing wikipedia-proper-nouns.json with more diverse domains.

The first pass (build-wikipedia-proper-nouns.py) was killed mid-way through
Kategori:Provinsi_di_Indonesia, leaving only sejarah + geografi domains.

This script:
  1. Loads existing wikipedia-proper-nouns.json (20K+ terms already)
  2. Fetches additional categories NOT yet processed (universities, companies,
     islands, mountains, sports, music, etc.) to add diversity
  3. Merges with existing data (dedup case-insensitive)
  4. Re-writes the file with proper version "1.0-wikipedia" (non-partial)
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# Re-use helpers from the main script (via importlib — filename has hyphens)
import importlib.util
SCRIPT_DIR = Path("/home/z/my-project/alynne.edu/backend/scripts")
spec = importlib.util.spec_from_file_location(
    "wpn", SCRIPT_DIR / "build-wikipedia-proper-nouns.py"
)
wpn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wpn)

OUTPUT = wpn.OUTPUT

# Categories to fetch in phase 2 — these add domain diversity.
# Skip Tokoh_Indonesia, Tokoh_sejarah, Pahlawan, Presiden, Wakil_Presiden,
# Wali_Songo, Tokoh_pendirian, Kota, Kabupaten (already done in phase 1).
PHASE2_CATEGORIES = [
    # Geografi (continue)
    ("Kategori:Provinsi_di_Indonesia",                  "geografi"),
    ("Kategori:Ibu_kota_provinsi_di_Indonesia",         "geografi"),
    ("Kategori:Pulau_di_Indonesia",                     "geografi"),
    ("Kategori:Gunung_di_Indonesia",                    "geografi"),
    ("Kategori:Sungai_di_Indonesia",                    "geografi"),
    ("Kategori:Danau_di_Indonesia",                     "geografi"),
    ("Kategori:Selat_di_Indonesia",                     "geografi"),
    ("Kategori:Teluk_di_Indonesia",                     "geografi"),
    ("Kategori:Kecamatan_di_Indonesia",                 "geografi"),

    # Pendidikan / Organisasi
    ("Kategori:Universitas_di_Indonesia",               "pendidikan"),
    ("Kategori:Institut_di_Indonesia",                  "pendidikan"),
    ("Kategori:Sekolah_di_Indonesia",                   "pendidikan"),
    ("Kategori:Politeknik_di_Indonesia",                "pendidikan"),
    ("Kategori:Universitas_swasta_di_Indonesia",        "pendidikan"),
    ("Kategori:Universitas_negeri_di_Indonesia",        "pendidikan"),

    # Ekonomi / Organisasi
    ("Kategori:Perusahaan_Indonesia",                   "ekonomi"),
    ("Kategori:Perusahaan_penerbangan_Indonesia",       "ekonomi"),
    ("Kategori:Bank_Indonesia",                         "ekonomi"),
    ("Kategori:BUMN",                                   "ekonomi"),

    # Budaya
    ("Kategori:Makanan_Indonesia",                      "budaya"),
    ("Kategori:Minuman_Indonesia",                      "budaya"),
    ("Kategori:Tarian_tradisional_Indonesia",           "budaya"),
    ("Kategori:Alat_musik_tradisional_Indonesia",       "budaya"),
    ("Kategori:Suku_bangsa_di_Indonesia",               "budaya"),
    ("Kategori:Bahasa_di_Indonesia",                    "bahasa"),

    # Seni
    ("Kategori:Film_Indonesia",                         "seni"),
    ("Kategori:Musik_Indonesia",                        "seni"),
    ("Kategori:Aktor_Indonesia",                        "seni"),
    ("Kategori:Aktris_Indonesia",                       "seni"),
    ("Kategori:Penyanyi_Indonesia",                     "seni"),
    ("Kategori:Grup_musik_Indonesia",                   "seni"),

    # Olahraga
    ("Kategori:Olahraga_Indonesia",                     "olahraga"),
    ("Kategori:Pemain_sepak_bola_Indonesia",            "olahraga"),
    ("Kategori:Atlet_Indonesia",                        "olahraga"),
    ("Kategori:Pemain_bulu_tangkis_Indonesia",          "olahraga"),
    ("Kategori:Klub_sepak_bola_Indonesia",              "olahraga"),

    # Politik
    ("Kategori:Partai_politik_di_Indonesia",            "politik"),
    ("Kategori:Menteri_Indonesia",                      "politik"),
    ("Kategori:Gubernur_Indonesia",                     "politik"),
    ("Kategori:Bupati_Indonesia",                       "politik"),

    # Sains / Misc
    ("Kategori:Sejarah_Indonesia",                      "sejarah"),
]


def main():
    print("=" * 70)
    print("Phase 2 — augment existing wikipedia-proper-nouns.json")
    print("=" * 70)

    # ── 1. Load existing data ──
    if not OUTPUT.exists():
        print(f"✗ Existing file not found: {OUTPUT}")
        print("  Run build-wikipedia-proper-nouns.py first.")
        return

    with open(OUTPUT, encoding="utf-8") as f:
        existing = json.load(f)
    print(f"Loaded existing: {existing.get('_version')}, "
          f"{len(existing.get('terms', []))} terms")

    word_to_domain = {t["word"]: t["domain"] for t in existing["terms"]}
    word_to_variations = {t["word"]: list(t["phonetic_variations"])
                          for t in existing["terms"]}
    print(f"  Existing unique words: {len(word_to_domain)}")
    print()

    # ── 2. Fetch new categories ──
    seen_pages = set()
    seen_subcats = set()
    stats = {"pages_total": 0}
    total = len(PHASE2_CATEGORIES)

    for idx, (cat, domain) in enumerate(PHASE2_CATEGORIES, 1):
        print(f"[{idx}/{total}] {cat}  (domain={domain})", flush=True)
        try:
            titles = wpn.fetch_category_members(
                cat, wpn.RECURSION_DEPTH, stats, seen_pages, seen_subcats
            )
        except Exception as e:
            print(f"    ✗ Failed: {e}", flush=True)
            titles = []

        added = 0
        for title in titles:
            cleaned = wpn.clean_title(title)
            if not cleaned:
                continue
            wkey = wpn.word_key(cleaned)
            if not wkey or wkey in word_to_domain:
                continue
            word_to_domain[wkey] = domain
            word_to_variations[wkey] = wpn.gen_phonetic_variations(wkey)
            added += 1
        print(f"    ✓ harvested={len(titles):4d}  added={added:4d}  "
              f"(total unique={len(word_to_domain)})  "
              f"[pages_seen={stats['pages_total']}]", flush=True)

        # Incremental save (still partial — phase 2 in progress)
        wpn.write_output(word_to_domain, word_to_variations, stats,
                         partial=True)
        time.sleep(wpn.SLEEP_BETWEEN_CALLS)

    # ── 3. Final write (non-partial) ──
    n = wpn.write_output(word_to_domain, word_to_variations, stats,
                         partial=False)
    size_kb = OUTPUT.stat().st_size / 1024
    print()
    print("=" * 70)
    print(f"✓ Final write: {OUTPUT}")
    print(f"  Size: {size_kb:.1f} KB")
    print(f"  Total unique terms: {n}")
    print(f"  Total API pages seen (phase 2): {stats['pages_total']}")
    print("=" * 70)

    # Domain breakdown
    domain_counts = defaultdict(int)
    for w, dom in word_to_domain.items():
        domain_counts[dom] += 1
    print("\nDomain breakdown:")
    for d, c in sorted(domain_counts.items(), key=lambda x: -x[1]):
        print(f"  {d:12s}  {c}")

    # Variation coverage
    with_var = sum(1 for v in word_to_variations.values() if v)
    print(f"\nPhonetic variations: {with_var}/{n} terms have variations "
          f"({100*with_var/n:.1f}%)")

    # Sample from each domain
    print("\nSample terms per domain:")
    by_domain = defaultdict(list)
    for w in sorted(word_to_domain.keys()):
        by_domain[word_to_domain[w]].append(w)
    for d in sorted(by_domain.keys()):
        print(f"  [{d}]")
        for w in by_domain[d][:5]:
            pv = word_to_variations.get(w, [])
            pv_str = f" → {pv[:3]}" if pv else ""
            print(f"    {w}{pv_str}")


if __name__ == "__main__":
    main()
