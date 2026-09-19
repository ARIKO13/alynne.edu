import json, re, time, urllib.request, urllib.parse
from pathlib import Path

OUTPUT = Path("/root/lina-learning/backend/data/datasets/wiki-daerah-slow.json")
all_words = {}

def add_word(word, bahasa):
    w = word.strip().lower()
    if not w or len(w) < 3 or len(w) > 50: return
    if not re.match(r"^[a-z\-\s]+$", w): return
    if w not in all_words:
        all_words[w] = bahasa

def fetch_with_retry(url, max_retries=3):
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ALYNNE-Edu-Bot/2.0 (STT project; admin@alynne.my.id)"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read())
        except Exception as e:
            if "429" in str(e):
                wait = 10 * (attempt + 1)
                print(f"      429 — waiting {wait}s...")
                time.sleep(wait)
            else:
                return None
    return None

def fetch_allpages(lang, bahasa, max_pages=5000):
    total = 0
    apcont = None
    while total < max_pages:
        url = f"https://{lang}.wikipedia.org/w/api.php?action=query&list=allpages&aplimit=500&apnamespace=0&format=json"
        if apcont:
            url += f"&apcontinue={urllib.parse.quote(apcont)}"
        data = fetch_with_retry(url)
        if not data: break
        pages = data.get("query", {}).get("allpages", [])
        for p in pages:
            t = re.sub(r'[^a-zA-Z\s\-]', '', p.get("title", "")).lower().strip()
            if t and len(t) >= 3:
                add_word(t.replace(' ', '_'), bahasa)
                total += 1
        apcont = data.get("continue", {}).get("apcontinue")
        if not apcont: break
        time.sleep(3)  # 3s delay between requests
    return total

LANGS = [
    ("jv", "jawa", 10000),
    ("su", "sunda", 10000),
    ("min", "minang", 5000),
    ("bug", "bugis", 3000),
    ("ban", "bali", 3000),
    ("ace", "aceh", 2000),
    ("map-bms", "banyumasan", 2000),
    ("bjn", "banjar", 1500),
    ("gor", "gorontalo", 500),
    ("nia", "nias", 500),
]

print("Fetching Wikipedia dengan 3s delay + retry...")
for lang, bahasa, max_p in LANGS:
    print(f"  {bahasa} ({lang})...", end=" ", flush=True)
    c = fetch_allpages(lang, bahasa, max_p)
    print(f"{c} entries")
    time.sleep(5)

print(f"\nTotal: {len(all_words)}")
counts = {}
for w, b in all_words.items():
    counts[b] = counts.get(b, 0) + 1
for b, c in sorted(counts.items(), key=lambda x: -x[1]):
    print(f"  {b:15s}: {c:>6}")

output = {"_version": "1.0-slow", "terms": [{"word": w, "domain": f"daerah_{b}"} for w, b in sorted(all_words.items())]}
with open(OUTPUT, "w") as f:
    json.dump(output, f)
print(f"\nWritten: {OUTPUT} ({len(all_words)} entries)")
