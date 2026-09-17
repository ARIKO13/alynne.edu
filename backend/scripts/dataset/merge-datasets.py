#!/usr/bin/env python3
"""
MERGE script — combine existing VPS dictionary with new datasets.

Existing VPS (192K KBBI + 125K EN + 520 slang + 72 fixes) is the BASELINE.
We ADD:
  - 36K sosmed words from IndoNLU (filtered — no junk like "aaa")
  - 2,991 bentuk_tidak_baku mappings from kbbi-dataset-kbbi-v
  - 57 varian mappings
  - 42 phrase_map entries (stock tickers)
  - 130 tech terms
  - 40 stock tickers
  - 45 manual slang

We DON'T replace — only augment. Result is a superset.
"""
import json, re
from pathlib import Path

DEPLOY = Path("/home/z/alynne-clone/.deploy")
DATASETS = Path("/home/z/alynne-clone/.datasets")

print("=" * 70)
print("MERGE: VPS existing + new datasets")
print("=" * 70)

# ── 1. Load existing VPS dictionary as baseline ──
print("\n[1] Loading existing VPS dictionary (3.19 MB)...")
with open(DEPLOY / "vps-existing-dictionary.json") as f:
    vps = json.load(f)

kbbi_set = set(vps.get("k", "").split("|"))
en_set = set(vps.get("e", "").split("|"))
sid_map = dict(vps.get("sid", {}))
sen_map = dict(vps.get("sen", {}))
fix_map = dict(vps.get("fix", {}))
rem_set = set(vps.get("rem", []))
hom_list = list(vps.get("hom", []))

print(f"  ✓ Existing: KBBI={len(kbbi_set):,}, EN={len(en_set):,}, sid={len(sid_map):,}, fix={len(fix_map):,}")

# ── 2. Process KBBI dataset — extract bentuk_tidak_baku + varian + new words ──
print("\n[2] Processing kbbi-dataset-kbbi-v (4 JSON parts)...")
new_bentuk_tidak_baku = {}
new_varian = {}
new_kbbi_from_repo = set()
total_entries = 0

for part in [1, 2, 3, 4]:
    path = DATASETS / "kbbi-dataset-kbbi-v" / "json" / f"kbbi_v_part{part}.json"
    if not path.exists():
        continue
    print(f"  Loading part {part}...")
    with open(path) as f:
        data = json.load(f)
    total_entries += len(data)
    for word, entry in data.items():
        # Clean the word (remove parentheses, lowercase)
        clean = re.sub(r"[()]", "", word).strip().lower()
        if clean and " " not in clean and len(clean) >= 2:
            new_kbbi_from_repo.add(clean)
        try:
            entri = entry.get("data", {}).get("entri", [])
            for e in entri:
                nama = e.get("nama", "").strip().lower()
                if nama and " " not in nama and len(nama) >= 2:
                    new_kbbi_from_repo.add(nama)
                for btb in e.get("bentuk_tidak_baku", []):
                    btb_lower = btb.strip().lower()
                    if btb_lower and btb_lower != nama and " " not in btb_lower:
                        new_bentuk_tidak_baku[btb_lower] = nama
                for var in e.get("varian", []):
                    var_lower = var.strip().lower()
                    if var_lower and var_lower != nama and " " not in var_lower:
                        new_varian[var_lower] = nama
        except (AttributeError, TypeError):
            continue

print(f"  ✓ Total entries: {total_entries:,}")
print(f"  ✓ Unique KBBI words from repo: {len(new_kbbi_from_repo):,}")
print(f"  ✓ Bentuk tidak baku: {len(new_bentuk_tidak_baku):,}")
print(f"  ✓ Varian: {len(new_varian):,}")

# ── 3. Process IndoNLU — extract sosmed unique words ──
print("\n[3] Processing IndoNLU datasets (sosmed words)...")
sosmed_words = set()
indonlu_path = DATASETS / "indonlu" / "dataset"
if indonlu_path.exists():
    import os
    file_count = 0
    for root, dirs, files in os.walk(indonlu_path):
        for fname in files:
            if fname.endswith((".txt", ".csv", ".tsv")):
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, encoding="utf-8", errors="ignore") as f:
                        for line in f:
                            tokens = re.findall(r"\b[a-zA-Z]+\b", line.lower())
                            for tok in tokens:
                                if len(tok) >= 3:
                                    sosmed_words.add(tok)
                    file_count += 1
                except Exception:
                    pass
    print(f"  ✓ Processed {file_count} files")
    print(f"  ✓ Raw sosmed words: {len(sosmed_words):,}")

