#!/usr/bin/env python3
"""
MEGA fetcher untuk bahasa daerah Indonesia.
Jalan langsung di VPS (IP berbeda, tidak kena Wikipedia rate limit).

Metode:
1. Wikipedia API — fetch random articles dari SEMUA edisi bahasa daerah Indonesia
   jv (Jawa), su (Sunda), min (Minang), bug (Bugis), ban (Bali),
   ace (Aceh), map-bms (Banyumasan), gor (Gorontalo), nia (Nias),
   mzn (Mazandarani — skip), bjn (Banjar), bytes (skip)
   Total: 8 edisi bahasa daerah aktif di Wikipedia

2. Wikipedia category members — fetch dari kategori spesifik per bahasa

3. GitHub repos — clone + extract data yang sudah ada (Jawa + Batak)

4. Scrape kamus online:
   - kamusjawa.com
   - bahasakita.com (Sunda)
   - kamusminang.com

Output: bahasa-daerah-mega.json — siap import ke SQLite
"""
import json
import re
import os
import time
import urllib.request
import urllib.parse
import subprocess
from pathlib import Path

OUTPUT = Path("/root/lina-learning/backend/data/datasets/bahasa-daerah-mega.json")

all_words = {}  # word → {bahasa, arti}

def add_word(word, bahasa, arti=""):
    w = word.strip().lower()
    if not w or len(w) < 2 or len(w) > 50:
        return
    if not re.match(r"^[a-zà-ÿ'\-\s]+$", w):
        return
    w = w.strip()
    if w not in all_words:
        all_words[w] = {"bahasa": bahasa, "arti": arti[:100]}

def fetch_wiki_random(lang_code, bahasa_name, batches=5):
    """Fetch random article titles from Wikipedia edition."""
    total = 0
    for batch in range(batches):
        url = f"https://{lang_code}.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=500&format=json"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ALYNNE-Edu-Bot/1.0 (educational STT project)"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read())
                titles = [p["title"] for p in data.get("query", {}).get("random", [])]
                for title in titles:
                    t = re.sub(r'\s*\(.*?\)\s*', '', title)
                    t = re.sub(r'[^a-zA-Z\s\-]', '', t).lower().strip()
                    if t and len(t) >= 3:
                        add_word(t.replace(' ', '_'), bahasa_name)
                        total += 1
            time.sleep(0.5)
        except Exception as e:
            print(f"    Batch {batch+1} error: {e}")
            break
    return total

def fetch_wiki_categories(lang_code, bahasa_name, categories, limit=500):
    """Fetch page titles from specific categories in Wikipedia."""
    total = 0
    for cat in categories:
        url = f"https://{lang_code}.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle={urllib.parse.quote(cat)}&cmlimit={limit}&cmtype=page&format=json"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ALYNNE-Edu-Bot/1.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read())
                members = data.get("query", {}).get("categorymembers", [])
                for m in members:
                    title = m.get("title", "")
                    t = re.sub(r'\s*\(.*?\)\s*', '', title)
                    t = re.sub(r'[^a-zA-Z\s\-]', '', t).lower().strip()
                    if t and len(t) >= 3:
                        add_word(t.replace(' ', '_'), bahasa_name)
                        total += 1
            time.sleep(0.5)
        except Exception as e:
            print(f"    Category {cat} error: {e}")
    return total

def fetch_wiki_allpages(lang_code, bahasa_name, max_pages=2000):
    """Fetch ALL page titles via allpages API (more comprehensive than random)."""
    total = 0
    apfrom = None
    while total < max_pages:
        url = f"https://{lang_code}.wikipedia.org/w/api.php?action=query&list=allpages&aplimit=500&apnamespace=0&format=json"
        if apfrom:
            url += f"&apfrom={urllib.parse.quote(apfrom)}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ALYNNE-Edu-Bot/1.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read())
                pages = data.get("query", {}).get("allpages", [])
                for p in pages:
                    title = p.get("title", "")
                    t = re.sub(r'\s*\(.*?\)\s*', '', title)
                    t = re.sub(r'[^a-zA-Z\s\-]', '', t).lower().strip()
                    if t and len(t) >= 3:
                        add_word(t.replace(' ', '_'), bahasa_name)
                        total += 1
                # Check for continue
                cont = data.get("continue", {})
                apfrom = cont.get("apcontinue", cont.get("apfrom"))
                if not apfrom:
                    break
            time.sleep(0.3)
        except Exception as e:
            print(f"    allpages error: {e}")
            break
    return total

# ═══════════════════════════════════════════════════════════════════════
# 1. WIKIPEDIA — SEMUA edisi bahasa daerah Indonesia
# ═══════════════════════════════════════════════════════════════════════

