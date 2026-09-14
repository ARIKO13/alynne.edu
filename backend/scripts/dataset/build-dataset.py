#!/usr/bin/env python3
"""
Build merged dataset_master.json from multiple Indonesian NLP sources.

Sources:
  1. kbbi-dataset-kbbi-v (112K entries with full dictionary metadata)
     -> extract: word keys + bentuk_tidak_baku + varian (non-standard → standard mappings)
  2. indonlu (34MB of Twitter sentiment + NER datasets)
     -> extract: unique sosmed words NOT in KBBI (these are valid slang/informal)
  3. Existing stt-dictionary.json on VPS (192K KBBI + 520 slang + 72 fixes)
     -> merge as baseline (already has the largest KBBI set)
  4. Hardcoded techTerms + stockTickers + phraseMap (from stt-dictionary.ts)
     -> add as overrides

Output: dataset_master.json with structure:
  {
    "k": "word1|word2|...",                          // KBBI + sosmed unique words (pipe-sep)
    "e": "...",                                      // English words (from existing)
    "sid": { "slang1": {"f":"formal1","m":""}, ... }, // slang → formal (with new bentuk_tidak_baku)
    "sen": { ... },                                  // English slang (from existing)
    "fix": { "wrong1": "right1", ... },              // direct fixes (with new varian + bentuk_tidak_baku)
    "rem": ["particle1", ...],                       // remove particles
    "hom": [...]                                     // homophones
  }
"""
import json, os, sys, csv, re
from pathlib import Path
from collections import defaultdict

DATASETS = Path("/home/z/alynne-clone/.datasets")
OUTPUT = Path("/home/z/alynne-clone/.deploy/dataset_master.json")

# ─── Load existing VPS dictionary as baseline ───
# We don't have it locally, but we know its structure.
# We'll build from scratch and the VPS will use this new file.

print("=" * 70)
print("DATASET MERGE SCRIPT — IndoCollex equivalent + KBBI + IndoNLU")
print("=" * 70)

# ─── 1. Process KBBI dataset (158MB, 4 JSON parts, 112,645 entries) ───
print("\n[1/4] Processing KBBI dataset (kbbi-dataset-kbbi-v)...")
kbbi_words = set()           # all valid KBBI words (the dictionary keys)
bentuk_tidak_baku_map = {}  # non-standard form → standard form
varian_map = {}              # variant spelling → standard form
total_entries = 0

for part in [1, 2, 3, 4]:
    path = DATASETS / "kbbi-dataset-kbbi-v" / "json" / f"kbbi_v_part{part}.json"
    if not path.exists():
        print(f"  ✗ Missing: {path}")
        continue
    print(f"  Loading part {part}...")
    with open(path) as f:
        data = json.load(f)
    total_entries += len(data)
    for word, entry in data.items():
        # The word key itself might have parentheses (like "(air) susu") — skip those
        clean_word = re.sub(r"[()]", "", word).strip().lower()
        if not clean_word or " " in clean_word or len(clean_word) < 2:
            continue
        kbbi_words.add(clean_word)

        # Extract bentuk_tidak_baku (non-standard forms)
        try:
            entri = entry.get("data", {}).get("entri", [])
            for e in entri:
                # The canonical form
                nama = e.get("nama", "").strip().lower()
                if nama and " " not in nama:
                    kbbi_words.add(nama)
                # Non-standard forms → map to canonical
                for btb in e.get("bentuk_tidak_baku", []):
                    btb_lower = btb.strip().lower()
                    if btb_lower and btb_lower != nama and " " not in btb_lower:
                        bentuk_tidak_baku_map[btb_lower] = nama
                # Variants → map to canonical
                for var in e.get("varian", []):
                    var_lower = var.strip().lower()
                    if var_lower and var_lower != nama and " " not in var_lower:
                        varian_map[var_lower] = nama
        except (AttributeError, TypeError):
            continue

print(f"  ✓ Total KBBI entries processed: {total_entries:,}")
print(f"  ✓ Unique KBBI words extracted: {len(kbbi_words):,}")
print(f"  ✓ Bentuk tidak baku mappings: {len(bentuk_tidak_baku_map):,}")
print(f"  ✓ Varian mappings: {len(varian_map):,}")
print(f"  ✓ Sample bentuk_tidak_baku: {list(bentuk_tidak_baku_map.items())[:5]}")
print(f"  ✓ Sample varian: {list(varian_map.items())[:5]}")