# ── 4. Filter junk from sosmed words ──
print("\n[4] Filtering junk from sosmed words...")

def is_junk(word):
    """Filter out noise words (repeated letters, etc.)"""
    # 3+ same chars in a row (e.g., "aaa", "aaaaaa", "aaah")
    if re.search(r"(.)\1{2,}", word):
        return True
    # All same char (e.g., "aaa", "bb")
    if len(set(word)) == 1 and len(word) > 2:
        return True
    # Too short after filter
    if len(word) < 3:
        return True
    return False

before = len(sosmed_words)
sosmed_words = {w for w in sosmed_words if not is_junk(w)}
print(f"  ✓ Filtered: {before:,} → {len(sosmed_words):,} (removed {before - len(sosmed_words):,} junk)")
print(f"  ✓ Sample (filtered): {sorted(list(sosmed_words))[:15]}")

# ── 5. Add tech terms + stock tickers ──
print("\n[5] Adding tech terms + stock tickers...")
tech_terms = [
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
stock_tickers = [
    "GOTO", "BBCA", "BBRI", "BBNI", "BMRI", "TLKM", "ASII", "UNVR",
    "INDY", "MARI", "ANTM", "INCO", "KRAS", "MYOH", "KLBF", "GGRM",
    "ICBP", "INDF", "CPIN", "JPFA", "TPIA", "ADRO", "PGAS", "MEDC",
    "MAIN", "SMRA", "BSDE", "CTRA", "LPKR", "ASRI", "AMMN", "MPPA",
    "BFIN", "TBIG", "EXCL", "ISAT", "MNCN", "LION", "BNGA", "BBTN",
]
for t in tech_terms:
    kbbi_set.add(t.lower())
for t in stock_tickers:
    kbbi_set.add(t.lower())
print(f"  ✓ Added {len(tech_terms)} tech terms + {len(stock_tickers)} stock tickers")

# ── 6. Add sosmed words to KBBI set ──
print("\n[6] Merging sosmed words into KBBI set...")
before_kbbi = len(kbbi_set)
kbbi_set.update(sosmed_words)
print(f"  ✓ KBBI set: {before_kbbi:,} → {len(kbbi_set):,} (+{len(kbbi_set) - before_kbbi:,} sosmed)")

# ── 7. Merge bentuk_tidak_baku + varian into fix_map ──
print("\n[7] Merging bentuk_tidak_baku + varian into fix_map...")
before_fix = len(fix_map)
fix_map.update(new_bentuk_tidak_baku)
fix_map.update(new_varian)
# Manual additions
manual_fixes = {
    "sistim": "sistem", "metoda": "metode", "strateji": "strategi",
    "difinisi": "definisi", "annalisa": "analisis", "analisa": "analisis",
    "produktifitas": "produktivitas", "hipotesa": "hipotesis",
    "algoritm": "algoritma", "ngapain": "mengapa",
    "niyang": "yang", "iyang": "yang", "nyang": "yang",
    "diyang": "di yang", "neng": "dengan",
}
fix_map.update(manual_fixes)
print(f"  ✓ fix_map: {before_fix:,} → {len(fix_map):,} (+{len(fix_map) - before_fix:,} new mappings)")

# ── 8. Add phrase_map (new field) ──
phrase_map = {
    "go to": "GOTO", "go 2": "GOTO", "goto": "GOTO",
    "be ca a": "BBCA", "be be ca a": "BBCA", "be be ri": "BBRI",
    "be be ni": "BBNI", "be em ri": "BMRI", "be em ar i": "BMRI",
    "t l k m": "TLKM", "a s i i": "ASII", "mar i": "MARI",
    "antm": "ANTM", "inco": "INCO", "kras": "KRAS", "myoh": "MYOH",
    "klbf": "KLBF", "ggrm": "GGRM", "icbp": "ICBP", "indf": "INDF",
    "cpin": "CPIN", "jpfa": "JPFA", "tpia": "TPIA", "adro": "ADRO",
    "pgas": "PGAS", "medc": "MEDC", "smra": "SMRA",
    "bsde": "BSDE", "ctra": "CTRA", "lpkr": "LPKR", "asri": "ASRI",
    "ammn": "AMMN", "mppa": "MPPA", "bfin": "BFIN", "tbig": "TBIG",
    "excl": "EXCL", "isat": "ISAT", "mncn": "MNCN", "lion": "LION",
    "bnga": "BNGA", "bbtn": "BBTN",
}

# ── 9. Build final merged dictionary ──
print("\n[8] Building final merged dictionary...")

# Add manual slang entries that don't exist yet
manual_slang = {
    "nggak": "tidak", "ngga": "tidak", "gak": "tidak", "ga": "tidak",
    "ndak": "tidak", "kagak": "tidak", "dah": "sudah", "udah": "sudah",
    "gitu": "begitu", "kalo": "kalau", "klo": "kalau",
    "gimana": "bagaimana", "gmn": "bagaimana", "bener": "benar",
    "bgt": "sangat", "ngomong": "berbicara", "bikin": "membuat",
    "ngerti": "mengerti", "mulu": "terus", "doang": "saja",
    "bilang": "mengatakan", "tau": "tahu", "pengen": "ingin",
    "mo": "mau", "bakal": "akan", "gemana": "bagaimana",
    "beneran": "benar-benar", "nonton": "menonton", "dateng": "datang",
    "napa": "kenapa", "udh": "sudah", "nih": "ini",
    "tuh": "itu", "gini": "begini", "emang": "memang",
}
before_sid = len(sid_map)
for k, v in manual_slang.items():
    if k not in sid_map:
        sid_map[k] = {"f": v, "m": ""}
print(f"  ✓ sid_map: {before_sid:,} → {len(sid_map):,} (+{len(sid_map) - before_sid:,} new slang)")

# Final output — preserve existing structure + add phrase_map + _stats
final = {
    "_v": "4.0-merged",
    "_s": f"merged: VPS existing (192K KBBI + 125K EN) + kbbi-dataset-kbbi-v ({total_entries} entries) + IndoNLU sosmed ({len(sosmed_words)} filtered) + tech + tickers + phrase_map",
    "k": "|".join(sorted(kbbi_set)),
    "e": vps.get("e", ""),  # preserve existing English words (125K)
    "sid": sid_map,
    "sen": sen_map,  # preserve existing English slang (314)
    "fix": fix_map,
    "rem": list(rem_set),
    "hom": hom_list,
    "phrase_map": phrase_map,  # NEW field
    "_stats": {
        "kbbi_total": len(kbbi_set),
        "english_total": len(en_set),
        "slang_id_total": len(sid_map),
        "slang_en_total": len(sen_map),
        "fix_total": len(fix_map),
        "remove_particles": len(rem_set),
        "homophones": len(hom_list),
        "phrase_map_total": len(phrase_map),
        "sources": {
            "vps_existing_kbbi": 192835,
            "kbbi_repo_entries": total_entries,
            "kbbi_repo_unique_extracted": len(new_kbbi_from_repo),
            "bentuk_tidak_baku_mappings": len(new_bentuk_tidak_baku),
            "varian_mappings": len(new_varian),
            "indonlu_raw_sosmed": before,
            "indonlu_filtered_sosmed": len(sosmed_words),
            "tech_terms": len(tech_terms),
            "stock_tickers": len(stock_tickers),
            "manual_slang_added": len(sid_map) - before_sid,
        },
    },
}

OUTPUT = DEPLOY / "dataset_master.json"
OUTPUT.write_text(json.dumps(final, ensure_ascii=False))
print(f"\n  ✓ Output: {OUTPUT}")
print(f"  ✓ Size: {OUTPUT.stat().st_size / 1024 / 1024:.2f} MB")

print("\n" + "=" * 70)
print("FINAL MERGED STATS")
print("=" * 70)
print(f"  KBBI + sosmed + tech + tickers : {len(kbbi_set):>8,} words  (was 192,835)")
print(f"  English words                  : {len(en_set):>8,} words  (preserved)")
print(f"  Indonesian slang (sid)         : {len(sid_map):>8,} entries (was 520)")
print(f"  English slang (sen)            : {len(sen_map):>8,} entries (preserved)")
print(f"  Fix map (bentuk+varian+manual) : {len(fix_map):>8,} entries (was 72)")
print(f"  Remove particles               : {len(rem_set):>8,} entries")
print(f"  Homophones                     : {len(hom_list):>8,} entries")
print(f"  Phrase map (NEW)               : {len(phrase_map):>8,} entries")
print("=" * 70)