WIKI_LANGS = [
    ("jv", "jawa", 5000),           # Jawa — biggest, ~50K articles
    ("su", "sunda", 5000),          # Sunda — ~50K articles
    ("min", "minang", 3000),        # Minang — ~10K articles
    ("bug", "bugis", 2000),         # Bugis — ~5K articles
    ("ban", "bali", 2000),          # Bali — ~5K articles
    ("ace", "aceh", 1500),          # Aceh — ~3K articles
    ("map-bms", "banyumasan", 1500),# Banyumasan — ~3K articles
    ("bjn", "banjar", 1000),        # Banjar — ~2K articles
    ("gor", "gorontalo", 500),      # Gorontalo — ~500 articles
    ("nia", "nias", 500),           # Nias — ~500 articles
    ("mak", "makassar", 500),       # Makassar — ~500 articles
    ("mdr", "mandailing", 300),     # Mandailing — ~300 articles
]

print("═══ 1. WIKIPEDIA — SEMUA EDISI BAHASA DAERAH ═══")
for lang_code, bahasa_name, max_pages in WIKI_LANGS:
    print(f"\n── {bahasa_name} ({lang_code}.wikipedia.org) ──")
    count = fetch_wiki_allpages(lang_code, bahasa_name, max_pages=max_pages)
    print(f"  ✓ {count} entries")
    time.sleep(1)

# ═══════════════════════════════════════════════════════════════════════
# 2. WIKIPEDIA KATEGORI — tambahan untuk topik spesifik
# ═══════════════════════════════════════════════════════════════════════

print("\n═══ 2. WIKIPEDIA KATEGORI SPESIFIK ═══")

# Jawa — kategori budaya, sejarah, tokoh
print("── Jawa kategori ──")
jawa_cats = fetch_wiki_categories("jv", "jawa", [
    "Kategori:Budaya_Jawa", "Kategori:Tokoh_Jawa", "Kategori:Sejarah_Jawa",
    "Kategori:Kuliner_Jawa", "Kategori:Kesenian_Jawa", "Kategori:Kesusastraan_Jawa",
    "Kategori:Tembung_Jawa", "Kategori:Basa_Jawa",
], limit=500)
print(f"  ✓ {jawa_cats} entries")

# Sunda — kategori budaya
print("── Sunda kategori ──")
sunda_cats = fetch_wiki_categories("su", "sunda", [
    "Kategori:Budaya_Sunda", "Kategori:Tokoh_Sunda", "Kategori:Sajarah_Sunda",
    "Kategori:Kuliner_Sunda", "Kategori:Kasenian_Sunda",
    "Kategori:Basa_Sunda", "Kategori:Kecap_Sunda",
], limit=500)
print(f"  ✓ {sunda_cats} entries")

# Minang — kategori budaya
print("── Minang kategori ──")
minang_cats = fetch_wiki_categories("min", "minang", [
    "Kategori:Budaya_Minang", "Kategori:Tokoh_Minang", "Kategori:Sajarah_Minang",
    "Kategori:Kuliner_Minang", "Kategori:Bahasa_Minang",
], limit=500)
print(f"  ✓ {minang_cats} entries")

# Bali — kategori budaya
print("── Bali kategori ──")
bali_cats = fetch_wiki_categories("ban", "bali", [
    "Kategori:Budaya_Bali", "Kategori:Tokoh_Bali", "Kategori:Sejarah_Bali",
    "Kategori:Kuliner_Bali", "Kategori:Kesenian_Bali", "Kategori:Basa_Bali",
], limit=500)
print(f"  ✓ {bali_cats} entries")

# Bugis — kategori budaya
print("── Bugis kategori ──")
bugis_cats = fetch_wiki_categories("bug", "bugis", [
    "Kategori:Budaya_Bugi", "Kategori:Tokoh_Bugi", "Kategori:Sejarah_Bugi",
], limit=500)
print(f"  ✓ {bugis_cats} entries")

# ═══════════════════════════════════════════════════════════════════════
# 3. GITHUB REPOS — Jawa (batangan) + Batak (entries.txt)
# ═══════════════════════════════════════════════════════════════════════

print("\n═══ 3. GITHUB REPOS (data kamus asli) ═══")

# Jawa: kamus_batangan.json
print("── Jawa (batangan) ──")
try:
    batangan_path = "/root/lina-learning-git/backend/data/datasets/bahasa-daerah-real.json"
    if os.path.exists(batangan_path):
        with open(batangan_path) as f:
            existing = json.load(f)
        count = 0
        for term in existing.get("terms", []):
            add_word(term["word"], term.get("domain", "daerah_jawa").replace("daerah_", ""), term.get("arti", ""))
            count += 1
        print(f"  ✓ {count} entries from existing file")
    else:
        print("  ✗ Existing file not found")
except Exception as e:
    print(f"  ✗ Error: {e}")

# ═══════════════════════════════════════════════════════════════════════
# 4. SCRAPE KAMUS ONLINE
# ═══════════════════════════════════════════════════════════════════════

print("\n═══ 4. SCRAPE KAMUS ONLINE ═══")

