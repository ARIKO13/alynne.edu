#!/usr/bin/env python3
"""Scrape SEMUA sumber kamus bahasa daerah Indonesia."""
import json, re, time, urllib.request, urllib.parse
from pathlib import Path

OUTPUT = Path("/root/lina-learning/backend/data/datasets/daerah-scrape.json")
all_words = {}

def add(word, bahasa, arti=""):
    w = word.strip().lower()
    if not w or len(w) < 2 or len(w) > 50: return
    if not re.match(r"^[a-zà-ÿ'\-\s]+$", w): return
    if w not in all_words:
        all_words[w] = {"bahasa": bahasa, "arti": arti[:100]}

def fetch(url, timeout=10):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except:
        return ""

# ═══ 1. KAMUS BAHASA DAERAH KEMDIKBUD ═══
print("── 1. Kamus Bahasa Daerah Kemdikbud ──")
# Coba berbagai endpoint API
for endpoint in [
    "https://kamus-bahasa-daerah.kemdikbud.go.id/api/kata?page=1&limit=1000",
    "https://kamus-bahasa-daerah.kemdikbud.go.id/api/words?page=1",
    "https://kamus-bahasa-daerah.kemdikbud.go.id/api/dictionary?page=1",
]:
    data = fetch(endpoint, timeout=10)
    if data and len(data) > 100:
        print(f"  Found: {endpoint} ({len(data)} bytes)")
        try:
            j = json.loads(data)
            print(f"  JSON keys: {list(j.keys())[:5]}")
        except:
            print(f"  Not JSON, first 200: {data[:200]}")
        break
else:
    # Coba scrape HTML
    html = fetch("https://kamus-bahasa-daerah.kemdikbud.go.id/", timeout=10)
    if html:
        # Cari link ke bahasa daerah
        links = re.findall(r'href=["\']([^"\']*)["\']', html)
        bahasa_links = [l for l in links if any(b in l.lower() for b in ['jawa','sunda','bali','batak','bugis','minang','aceh','madura','banjar','dayak','nias','papua','maluku','toraja','sasak'])]
        print(f"  HTML links found: {len(bahasa_links)}")
        for link in bahasa_links[:10]:
            print(f"    {link}")
    else:
        print("  Cannot access kemdikbud")

# ═══ 2. JOWO.EU — Kamus Jawa lengkap ═══
print("\n── 2. jowo.eu (Kamus Jawa) ──")
# Coba API
for page in range(1, 50):
    html = fetch(f"https://jowo.eu/kamus-jawa/page/{page}/", timeout=10)
    if not html:
        break
    # Extract words — cari pattern <td> atau <strong> atau <h2>
    words = re.findall(r'<(?:td|strong|h2)[^>]*>([^<]{2,40})</(?:td|strong|h2)>', html)
    count = 0
    for w in words:
        w = w.strip().lower()
        if w and len(w) >= 2 and not w.isdigit():
            add(w, "jawa")
            count += 1
    if count == 0:
        break
    time.sleep(0.5)
print(f"  ✓ jowo.eu scraped")

# ═══ 3. WIKTIONARY — fetch via API dengan delay ═══
print("\n── 3. Wiktionary Indonesia (kamus wiki) ──")
def fetch_wiki_allpages(lang, bahasa, max_pages=5000):
    total = 0
    apcont = None
    while total < max_pages:
        url = f"https://{lang}.wiktionary.org/w/api.php?action=query&list=allpages&aplimit=500&apnamespace=0&format=json"
        if apcont:
            url += f"&apcontinue={urllib.parse.quote(apcont)}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ALYNNE-Edu-Bot/2.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read())
                pages = data.get("query", {}).get("allpages", [])
                for p in pages:
                    t = re.sub(r'[^a-zA-Z\s\-]', '', p.get("title", "")).lower().strip()
                    if t and len(t) >= 3:
                        add(t.replace(' ', '_'), f"wikti_{bahasa}")
                        total += 1
                apcont = data.get("continue", {}).get("apcontinue")
                if not apcont: break
        except:
            break
        time.sleep(2)
    return total

