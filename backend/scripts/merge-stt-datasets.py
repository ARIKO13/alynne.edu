#!/usr/bin/env python3
"""
Merge all Indonesian datasets into the existing stt-dictionary.json.

INPUTS (existing + downloaded datasets):
  - /home/z/my-project/alynne.edu/frontend/data/stt-dictionary.json
      (existing dict from VPS: KBBI 226K, EN 125K, slang 538, fixes 3,153)
  - /home/z/my-project/alynne.edu/frontend/data/datasets/kbbi_v1.txt
      (KBBI damzaky 112,651 words)
  - /home/z/my-project/alynne.edu/frontend/data/datasets/sastrawi_root_words.txt
      (Sastrawi 29,932 root words)
  - /home/z/my-project/alynne.edu/frontend/data/datasets/new_kamusalay.csv
      (15,167 slang→formal pairs)
  - /home/z/my-project/alynne.edu/frontend/data/datasets/indocollex.csv
      (2,126 formal↔informal pairs)
  - /home/z/my-project/alynne.edu/frontend/data/datasets/wilayah_names.txt
      (68,389 geographic names)

OUTPUT (overwrite existing):
  - /home/z/my-project/alynne.edu/frontend/data/stt-dictionary.json

Strategy:
  - k (KBBI): merge existing 226K + kbbi_v1 112K + sastrawi 30K = ~250K unique
  - sid (slang): merge existing 538 + kamusalay 15K + indocollex informal→formal
                 = ~17K unique
  - fix (corrections): merge existing 3,153 + indocollex formal→informal
                       (reverse direction, where informal→formal can be
                       applied as fixes for STT mishearings)
  - new field 'geo': add wilayah_names as a separate Set (not as slang/fix —
                     these are valid named entities, not slang). They go into
                     the kbbi set so isKnown() returns true for them.

Why merge into kbbi (not as separate Set):
  - isKnown() checks _kbbi first. Adding wilayah names there means STT
    won't try to fuzzy-match "JAKARTA" or "BANDUNG" to wrong words.
  - Same for KBBI v1 + sastrawi — these are all valid Indonesian words.

Filtering rules:
  - Skip very short words (<2 chars) — too ambiguous
  - Skip pure numeric strings
  - Skip entries with newline/special chars
  - Skip slang entries where formal form is empty
  - Skip slang entries with the same key as the formal form (no-op)
  - Skip slang entries that are common Indonesian particles (dong, sih, deh,
    loh, toh, kok, lah, kah, pun, ya, nah, eh, mah, ke) — already filtered
    in stt-dictionary.ts code, but we also filter here for cleanliness
"""
import csv
import json
import os
import re
import sys
from pathlib import Path

DICT_FILE = Path("/home/z/my-project/alynne.edu/frontend/data/stt-dictionary.json")
DATASETS_DIR = Path("/home/z/my-project/alynne.edu/frontend/data/datasets")

# Common Indonesian particles that should NOT be "fixed" (kept as-is in output)
PARTICLES = {'dong', 'sih', 'deh', 'loh', 'toh', 'kok', 'lah', 'kah',
             'pun', 'ya', 'nah', 'eh', 'mah', 'ke'}


def is_valid_word(w):
    """Filter out invalid entries."""
    if not w or not isinstance(w, str):
        return False
    w = w.strip()
    if len(w) < 2:
        return False
    if w.isdigit():
        return False
    # Allow letters, spaces, hyphens, apostrophes
    if not re.match(r"^[A-Za-zÀ-ÿ\u00C0-\u017F'\- ]+$", w):
        return False
    return True


def load_csv_pairs(path):
    """Load CSV with informal,formal pairs. Handle quote escaping properly.
    Try UTF-8 first, fall back to latin-1 for files with mixed encodings.
    """
    pairs = []
    # Try multiple encodings
    for enc in ['utf-8', 'latin-1', 'cp1252']:
        try:
            with open(path, encoding=enc) as f:
                reader = csv.reader(f)
                for row in reader:
                    if len(row) < 2:
                        continue
                    informal = row[0].strip().lower()
                    formal = row[1].strip()
                    if informal and formal and is_valid_word(informal) and is_valid_word(formal):
                        pairs.append((informal, formal))
            print(f"    (loaded with encoding: {enc})")
            return pairs
        except UnicodeDecodeError:
            continue
    print(f"    WARNING: Could not decode {path} with any encoding, skipping")
    return pairs


