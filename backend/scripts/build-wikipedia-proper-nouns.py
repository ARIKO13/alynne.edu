#!/usr/bin/env python3
"""
Fetch Indonesian proper nouns from Wikipedia REST API (id.wikipedia.org).

Uses categorymembers API to recursively harvest page titles from curated
Wikipedia categories (Tokoh, Kota, Universitas, Gunung, Sungai, etc.).

Output: /home/z/my-project/alynne.edu/backend/data/datasets/wikipedia-proper-nouns.json

Format:
  {"_version":"1.0-wikipedia","terms":[
    {"word":"soekarno","domain":"sejarah","phonetic_variations":["sukarno"]},
    {"word":"jakarta","domain":"geografi","phonetic_variations":[]}
  ]}

Strategy:
  1. Define root categories with domain mapping (sejarah/geografi/pendidikan/...)
  2. Recursively fetch cmtype=subcat|page (depth=2) to harvest thousands of titles
  3. Clean titles (strip disambiguation, "Daftar ", namespace prefixes)
  4. Skip non-proper-nouns (dates, numbers, file pages)
  5. Generate Indonesian-specific phonetic variations:
     - Old Dutch spelling  → modern (oe→u, dj→j, tj→c, ch→kh)
     - Modern → old (j→y: Jogja→Yogja, Surabaja)
     - Hyphen/space variations
  6. Deduplicate (case-insensitive) and write JSON
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

# ============================================================
# CONFIG
# ============================================================
OUTPUT = Path("/home/z/my-project/alynne.edu/backend/data/datasets/wikipedia-proper-nouns.json")
API_BASE = "https://id.wikipedia.org/w/api.php"
USER_AGENT = "AlynneEDU/1.0 (https://alynne.edu; research@alynne.edu) python-urllib/3.12"
RECURSION_DEPTH = 2          # how deep to recurse into subcategories
MAX_PAGES_PER_CATEGORY = 600  # safety cap per top-level category (avoid runaway)
SLEEP_BETWEEN_CALLS = 0.10    # be polite to Wikipedia (≤10 req/s)
TIMEOUT_SECONDS = 30
MAX_RETRIES = 3

# ============================================================
# ROOT CATEGORIES → (domain, type)
#   domain: sejarah / geografi / pendidikan / ekonomi / budaya /
#           seni / olahraga / politik / bahasa / sains
#   type:   tokoh / tempat / organisasi / karya / konsep  (for filtering, not stored)
# ============================================================
ROOT_CATEGORIES = [
    # Tokoh / Sejarah
    ("Kategori:Tokoh_Indonesia",              "sejarah"),
    ("Kategori:Tokoh_sejarah_Indonesia",      "sejarah"),
    ("Kategori:Pahlawan_nasional_Indonesia",  "sejarah"),
    ("Kategori:Presiden_Indonesia",           "sejarah"),
    ("Kategori:Wakil_Presiden_Indonesia",     "sejarah"),
    ("Kategori:Wali_Songo",                   "sejarah"),
    ("Kategori:Tokoh_pendirian_Indonesia",    "sejarah"),

    # Geografi
    ("Kategori:Kota_di_Indonesia",                  "geografi"),
    ("Kategori:Kabupaten_di_Indonesia",             "geografi"),
    ("Kategori:Provinsi_di_Indonesia",              "geografi"),
    ("Kategori:Ibu_kota_provinsi_di_Indonesia",     "geografi"),
    ("Kategori:Pulau_di_Indonesia",                 "geografi"),
    ("Kategori:Gunung_di_Indonesia",                "geografi"),
    ("Kategori:Sungai_di_Indonesia",                "geografi"),
    ("Kategori:Danau_di_Indonesia",                 "geografi"),
    ("Kategori:Kabupaten_dan_kota_di_Indonesia_menurut_provinsi", "geografi"),
    ("Kategori:Selat_di_Indonesia",                 "geografi"),
    ("Kategori:Teluk_di_Indonesia",                 "geografi"),
    ("Kategori:Samudra",                            "geografi"),

    # Pendidikan / Organisasi
    ("Kategori:Universitas_di_Indonesia",           "pendidikan"),
    ("Kategori:Institut_di_Indonesia",              "pendidikan"),
    ("Kategori:Sekolah_di_Indonesia",               "pendidikan"),
    ("Kategori:Politeknik_di_Indonesia",            "pendidikan"),
    ("Kategori:Universitas_swasta_di_Indonesia",    "pendidikan"),
    ("Kategori:Universitas_negeri_di_Indonesia",    "pendidikan"),

    # Ekonomi / Organisasi
    ("Kategori:Perusahaan_Indonesia",               "ekonomi"),
    ("Kategori:Perusahaan_penerbangan_Indonesia",   "ekonomi"),
    ("Kategori:Bank_Indonesia",                     "ekonomi"),
    ("Kategori:BUMN",                               "ekonomi"),
    ("Kategori:Konglomerat_Indonesia",              "ekonomi"),

    # Budaya
    ("Kategori:Budaya_Indonesia",                   "budaya"),
    ("Kategori:Makanan_Indonesia",                  "budaya"),
    ("Kategori:Minuman_Indonesia",                  "budaya"),
    ("Kategori:Tarian_tradisional_Indonesia",       "budaya"),
    ("Kategori:Alat_musik_tradisional_Indonesia",   "budaya"),
    ("Kategori:Upacara_adat_di_Indonesia",          "budaya"),
    ("Kategori:Suku_bangsa_di_Indonesia",           "budaya"),
    ("Kategori:Bahasa_di_Indonesia",                "bahasa"),

    # Seni
    ("Kategori:Film_Indonesia",                     "seni"),
    ("Kategori:Musik_Indonesia",                    "seni"),
    ("Kategori:Aktor_Indonesia",                    "seni"),
    ("Kategori:Aktris_Indonesia",                   "seni"),
    ("Kategori:Penyanyi_Indonesia",                 "seni"),
    ("Kategori:Grup_musik_Indonesia",               "seni"),

    # Olahraga
    ("Kategori:Olahraga_Indonesia",                 "olahraga"),
    ("Kategori:Pemain_sepak_bola_Indonesia",        "olahraga"),
    ("Kategori:Atlet_Indonesia",                    "olahraga"),
    ("Kategori:Pemain_bulu_tangkis_Indonesia",      "olahraga"),
    ("Kategori:Klub_sepak_bola_Indonesia",          "olahraga"),

    # Politik
    ("Kategori:Politik_Indonesia",                  "politik"),
    ("Kategori:Partai_politik_di_Indonesia",        "politik"),
    ("Kategori:Menteri_Indonesia",                  "politik"),
    ("Kategori:Gubernur_Indonesia",                 "politik"),
    ("Kategori:Bupati_Indonesia",                   "politik"),

    # Sains / Misc
    ("Kategori:Sejarah_Indonesia",                  "sejarah"),
]


# ============================================================
# HTTP helper
# ============================================================
def api_get(params, retry=0):
    """GET Wikipedia API with retries."""
    qs = urllib.parse.urlencode(params)
    url = f"{API_BASE}?{qs}"
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Accept-Language": "id,en;q=0.9",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (429, 503) and retry < MAX_RETRIES:
            wait = 2 ** retry
            print(f"    ⚠ HTTP {e.code}, retrying in {wait}s…")
            time.sleep(wait)
            return api_get(params, retry + 1)
        print(f"    ✗ HTTP {e.code} for {url[:120]}")
        return None
    except (urllib.error.URLError, TimeoutError) as e:
        if retry < MAX_RETRIES:
            wait = 2 ** retry
            print(f"    ⚠ {e.__class__.__name__}, retrying in {wait}s…")
            time.sleep(wait)
            return api_get(params, retry + 1)
        print(f"    ✗ {e} for {url[:120]}")
        return None


# ============================================================
# Category harvest
# ============================================================
def fetch_category_members(category, depth, stats, seen_pages, seen_subcats):
    """Recursively fetch pages (ns=0) and subcategories (ns=14) from a category.

    Returns list of (title, domain_hint) tuples for ns=0 pages only.
    """
    out = []
    cmcontinue = None
    page_count = 0

    while True:
        params = {
            "action": "query",
            "list": "categorymembers",
            "cmtitle": category,
            "cmlimit": "500",
            "cmtype": "page|subcat",
            "format": "json",
        }
        if cmcontinue:
            params["cmcontinue"] = cmcontinue

        data = api_get(params)
        if not data or "query" not in data:
            break

        for m in data["query"].get("categorymembers", []):
            ns = m.get("ns")
            title = m.get("title", "")
            if ns == 0:
                if title not in seen_pages:
                    seen_pages.add(title)
                    out.append(title)
                    page_count += 1
            elif ns == 14 and depth > 0 and title not in seen_subcats:
                seen_subcats.add(title)
                # Recurse one level deeper
                time.sleep(SLEEP_BETWEEN_CALLS)
                sub_out = fetch_category_members(title, depth - 1, stats, seen_pages, seen_subcats)
                out.extend(sub_out)

        cont = data.get("continue")
        if cont and "cmcontinue" in cont:
            cmcontinue = cont["cmcontinue"]
            time.sleep(SLEEP_BETWEEN_CALLS)
        else:
            break

    stats["pages_total"] += page_count
    return out


# ============================================================
# Title cleaning & filtering
# ============================================================
NS_PREFIXES_TO_DROP = (
    "Kategori:", "Berkas:", "File:", "Templat:", "Template:",
    "Wikipedia:", "Help:", "Bantuan:", "Portal:", "Modul:",
    "Pembicaraan", "Diskusi", "Special:",
)

DISAMBIG_PREFIXES = ("Daftar ", "Daftar—", "Daftar—")

# Words/titles to skip (not proper nouns, or too generic)
SKIP_TITLES_LOWER = {
    "indonesia", "nusantara", "bahasa indonesia", "wikipedia",
    "halaman utama", "kategori", "templat", "berkas", "portal",
    "dasar", "lihat pula", "rujukan", "pranala luar", "bibliografi",
    "kategori tersembunyi", "halaman istimewa", "perubahan terbaru",
    "versi Mobile", "versi mobile", "kontroversi", "skandal",
}


def clean_title(title):
    """Clean a Wikipedia page title into a proper-noun candidate.

    Returns lowercase word (with spaces preserved as underscore) or None.
    """
    if not title or not isinstance(title, str):
        return None

    title = title.strip()

    # Drop namespace/non-article pages
    for pfx in NS_PREFIXES_TO_DROP:
        if title.startswith(pfx):
            return None

    # Drop "Daftar ..." titles — these are list articles, not proper nouns
    for pfx in DISAMBIG_PREFIXES:
        if title.startswith(pfx):
            # BUT, if it's "Daftar tokoh X" maybe useful — for now skip
            return None

    # Remove trailing disambiguation in parentheses:
    #   "Joko Widodo" → keep
    #   "Merapi (gunung)" → "Merapi"
    #   "Bali (disambiguasi)" → skip
    if "(disambiguasi)" in title.lower() or "(disambiguation)" in title.lower():
        return None
    title = re.sub(r"\s*\([^)]*\)\s*$", "", title)

    # Skip pure numbers / years (e.g. "1945", "2019")
    if re.fullmatch(r"\d{1,4}(-\d{1,4})?", title):
        return None

    # Skip if it contains slash (subpages like "Pancasila/Prinsip")
    if "/" in title:
        return None

    # Skip if it's a URL or starts with http
    if title.lower().startswith(("http://", "https://", "www.")):
        return None

    # Skip very short titles (<3 chars)
    if len(title) < 3:
        return None

    # Skip if starts with digit and looks like a date
    if re.match(r"^\d{1,2}\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)", title, re.IGNORECASE):
        return None

    # Skip generic words
    if title.lower() in SKIP_TITLES_LOWER:
        return None

    # Allow letters (incl. accented), digits, spaces, hyphens, apostrophes
    if not re.match(r"^[A-Za-zÀ-ÿ\u00C0-\u024F0-9'’\- ]+$", title):
        return None

    # Normalize whitespace
    title = re.sub(r"\s+", " ", title).strip()
    return title


def word_key(title):
    """Lowercase, space→underscore form for the JSON 'word' field."""
    return title.lower().replace(" ", "_")


# ============================================================
# Indonesian-specific phonetic variations
# ============================================================
# Indonesian alphabet spell-out (for acronyms)
ALPHABET_ID = {
    "a": "a", "b": "be", "c": "ce", "d": "de", "e": "e",
    "f": "ef", "g": "ge", "h": "ha", "i": "i", "j": "je",
    "k": "ka", "l": "el", "m": "em", "n": "en", "o": "o",
    "p": "pe", "q": "ki", "r": "er", "s": "es", "t": "te",
    "u": "u", "v": "fe", "w": "we", "x": "eks", "y": "ye",
    "z": "zet",
}


def gen_phonetic_variations(word):
    """Generate Indonesian-specific phonetic variations of a proper noun.

    Rules (kept conservative — only high-confidence variations):
      1. Old Dutch spelling → modern Indonesian
         - oe → u  (Soekarno → Sukarno, Soeharto → Suharto)
         - dj → j  (Djakarta → Jakarta, Djawa → Jawa)
         - tj → c  (Tjirebon → Cirebon)
         - ch → kh (Tjilih → Cilih? actually ch→kh: Boedi → Budi? no, ch→k)
      2. Modern Indonesian → old spelling (reverse direction, useful for STT)
         - j → y  (Jogja → Yogja; Surabaja → Surabaya)
         - c → tj (Cirebon → Tjirebon)
      3. Common typographic:
         - hyphen ↔ space ↔ concatenated (e.g., "Wali_Songo" ↔ "Wali Songo" ↔ "WaliSongo")
      4. Acronym spell-out (only for short all-caps tokens, 2–5 letters)
         - UI → "u i", ITB → "i te be"
    """
    variations = set()
    # work on display form (underscore → space, then back at end)
    display = word.replace("_", " ")
    lowered = display.lower()

    # 1. Old spelling → modern
    if "oe" in lowered:
        variations.add(lowered.replace("oe", "u"))
    if "dj" in lowered:
        variations.add(lowered.replace("dj", "j"))
    if "tj" in lowered:
        variations.add(lowered.replace("tj", "c"))
    # ch → kh is rare and noisy; only apply if word starts with "ch"
    if lowered.startswith("ch"):
        variations.add("kh" + lowered[2:])

    # 2. Modern → old spelling (reverse)
    # j → y is very common for Jogja/Yogja, Surabaja/Surabaya
    if "j" in lowered and "dj" not in lowered:
        new = lowered.replace("j", "y")
        if new != lowered:
            variations.add(new)
    # c → tj at start of word (less common, but Cirebon ↔ Tjirebon)
    if lowered.startswith("c") and "tj" not in lowered:
        variations.add("tj" + lowered[1:])

    # 3. Hyphen / space variations
    if "-" in display:
        variations.add(display.replace("-", " "))
        variations.add(display.replace("-", ""))
    if " " in display:
        variations.add(display.replace(" ", ""))
        variations.add(display.replace(" ", "-"))

    # 4. Acronym spell-out (only when the original was ALL CAPS short)
    # Detect by checking if word is all uppercase letters (after stripping non-alpha)
    alpha = re.sub(r"[^A-Za-z]", "", display)
    if 2 <= len(alpha) <= 5 and display.isupper():
        spelled = " ".join(ALPHABET_ID.get(c, c) for c in alpha.lower())
        variations.add(spelled)
        variations.add(spelled.replace(" ", ""))
        variations.add("-".join(ALPHABET_ID.get(c, c) for c in alpha.lower()))

    # Convert all variations to underscore form & filter out the word itself
    cleaned = set()
    for v in variations:
        v_norm = v.strip().replace(" ", "_").lower()
        if v_norm and v_norm != word and v_norm != display.lower():
            cleaned.add(v_norm)
    return sorted(cleaned)


# ============================================================
# Main
# ============================================================
def write_output(word_to_domain, word_to_variations, stats, partial=False):
    """Write (or overwrite) the output JSON file with current harvest state."""
    terms = []
    for wkey in sorted(word_to_domain.keys()):
        terms.append({
            "word": wkey,
            "domain": word_to_domain[wkey],
            "phonetic_variations": word_to_variations.get(wkey, []),
        })
    payload = {
        "_version": "1.0-wikipedia" + ("-partial" if partial else ""),
        "_description": "Indonesian proper nouns (tokoh, tempat, organisasi) harvested from id.wikipedia.org categorymembers API",
        "_generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "_source": "https://id.wikipedia.org/w/api.php (categorymembers, depth=2)",
        "_total_entries": len(terms),
        "terms": terms,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUTPUT.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    tmp.replace(OUTPUT)
    return len(terms)


def main():
    print("=" * 70)
    print("Wikipedia Indonesia Proper Nouns Harvester")
    print("=" * 70)
    print(f"Output:        {OUTPUT}")
    print(f"Depth:         {RECURSION_DEPTH}")
    print(f"Root cats:     {len(ROOT_CATEGORIES)}")
    print(f"[i] Incremental save after each category (file is always usable)")
    print()

    seen_pages = set()       # to dedupe across categories
    seen_subcats = set()     # to avoid revisiting subcats
    word_to_domain = {}      # word_key → domain
    word_to_variations = {}  # word_key → set of variations
    stats = {"pages_total": 0}

    total_root = len(ROOT_CATEGORIES)
    for idx, (cat, domain) in enumerate(ROOT_CATEGORIES, 1):
        print(f"[{idx}/{total_root}] {cat}  (domain={domain})", flush=True)
        try:
            titles = fetch_category_members(
                cat, RECURSION_DEPTH, stats, seen_pages, seen_subcats
            )
        except Exception as e:
            print(f"    ✗ Failed: {e}", flush=True)
            titles = []

        added = 0
        for title in titles:
            cleaned = clean_title(title)
            if not cleaned:
                continue
            wkey = word_key(cleaned)
            if not wkey or wkey in word_to_domain:
                continue
            word_to_domain[wkey] = domain
            word_to_variations[wkey] = gen_phonetic_variations(wkey)
            added += 1
        print(f"    ✓ harvested={len(titles):4d}  added={added:4d}  "
              f"(total unique={len(word_to_domain)})  "
              f"[pages_seen={stats['pages_total']}]", flush=True)

        # Incremental save — file is always in a usable state.
        write_output(word_to_domain, word_to_variations, stats, partial=True)
        time.sleep(SLEEP_BETWEEN_CALLS)

    # Build terms list, sorted alphabetically
    print()
    print("=" * 70)
    print(f"Total unique proper nouns: {len(word_to_domain)}")
    print("=" * 70)

    # Final write (mark non-partial)
    n = write_output(word_to_domain, word_to_variations, stats, partial=False)
    terms = [{"word": w, "domain": word_to_domain[w], "phonetic_variations": word_to_variations.get(w, [])}
             for w in sorted(word_to_domain.keys())]

    size_kb = OUTPUT.stat().st_size / 1024
    print(f"\n✓ Wrote: {OUTPUT}")
    print(f"  Size: {size_kb:.1f} KB")
    print(f"  Terms: {n}")
    print(f"  Total API pages seen: {stats['pages_total']}")

    # Sample
    print("\nSample terms (first 15):")
    for t in terms[:15]:
        pv = t["phonetic_variations"]
        pv_str = f" [{', '.join(pv[:3])}{'…' if len(pv)>3 else ''}]" if pv else ""
        print(f"  {t['domain']:10s}  {t['word']}{pv_str}")

    # Domain breakdown
    domain_counts = defaultdict(int)
    for t in terms:
        domain_counts[t["domain"]] += 1
    print("\nDomain breakdown:")
    for d, c in sorted(domain_counts.items(), key=lambda x: -x[1]):
        print(f"  {d:12s}  {c}")

    # Variation coverage
    with_var = sum(1 for t in terms if t["phonetic_variations"])
    print(f"\nPhonetic variations: {with_var}/{len(terms)} terms have variations "
          f"({100*with_var/len(terms):.1f}%)")


if __name__ == "__main__":
    main()