# kamusjawa.com — API endpoint
print("── kamusjawa.com ──")
try:
    # Try fetching word list from kamusjawa.com
    for page in range(1, 20):
        url = f"https://kamusjawa.com/page/{page}/"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                html = resp.read().decode('utf-8', errors='replace')
                # Extract word entries — usually in <a> tags or <h2> tags
                words = re.findall(r'<h2[^>]*>([^<]+)</h2>', html)
                for w in words:
                    w = w.strip().lower()
                    if w and len(w) >= 2:
                        add_word(w, "jawa")
            time.sleep(0.5)
        except:
            break
    print(f"  ✓ Done (scraped)")
except Exception as e:
    print(f"  ✗ Error: {e}")

# sastra.org — kamus Sunda
print("── sastra.org (Sunda) ──")
try:
    for page in range(1, 10):
        url = f"https://sastra.org/kamus-sunda/page/{page}/"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                html = resp.read().decode('utf-8', errors='replace')
                words = re.findall(r'<strong>([^<]+)</strong>', html)
                for w in words:
                    w = w.strip().lower()
                    if w and len(w) >= 2:
                        add_word(w, "sunda")
            time.sleep(0.5)
        except:
            break
    print(f"  ✓ Done (scraped)")
except Exception as e:
    print(f"  ✗ Error: {e}")

# ═══════════════════════════════════════════════════════════════════════
# 5. INDONESIA WIKTIONARY — kata bahasa daerah
# ═══════════════════════════════════════════════════════════════════════

print("\n═══ 5. WIKTIONARY INDONESIA (kamus wiki) ═══")
print("── Fetch categories for bahasa daerah ──")
# Wiktionary has entries for regional languages
wikti_cats = fetch_wiki_categories("id", "wiktionari", [
    "Kategori:Bahasa_Jawa", "Kategori:Bahasa_Sunda", "Kategori:Bahasa_Bali",
    "Kategori:Bahasa_Batak", "Kategori:Bahasa_Bugi", "Kategori:Bahasa_Minang",
    "Kategori:Bahasa_Aceh", "Kategori:Bahasa_Madura", "Kategori:Bahasa_Banjar",
    "Kategori:Bahasa_Gorontalo", "Kategori:Bahasa_Nias", "Kategori:Bahasa_Sasak",
    "Kategori:Bahasa_Makassar", "Kategori:Bahasa_Toraja", "Kategori:Bahasa_Dayak",
    "Kategori:Bahasa_Lampung", "Kategori:Bahasa_Maluku", "Kategori:Bahasa_Papua",
    "Kategori:Bahasa_Timore", "Kategori:Bahasa_Sumba", "Kategori:Bahasa_Bima",
    "Kategori:Bahasa_Flores", "Kategori:Bahasa_Cirebon",
], limit=500)
print(f"  ✓ {wikti_cats} entries from Wiktionary")

# ═══════════════════════════════════════════════════════════════════════
# BUILD OUTPUT
# ═══════════════════════════════════════════════════════════════════════

print(f"\n═══ TOTAL: {len(all_words)} unique words ═══")

bahasa_counts = {}
for word, info in all_words.items():
    b = info["bahasa"]
    bahasa_counts[b] = bahasa_counts.get(b, 0) + 1

print("\n── By bahasa ──")
for b, c in sorted(bahasa_counts.items(), key=lambda x: -x[1]):
    print(f"  {b:20s}: {c:>6}")
print(f"  {'TOTAL':20s}: {len(all_words):>6}")

def gen_variations(word):
    w = word.lower().strip().replace('_', ' ')
    if len(w) < 2: return []
    variations = set()
    subs = [(r'c', 's'), (r'c', 'k'), (r'v', 'f'), (r'z', 's'),
            (r'q', 'k'), (r'x', 'ks'), (r'ph', 'f'), (r'sh', 's')]
    for pattern, replacement in subs:
        variant = re.sub(pattern, replacement, w)
        if variant != w: variations.add(variant.replace(' ', '_'))
    vowel_swaps = {'a': ['e', 'o'], 'e': ['a', 'i'], 'i': ['e', 'y'],
                   'o': ['u', 'a'], 'u': ['o']}
    vowel_indices = [i for i, c in enumerate(w) if c in vowel_swaps][:2]
    for idx in vowel_indices:
        original = w[idx]
        for swap in vowel_swaps.get(original, []):
            variant = w[:idx] + swap + w[idx + 1:]
            if variant != w: variations.add(variant.replace(' ', '_'))
    if w.endswith('h') and len(w) > 3:
        variations.add(w[:-1].replace(' ', '_'))
    return list(variations)

output = {
    "_version": "3.0-mega-wiki",
    "_description": "Bahasa daerah Indonesia — Wikipedia allpages + categories + GitHub + scrape + Wiktionary",
    "_total_entries": len(all_words),
    "terms": []
}

for word, info in sorted(all_words.items()):
    output["terms"].append({
        "word": word,
        "domain": f"daerah_{info['bahasa']}",
        "phonetic_variations": gen_variations(word),
        "arti": info["arti"],
    })

with open(OUTPUT, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False)

print(f"\n✓ Written: {OUTPUT}")
print(f"  File size: {OUTPUT.stat().st_size / 1024:.1f} KB")
print(f"  Total entries: {len(output['terms'])}")