# Wiktionary Indonesia
wt_count = fetch_wiki_allpages("id", "indonesia", max_pages=10000)
print(f"  Wiktionary ID: {wt_count} entries")

# ═══ 4. WIKIPEDIA KEMBALI — dengan delay lebih lama ═══
print("\n── 4. Wikipedia edisi bahasa daerah (delay 5s) ──")
def fetch_wiki_allpages_v2(lang, bahasa, max_pages=10000):
    total = 0
    apcont = None
    while total < max_pages:
        url = f"https://{lang}.wikipedia.org/w/api.php?action=query&list=allpages&aplimit=500&apnamespace=0&format=json"
        if apcont:
            url += f"&apcontinue={urllib.parse.quote(apcont)}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ALYNNE-Edu-Bot/3.0 (https://alynne.my.id)"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read())
                pages = data.get("query", {}).get("allpages", [])
                for p in pages:
                    t = re.sub(r'[^a-zA-Z\s\-]', '', p.get("title", "")).lower().strip()
                    if t and len(t) >= 3:
                        add(t.replace(' ', '_'), bahasa)
                        total += 1
                apcont = data.get("continue", {}).get("apcontinue")
                if not apcont: break
        except Exception as e:
            if "429" in str(e):
                print(f"    429 — waiting 30s...")
                time.sleep(30)
                continue
            break
        time.sleep(5)  # 5s delay
    return total

LANGS = [
    ("jv", "jawa", 20000),
    ("su", "sunda", 20000),
    ("min", "minang", 10000),
    ("bug", "bugis", 5000),
    ("ban", "bali", 5000),
    ("ace", "aceh", 3000),
    ("map-bms", "banyumasan", 3000),
    ("bjn", "banjar", 2000),
    ("gor", "gorontalo", 1000),
    ("nia", "nias", 1000),
]

for lang, bahasa, max_p in LANGS:
    print(f"  {bahasa} ({lang})...", end=" ", flush=True)
    c = fetch_wiki_allpages_v2(lang, bahasa, max_p)
    print(f"{c} entries")
    time.sleep(10)

# ═══ 5. OPENSTREETMAP — nama tempat dalam bahasa daerah ═══
print("\n── 5. OpenStreetMap nama tempat ──")
# Overpass API — cari nama tempat dengan tag name:jv, name:su, dll
for lang_tag, bahasa in [("jv", "jawa"), ("su", "sunda"), ("min", "minang"), ("bug", "bugis"), ("ban", "bali"), ("ace", "aceh")]:
    query = f'[out:json][timeout:25];node["name:{lang_tag}"](2,-95,8,-130);out 1000;'
    # Actually Indonesia bbox: -11,95,6,141
    query = f'[out:json][timeout:25];node["name:{lang_tag}"](-11,95,6,141);out 1000;'
    try:
        req = urllib.request.Request("https://overpass-api.de/api/interpreter",
            data=query.encode(),
            headers={"User-Agent": "ALYNNE-Edu-Bot/3.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            elements = data.get("elements", [])
            count = 0
            for el in elements:
                tags = el.get("tags", {})
                name = tags.get(f"name:{lang_tag}", "")
                if name:
                    add(name, bahasa)
                    count += 1
            print(f"  {bahasa}: {count} OSM names")
    except Exception as e:
        print(f"  {bahasa}: error ({e})")
    time.sleep(5)

# ═══ BUILD OUTPUT ═══
print(f"\n═══ TOTAL: {len(all_words)} unique words ═══")
counts = {}
for w, info in all_words.items():
    b = info["bahasa"]
    counts[b] = counts.get(b, 0) + 1
for b, c in sorted(counts.items(), key=lambda x: -x[1]):
    print(f"  {b:20s}: {c:>6}")

output = {"_version": "1.0-scrape", "terms": [{"word": w, "domain": f"daerah_{info['bahasa']}", "arti": info["arti"]} for w, info in sorted(all_words.items())]}
with open(OUTPUT, "w") as f:
    json.dump(output, f, ensure_ascii=False)
print(f"\nWritten: {OUTPUT} ({len(all_words)} entries)")