# ─── 2. Process IndoNLU datasets (extract sosmed unique words) ───
print("\n[2/4] Processing IndoNLU datasets (sosmed unique words)...")
sosmed_words = set()
indonlu_path = DATASETS / "indonlu" / "dataset"
if indonlu_path.exists():
    file_count = 0
    for root, dirs, files in os.walk(indonlu_path):
        for fname in files:
            if fname.endswith((".txt", ".csv", ".tsv")):
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, encoding="utf-8", errors="ignore") as f:
                        for line in f:
                            # Split on whitespace + punctuation
                            tokens = re.findall(r"\b[a-zA-Z]+\b", line.lower())
                            for tok in tokens:
                                if len(tok) >= 2:
                                    sosmed_words.add(tok)
                    file_count += 1
                except Exception as e:
                    pass
    print(f"  ✓ Processed {file_count} files")
    print(f"  ✓ Total unique sosmed words: {len(sosmed_words):,}")
    # Filter: words that are NOT in KBBI (these are likely slang/informal)
    slang_only = sosmed_words - kbbi_words
    print(f"  ✓ Sosmed words NOT in KBBI (likely slang): {len(slang_only):,}")
    print(f"  ✓ Sample sosmed-only: {sorted(list(slang_only))[:15]}")
else:
    print("  ✗ IndoNLU dataset folder not found")

# ─── 3. Hardcoded additions (techTerms + stockTickers + phraseMap) ───
print("\n[3/4] Adding hardcoded techTerms + stockTickers + phraseMap...")

tech_terms_list = [
    "ai", "api", "app", "software", "hardware", "database", "server",
    "client", "frontend", "backend", "framework", "library", "plugin",
    "machine", "learning", "deep", "neural", "natural", "language",
    "processing", "nlp", "llm", "gpt", "transformer", "model",
    "training", "dataset", "prompt", "token", "inference", "embedding",
    "rag", "whisper", "groq", "llama", "claude", "gemini",
    "html", "css", "javascript", "typescript", "react", "vue",
    "node", "python", "java", "php", "sql", "json", "xml", "http",
    "google", "microsoft", "apple", "amazon", "meta",
    "gpu", "cpu", "ram", "ssd", "hdd", "iot", "kbbi", "uv",
    "fotosintesis", "kloroplas", "klorofil", "parabola", "percepatan",
    "kecepatan", "momentum", "gaya", "joule", "watt", "volt", "ampere",
    "frekuensi", "amplitudo", "refraksi", "refleksi", "difraksi",
    "molekul", "atom", "ion", "elektron", "proton", "neutron", "isotop",
    "senyawa", "larutan", "asam", "basa", "mol", "molaritas",
    "oksidasi", "reduksi", "elektrolisis", "hidrogen", "oksigen",
    "enzim", "protein", "karbohidrat", "lipid",
    "trigonometri", "sinus", "kosinus", "tangen", "hipotenusa",
    "integral", "diferensial", "limit", "turunan", "fungsi",
    "persamaan", "matriks", "determinan", "vektor", "skalar",
    "pythagoras", "aljabar", "geometri",
    "arduino", "goto", "saham", "bullish", "bearish",
    "candlestick", "breakout", "support", "resistance",
]
stock_tickers_list = [
    "GOTO", "BBCA", "BBRI", "BBNI", "BMRI", "TLKM", "ASII", "UNVR",
    "INDY", "MARI", "ANTM", "INCO", "KRAS", "MYOH", "KLBF", "GGRM",
    "ICBP", "INDF", "CPIN", "JPFA", "TPIA", "ADRO", "PGAS", "MEDC",
    "MAIN", "SMRA", "BSDE", "CTRA", "LPKR", "ASRI", "AMMN", "MPPA",
    "BFIN", "TBIG", "EXCL", "ISAT", "MNCN", "LION", "BNGA", "BBTN",
]
phrase_map = {
    "go to": "GOTO", "go 2": "GOTO", "goto": "GOTO",
    "be ca a": "BBCA", "be be ca a": "BBCA", "be be ri": "BBRI",
    "be be ni": "BBNI", "be em ri": "BMRI", "be em ar i": "BMRI",
    "t l k m": "TLKM", "a s i i": "ASII", "mar i": "MARI",
    "antm": "ANTM", "inco": "INCO", "kras": "KRAS", "myoh": "MYOH",
    "klbf": "KLBF", "ggrm": "GGRM", "icbp": "ICBP", "indf": "INDF",
    "cpin": "CPIN", "jpfa": "JPFA", "tpia": "TPIA", "adro": "ADRO",
    "pgas": "PGAS", "medc": "MEDC", "main": "MAIN", "smra": "SMRA",
    "bsde": "BSDE", "ctra": "CTRA", "lpkr": "LPKR", "asri": "ASRI",
    "ammn": "AMMN", "mppa": "MPPA", "bfin": "BFIN", "tbig": "TBIG",
    "excl": "EXCL", "isat": "ISAT", "mncn": "MNCN", "lion": "LION",
    "bnga": "BNGA", "bbtn": "BBTN",
}

# Add tech terms to kbbi_words set
for term in tech_terms_list:
    kbbi_words.add(term.lower())
# Add stock tickers (uppercase preserved as valid words)
for ticker in stock_tickers_list:
    kbbi_words.add(ticker.lower())

