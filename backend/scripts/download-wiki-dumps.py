#!/usr/bin/env python3
"""
Download SEMUA Wikipedia dump bahasa daerah Indonesia.
Pakai articles dump (XML) — extract SEMUA kata dari SEMUA artikel.

Metode:
1. Download dump XML.gz untuk setiap bahasa
2. Parse XML — extract semua text dari <text> tags
3. Tokenize — extract semua kata unik
4. Output JSON siap import SQLite
"""
import json, re, gzip, subprocess, time, os
from pathlib import Path
from collections import Counter
import xml.etree.ElementTree as ET

OUTPUT = Path("/root/lina-learning/backend/data/datasets/wikipedia-dump-extracted.json")
TMP_DIR = Path("/tmp/wiki-dumps")
TMP_DIR.mkdir(exist_ok=True)

# Semua edisi Wikipedia bahasa daerah Indonesia
LANGS = [
    ("jv", "jawa"),         # Jawa — ~500K articles
    ("su", "sunda"),        # Sunda — ~500K articles  
    ("min", "minang"),      # Minang — ~10K articles
    ("bug", "bugis"),       # Bugis — ~5K articles
    ("ban", "bali"),        # Bali — ~5K articles
    ("ace", "aceh"),        # Aceh — ~3K articles
    ("map-bms", "banyumasan"), # Banyumasan — ~3K articles
    ("bjn", "banjar"),      # Banjar — ~2K articles
    ("gor", "gorontalo"),   # Gorontalo — ~500 articles
    ("nia", "nias"),        # Nias — ~500 articles
    ("id", "indonesia"),    # Indonesia — ~600K articles (bonus!)
]

all_words = {}  # word → bahasa

def add_word(word, bahasa):
    w = word.strip().lower()
    if not w or len(w) < 2 or len(w) > 50:
        return
    # Allow letters, hyphens, apostrophes
    if not re.match(r"^[a-zà-ÿ'\-]+$", w):
        return
    if w not in all_words:
        all_words[w] = bahasa

def download_and_extract(lang_code, bahasa_name):
    """Download Wikipedia dump dan extract semua kata."""
    dump_url = f"https://dumps.wikimedia.org/{lang_code}wiki/latest/{lang_code}wiki-latest-pages-articles-multistream.xml.bz2"
    dump_file = TMP_DIR / f"{lang_code}wiki-dump.xml.bz2"
    
    print(f"  Downloading {lang_code}wiki dump...")
    
    # Download dengan wget (lebih reliable untuk file besar)
    result = subprocess.run(
        ["wget", "-q", "--show-progress", "-O", str(dump_file), dump_url],
        capture_output=True, text=True, timeout=600
    )
    
    if not dump_file.exists() or dump_file.stat().st_size < 1000:
        print(f"    ✗ Download failed, trying abstract dump...")
        # Try abstract dump (smaller)
        abstract_url = f"https://dumps.wikimedia.org/{lang_code}wiki/latest/{lang_code}wiki-latest-abstract.xml.gz"
        result = subprocess.run(
            ["wget", "-q", "-O", str(dump_file), abstract_url],
            capture_output=True, text=True, timeout=300
        )
        if not dump_file.exists() or dump_file.stat().st_size < 1000:
            print(f"    ✗ Both downloads failed")
            return 0
    
    file_size_mb = dump_file.stat().st_size / 1024 / 1024
    print(f"    Downloaded: {file_size_mb:.1f} MB")
    
    # Extract kata dari dump
    # Format: XML bz2 — gunakan bz2 + xml parser
    count = 0
    try:
        import bz2
        with bz2.open(dump_file, 'rt', encoding='utf-8', errors='replace') as f:
            text_buffer = ""
            in_text = False
            in_title = False
            title = ""
            text_content = ""
            
            for line in f:
                if "<title>" in line:
                    in_title = True
                    title = ""
                elif "</title>" in line:
                    in_title = False
                    # Extract title
                    t = re.sub(r'<[^>]+>', '', line).strip()
                    if t:
                        # Add title words
                        for word in t.split():
                            add_word(word, bahasa_name)
                            count += 1
                elif "<text" in line:
                    in_text = True
                    text_content = ""
                elif "</text>" in line:
                    in_text = False
                    # Extract words from text content
                    # Remove wiki markup
                    clean = re.sub(r'\{\{[^}]*\}\}', '', text_content)
                    clean = re.sub(r'\[\[[^\]]*\]\]', '', clean)
                    clean = re.sub(r'<[^>]+>', '', clean)
                    clean = re.sub(r'\'{2,}', '', clean)
                    clean = re.sub(r'={2,}[^=]+={2,}', '', clean)
                    clean = re.sub(r'\|', ' ', clean)
                    # Tokenize
                    words = re.findall(r'[a-zA-Zà-ÿÀ-ÿ]{2,50}', clean)
                    for word in words:
                        add_word(word, bahasa_name)
                        count += 1
                elif in_text:
                    text_content += line
                elif in_title:
                    pass  # title handled above
            
    except Exception as e:
        print(f"    ⚠ bz2 parse failed: {e}, trying grep approach...")
        # Fallback: gunakan grep untuk extract text
        try:
            result = subprocess.run(
                f"bzcat {dump_file} | grep -oP '(?<=>)[a-zA-Zà-ÿÀ-ÿ]{{2,50}}(?=<)' | head -500000",
                shell=True, capture_output=True, text=True, timeout=300
            )
            words = result.stdout.split('\n')
            for word in words:
                add_word(word, bahasa_name)
                count += 1
        except Exception as e2:
            print(f"    ✗ grep also failed: {e2}")
    
    # Cleanup
    try:
        dump_file.unlink()
    except:
        pass
    
    return count

# ═══ MAIN ═══
print("═══ DOWNLOAD + EXTRACT WIKIPEDIA DUMPS ═══\n")

for lang_code, bahasa_name in LANGS:
    print(f"── {bahasa_name} ({lang_code}wiki) ──")
    count = download_and_extract(lang_code, bahasa_name)
    unique = sum(1 for w, b in all_words.items() if b == bahasa_name)
    print(f"  ✓ {count} total words processed, {unique} unique\n")
    time.sleep(2)

# ═══ BUILD OUTPUT ═══
print(f"═══ TOTAL UNIQUE WORDS: {len(all_words)} ═══\n")

counts = {}
for w, b in all_words.items():
    counts[b] = counts.get(b, 0) + 1

print("── By bahasa ──")
for b, c in sorted(counts.items(), key=lambda x: -x[1]):
    print(f"  {b:20s}: {c:>8}")

output = {
    "_version": "1.0-dump-extracted",
    "_description": "Kata dari Wikipedia dump lengkap — SEMUA artikel SEMUA bahasa daerah",
    "_total_entries": len(all_words),
    "terms": [{"word": w, "domain": f"daerah_{b}"} for w, b in sorted(all_words.items())]
}

with open(OUTPUT, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False)

print(f"\n✓ Written: {OUTPUT}")
print(f"  File size: {OUTPUT.stat().st_size / 1024:.1f} KB")
print(f"  Total entries: {len(output['terms'])}")