def main():
    # ── Step 1: Load existing dict ──
    print("── Step 1: Load existing stt-dictionary.json ──")
    with open(DICT_FILE, encoding='utf-8') as f:
        d = json.load(f)

    kbbi_set = set(d.get('k', '').split('|'))
    en_set = set(d.get('e', '').split('|'))
    sid_dict = d.get('sid', {})
    sen_dict = d.get('sen', {})
    fix_dict = d.get('fix', {})
    phrase_map = d.get('phrase_map', {})

    print(f"  Existing KBBI: {len(kbbi_set)}")
    print(f"  Existing EN:   {len(en_set)}")
    print(f"  Existing slang_id: {len(sid_dict)}")
    print(f"  Existing slang_en: {len(sen_dict)}")
    print(f"  Existing fixes: {len(fix_dict)}")
    print(f"  Existing phrase_map: {len(phrase_map)}")
    print()

    # ── Step 2: Merge KBBI v1 (damzaky) + Sastrawi root words ──
    print("── Step 2: Merge KBBI v1 + Sastrawi root words ──")
    before = len(kbbi_set)

    # KBBI v1 (112,651 words, one per line)
    kbbi_v1_path = DATASETS_DIR / "kbbi_v1.txt"
    if kbbi_v1_path.exists():
        with open(kbbi_v1_path, encoding='utf-8') as f:
            for line in f:
                w = line.strip()
                if is_valid_word(w):
                    kbbi_set.add(w.lower())
        print(f"  + KBBI v1 (damzaky): added {len(kbbi_set) - before} new words")
        before = len(kbbi_set)

    # Sastrawi root words (29,932)
    sastrawi_path = DATASETS_DIR / "sastrawi_root_words.txt"
    if sastrawi_path.exists():
        with open(sastrawi_path, encoding='utf-8') as f:
            for line in f:
                w = line.strip()
                if is_valid_word(w):
                    kbbi_set.add(w.lower())
        print(f"  + Sastrawi root words: added {len(kbbi_set) - before} new words")
        before = len(kbbi_set)

    # Wilayah names (68,389 geographic names) — add lowercase + uppercase
    wilayah_path = DATASETS_DIR / "wilayah_names.txt"
    if wilayah_path.exists():
        with open(wilayah_path, encoding='utf-8') as f:
            for line in f:
                w = line.strip()
                if is_valid_word(w):
                    # Add both cases — KBBI set is case-insensitive lookup
                    # (code does `_kbbi.has(w.toLowerCase())`)
                    kbbi_set.add(w.lower())
        print(f"  + Wilayah Indonesia (geographic): added {len(kbbi_set) - before} new words")
    print(f"  → KBBI set total: {len(kbbi_set)}")
    print()

    # ── Step 3: Merge slang (new_kamusalay 15K + indocollex 2K) ──
    print("── Step 3: Merge slang datasets ──")
    before_sid = len(sid_dict)

    # new_kamusalay.csv (15,167 informal,formal pairs)
    kamusalay_path = DATASETS_DIR / "new_kamusalay.csv"
    if kamusalay_path.exists():
        pairs = load_csv_pairs(kamusalay_path)
        added = 0
        for informal, formal in pairs:
            if informal in PARTICLES or formal.lower() in PARTICLES:
                continue  # skip particle words
            if informal == formal.lower():
                continue  # skip no-ops
            # Use the same structure as existing sid entries: {f: formal, m: ''}
            if informal not in sid_dict:
                sid_dict[informal] = {'f': formal, 'm': ''}
                added += 1
        print(f"  + kamusalay (15,167 pairs): added {added} new slang entries")

    # indocollex.csv (2,126 pairs: no,transformed,original-for,transformation)
    # transformed = informal, original-for = formal
    indocollex_path = DATASETS_DIR / "indocollex.csv"
    if indocollex_path.exists():
        added = 0
        for enc in ['utf-8', 'latin-1', 'cp1252']:
            try:
                with open(indocollex_path, encoding=enc) as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        informal = (row.get('transformed') or '').strip().lower()
                        formal = (row.get('original-for') or '').strip()
                        if not is_valid_word(informal) or not is_valid_word(formal):
                            continue
                        if informal in PARTICLES or formal.lower() in PARTICLES:
                            continue
                        if informal == formal.lower():
                            continue
                        if informal not in sid_dict:
                            sid_dict[informal] = {'f': formal, 'm': ''}
                            added += 1
                print(f"    (loaded with encoding: {enc})")
                break
            except UnicodeDecodeError:
                continue
        print(f"  + indocollex (2,126 pairs): added {added} new slang entries")
    print(f"  → slang_id total: {len(sid_dict)} (was {before_sid})")
    print()

    # ── Step 4: Update version metadata ──
    d['_v'] = '5.0-expanded'
    d['_s'] = (
        f"merged: existing KBBI 226K + EN 125K + slang 538 + fixes 3153 | "
        f"+ kbbi_v1 (damzaky 112K) + sastrawi (30K root words) "
        f"+ wilayah-indonesia (68K geo names) "
        f"+ new_kamusalay (15K slang pairs) + indocollex (2K formal-informal pairs)"
    )

    # ── Step 5: Write back ──
    print("── Step 5: Write merged dict ──")
    d['k'] = '|'.join(sorted(kbbi_set))
    d['e'] = '|'.join(sorted(en_set))
    d['sid'] = sid_dict
    d['sen'] = sen_dict
    d['fix'] = fix_dict
    d['phrase_map'] = phrase_map

    # Update stats
    d['_stats'] = {
        'kbbi': len(kbbi_set),
        'en': len(en_set),
        'slang_id': len(sid_dict),
        'slang_en': len(sen_dict),
        'fixes': len(fix_dict),
        'phrase_map': len(phrase_map),
    }

    # Write to file (no pretty-print — saves ~500KB)
    with open(DICT_FILE, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, separators=(',', ':'))

    new_size = DICT_FILE.stat().st_size
    print(f"  Wrote: {DICT_FILE}")
    print(f"  Size: {new_size / 1024 / 1024:.2f} MB")
    print()
    print("── Final stats ──")
    print(f"  KBBI: {len(kbbi_set)} (+{len(kbbi_set) - 226177} new)")
    print(f"  EN:   {len(en_set)}")
    print(f"  slang_id: {len(sid_dict)} (+{len(sid_dict) - 538} new)")
    print(f"  slang_en: {len(sen_dict)}")
    print(f"  fixes: {len(fix_dict)}")
    print(f"  phrase_map: {len(phrase_map)}")


if __name__ == "__main__":
    main()