print(f"  ✓ techTerms added: {len(tech_terms_list)}")
print(f"  ✓ stockTickers added: {len(stock_tickers_list)}")
print(f"  ✓ phraseMap entries: {len(phrase_map)}")

# ─── 4. Build merged fix map (bentuk_tidak_baku + varian + manual fixes) ───
print("\n[4/4] Building merged fix map...")
fix_map = {}
# Add bentuk_tidak_baku (non-standard → standard)
fix_map.update(bentuk_tidak_baku_map)
# Add varian (variant spelling → standard)
fix_map.update(varian_map)
# Add manual fixes (from existing fbFixes in stt-dictionary.ts)
manual_fixes = {
    "sistim": "sistem", "metoda": "metode", "strateji": "strategi",
    "difinisi": "definisi", "annalisa": "analisis", "analisa": "analisis",
    "produktifitas": "produktivitas", "hipotesa": "hipotesis",
    "algoritm": "algoritma", "ngapain": "mengapa",
    "niyang": "yang", "iyang": "yang", "nyang": "yang",
    "diyang": "di yang", "neng": "dengan",
}
fix_map.update(manual_fixes)
print(f"  ✓ Total fix_map entries: {len(fix_map):,} (bentuk_tidak_baku + varian + manual)")

# Add sosmed-only words to a separate set (so they're considered valid,
# not flagged as unknown, but don't pollute the KBBI set)
# These are valid informal words — we add them to the kbbi set for fuzzy matching purposes
for w in sosmed_words:
    if len(w) >= 3:
        kbbi_words.add(w)

# ─── Build slang → formal map (sid) ───
# From the existing 520 + manual fbSlang
fb_slang = {
    "nggak": "tidak", "ngga": "tidak", "gak": "tidak", "ga": "tidak",
    "ndak": "tidak", "kagak": "tidak", "dah": "sudah", "udah": "sudah",
    "gitu": "begitu", "kalo": "kalau", "klo": "kalau",
    "gimana": "bagaimana", "gmn": "bagaimana", "bener": "benar",
    "bgt": "sangat", "ngomong": "berbicara", "bikin": "membuat",
    "ngerti": "mengerti", "mulu": "terus", "doang": "saja",
    "bilang": "mengatakan", "tau": "tahu", "pengen": "ingin",
    "mo": "mau", "bakal": "akan", "gemana": "bagaimana",
    "nggmana": "bagaimana", "niyang": "yang", "iyang": "yang",
    "nyang": "yang", "neng": "dengan", "deng": "dengan",
    "beneran": "benar-benar", "nonton": "menonton", "dateng": "datang",
    "napa": "kenapa", "yah": "ya", "udh": "sudah", "nih": "ini",
    "tuh": "itu", "gini": "begini", "emang": "memang",
    "wkwk": "tertawa", "haha": "tertawa", "hihi": "tertawa",
}
sid_map = {k: {"f": v, "m": ""} for k, v in fb_slang.items()}

# ─── English words (from existing data file — we'll keep the existing field) ───
# Since we don't have the English word list locally, we'll signal the merger
# to PRESERVE the existing `e` field on the VPS when merging.
en_words_str = ""  # Will be filled by VPS merge script

# ─── Final output ───
print("\n" + "=" * 70)
print("BUILDING FINAL dataset_master.json")
print("=" * 70)

# Build pipe-separated k field (like the existing format)
kbbi_pipe = "|".join(sorted(kbbi_words))
print(f"  k (KBBI + sosmed + tech + tickers): {len(kbbi_words):,} words")

# Save as JSON
output = {
    "_v": "3.0",
    "_s": "merged: kbbi-v (112K) + indonlu sosmed + tech + tickers + slang",
    "k": kbbi_pipe,
    "e": en_words_str,  # preserved from existing on VPS
    "sid": sid_map,
    "sen": {},  # preserved from existing on VPS
    "fix": fix_map,
    "rem": ["dong", "sih", "deh", "loh", "toh"],
    "hom": [],  # preserved from existing on VPS
    "phrase_map": phrase_map,  # NEW field for multi-word phrases
    "_stats": {
        "kbbi_entries_source": total_entries,
        "kbbi_unique_words": len(kbbi_words),
        "bentuk_tidak_baku_mappings": len(bentuk_tidak_baku_map),
        "varian_mappings": len(varian_map),
        "sosmed_unique_words": len(sosmed_words),
        "tech_terms": len(tech_terms_list),
        "stock_tickers": len(stock_tickers_list),
        "phrase_map_entries": len(phrase_map),
        "slang_entries": len(sid_map),
        "fix_entries": len(fix_map),
        "total_unique_words_in_k": len(kbbi_words),
    },
}

# Write to file
OUTPUT.write_text(json.dumps(output, ensure_ascii=False))
print(f"\n  ✓ Output written to: {OUTPUT}")
print(f"  ✓ File size: {OUTPUT.stat().st_size / 1024 / 1024:.2f} MB")
print(f"\n  Stats: {json.dumps(output['_stats'], indent=2)}")
