#!/usr/bin/env python3
"""
Merge v2 — add 3 more datasets to stt-dictionary.json:
  - kbbi_v6_full.csv  (194,692 entries from aryakdaniswara/kbbi-v6-full-csv)
  - louisowen_combined_root_words.txt  (28,010 root words from louisowen6/NLP_bahasa_resources)
  - loanwords.txt  (963 loanwords extracted from Wikipedia's "List of loanwords in Indonesian")

Existing dict was built from:
  - KBBI 226K (existing) + KBBI v1 (damzaky 541 new) + Sastrawi 581 new + Wilayah 60,875 new
  - slang 538 (existing) + kamusalay 13,171 + indocollex 576

This merge adds:
  - kbbi_v6 CSV kata column → KBBI set (mostly overlap with existing, but adds missing entries)
  - louisowen root words → KBBI set (mostly overlap with Sastrawi, but adds missing)
  - loanwords → KBBI set (new! these are valid Indonesian words)
"""
import csv
import json
import re
import sys
from pathlib import Path

DICT_FILE = Path("/home/z/my-project/alynne.edu/frontend/data/stt-dictionary.json")
DATASETS_DIR = Path("/home/z/my-project/alynne.edu/backend/data/datasets")


def is_valid_word(w):
    if not w or not isinstance(w, str):
        return False
    w = w.strip()
    if len(w) < 2:
        return False
    if w.isdigit():
        return False
    if not re.match(r"^[A-Za-zÀ-ÿ\u00C0-\u017F'\- ]+$", w):
        return False
    return True


def main():
    print("── Load existing dict ──")
    with open(DICT_FILE, encoding='utf-8') as f:
        d = json.load(f)

    kbbi_set = set(d.get('k', '').split('|'))
    sid_dict = d.get('sid', {})
    fix_dict = d.get('fix', {})
    print(f"  Current KBBI: {len(kbbi_set)}")
    print(f"  Current slang: {len(sid_dict)}")
    print(f"  Current fixes: {len(fix_dict)}")
    print()

    before = len(kbbi_set)

    # ── 1. KBBI v6 full CSV (kata column = first column) ──
    print("── Merge KBBI v6 full CSV (194,692 entries) ──")
    kbbi_v6_path = DATASETS_DIR / "kbbi_v6_full.csv"
    if kbbi_v6_path.exists():
        added = 0
        with open(kbbi_v6_path, encoding='utf-8') as f:
            reader = csv.reader(f)
            next(reader, None)  # skip header
            for row in reader:
                if not row:
                    continue
                word = row[0].strip().lower()
                if is_valid_word(word):
                    # Some entries have multiple forms separated by '|' (e.g. "a (1) | a (2)")
                    # Take only the first form, strip parenthetical
                    clean = re.sub(r'\s*\([^)]*\)\s*', '', word).split('|')[0].strip()
                    clean = clean.split()[0] if ' ' in clean else clean  # take first word
                    if is_valid_word(clean) and clean not in kbbi_set:
                        kbbi_set.add(clean)
                        added += 1
        print(f"  + Added {added} new words from KBBI v6 (of 194,692 entries — most overlapped)")
    print()

    # ── 2. louisowen combined root words ──
    print("── Merge louisowen combined root words (28,010 entries) ──")
    louisowen_path = DATASETS_DIR / "louisowen_combined_root_words.txt"
    if louisowen_path.exists():
        added = 0
        with open(louisowen_path, encoding='utf-8') as f:
            for line in f:
                w = line.strip().lower()
                if is_valid_word(w) and w not in kbbi_set:
                    kbbi_set.add(w)
                    added += 1
        print(f"  + Added {added} new root words from louisowen (of 28,010 entries)")
    print()

    # ── 3. Wikipedia loanwords ──
    print("── Merge Wikipedia loanwords (963 entries) ──")
    loanwords_path = DATASETS_DIR / "loanwords.txt"
    if loanwords_path.exists():
        added = 0
        with open(loanwords_path, encoding='utf-8') as f:
            for line in f:
                w = line.strip().lower()
                if is_valid_word(w) and w not in kbbi_set:
                    kbbi_set.add(w)
                    added += 1
        print(f"  + Added {added} new loanwords (of 963 entries)")
    print()

    # Update metadata
    d['_v'] = '6.0-comprehensive'
    d['_s'] = (
        f"merged v6: existing KBBI 288K + slang 14K + fixes 3K | "
        f"+ kbbi_v6 CSV (194,692 entries, mostly overlap) "
        f"+ louisowen combined root (28,010) "
        f"+ Wikipedia loanwords (963)"
    )
    d['k'] = '|'.join(sorted(kbbi_set))
    d['_stats'] = {
        'kbbi': len(kbbi_set),
        'en': len(d.get('e', '').split('|')),
        'slang_id': len(sid_dict),
        'slang_en': len(d.get('sen', {})),
        'fixes': len(fix_dict),
        'phrase_map': len(d.get('phrase_map', {})),
    }

    # Write back
    print("── Write merged dict ──")
    with open(DICT_FILE, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, separators=(',', ':'))

    new_size = DICT_FILE.stat().st_size
    print(f"  Wrote: {DICT_FILE}")
    print(f"  Size: {new_size / 1024 / 1024:.2f} MB")
    print()
    print("── Final stats ──")
    print(f"  KBBI: {len(kbbi_set)} (+{len(kbbi_set) - before} new)")
    print(f"  slang_id: {len(sid_dict)}")
    print(f"  fixes: {len(fix_dict)}")


if __name__ == "__main__":
    main()
