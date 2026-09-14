#!/usr/bin/env python3
"""
Phonetic Generator — auto-generate phonetic variations for IDX stock tickers.

Uses ALPHABET_PHONETICS rule (Indonesian letter pronunciation) to spell out
each ticker letter-by-letter, producing variations like:
  BBCA → "be be se a", "bebesea"
  BBRI → "be be er i", "beberi"
  TLKM → "te el ka em", "telkaem"

Output: merges into backend/data/phonetic-map.json under phonetic_tickers.
"""
import json, itertools
from pathlib import Path

# Indonesian phonetic alphabet mapping (letter → possible pronunciations)
# Based on how Indonesians spell letters when saying ticker codes aloud.
ALPHABET_PHONETICS = {
    'A': ['a', 'ah'],
    'B': ['be', 'beh', 'b'],
    'C': ['se', 'ce', 'seh'],
    'D': ['de', 'deh', 'd'],
    'E': ['e', 'eh'],
    'F': ['ef', 'ep', 'fe'],
    'G': ['ge', 'geh', 'g'],
    'H': ['ha', 'hah', 'h'],
    'I': ['i', 'eye'],
    'J': ['je', 'jeh', 'ji'],
    'K': ['ka', 'kah', 'ke'],
    'L': ['el', 'leh', 'l'],
    'M': ['em', 'em', 'm'],
    'N': ['en', 'en', 'n'],
    'O': ['o', 'oh'],
    'P': ['pe', 'peh', 'p'],
    'Q': ['ki', 'kiu', 'q'],
    'R': ['er', 'ar', 'r'],
    'S': ['es', 'es', 's'],
    'T': ['te', 'teh', 't'],
    'U': ['u', 'you'],
    'V': ['fe', 've', 'vi'],
    'W': ['we', 'weh', 'w', 'dobel u'],
    'X': ['eks', 'ex', 'x'],
    'Y': ['ye', 'y', 'wai'],
    'Z': ['zet', 'ze', 'z'],
}

# All 40 IDX tickers (from stt-dictionary.ts stockTickers)
TICKERS = [
    "GOTO", "BBCA", "BBRI", "BBNI", "BMRI", "TLKM", "ASII", "UNVR",
    "INDY", "MARI", "ANTM", "INCO", "KRAS", "MYOH", "KLBF", "GGRM",
    "ICBP", "INDF", "CPIN", "JPFA", "TPIA", "ADRO", "PGAS", "MEDC",
    "MAIN", "SMRA", "BSDE", "CTRA", "LPKR", "ASRI", "AMMN", "MPPA",
    "BFIN", "TBIG", "EXCL", "ISAT", "MNCN", "LION", "BNGA", "BBTN",
]


def generate_phonetic_variations(ticker):
    """Generate all phonetic variations for a ticker.
    
    For each letter, pick one of its phonetic pronunciations.
    Produce:
      1. Standard spelled-out (first variant of each letter): "be be se a"
      2. No-space version: "bebesea"
      3. Hyphenated: "be-be-se-a"
      4. Common mishearing: double-letter reduction (bebe → be)
    
    Returns a dict of {variation: ticker}.
    """
    variations = {}
    
    # Get phonetic options for each letter
    letter_phonetics = []
    for char in ticker:
        opts = ALPHABET_PHONETICS.get(char, [char.lower()])
        letter_phonetics.append(opts)
    
    # 1. Standard spelled-out (first variant of each letter)
    standard = ' '.join(opts[0] for opts in letter_phonetics)
    variations[standard] = ticker
    
    # 2. No-space version
    no_space = standard.replace(' ', '')
    variations[no_space] = ticker
    
    # 3. Hyphenated
    hyphenated = '-'.join(opts[0] for opts in letter_phonetics)
    variations[hyphenated] = ticker
    
    # 4. Common mishearings — for repeated letters, try singular form
    # e.g., BBCA → "be se a" (drop one "be"), "bebe se a" → "be se a"
    reduced = standard
    for letter in set(ticker):
        phonetic = ALPHABET_PHONETICS.get(letter, [letter.lower()])[0]
        # If letter appears 2+ times consecutively, try removing one
        # e.g., "be be se a" → "be se a"
        pass  # handled in manual curation
    
    # 5. Generate a few key combinations (first 2 variants per letter)
    # Limit to 2^N where N = number of unique letters (cap at 8 combinations)
    unique_letters = list(set(ticker))
    if len(unique_letters) <= 3:
        # Generate all combinations (2^N max)
        for combo in itertools.product(*[opts[:2] for opts in letter_phonetics]):
            variation = ' '.join(combo)
            if variation != standard:  # don't duplicate
                variations[variation] = ticker
            # Also no-space version
            no_sp = variation.replace(' ', '')
            if no_sp != no_space:
                variations[no_sp] = ticker
    
    return variations


def main():
    print("=" * 60)
    print("PHONETIC GENERATOR — IDX Stock Tickers")
    print("=" * 60)
    
    all_variations = {}
    for ticker in TICKERS:
        variations = generate_phonetic_variations(ticker)
        all_variations.update(variations)
        print(f"  {ticker}: {len(variations)} variations")
    
    print(f"\nTotal auto-generated variations: {len(all_variations)}")
    
    # Load existing phonetic-map.json
    phonetic_path = Path(__file__).resolve().parent.parent.parent / "backend" / "data" / "phonetic-map.json"
    print(f"\nLoading existing: {phonetic_path}")
    with open(phonetic_path) as f:
        phonetic_map = json.load(f)
    
    existing_tickers = phonetic_map.get("phonetic_tickers", {})
    print(f"  Existing phonetic_tickers: {len(existing_tickers)} entries")
    
    # Merge: existing manual entries take precedence over auto-generated
    # (manual entries are more accurate — curated by hand)
    merged = {**all_variations, **existing_tickers}
    print(f"  Merged total: {len(merged)} entries (+{len(merged) - len(existing_tickers)} auto-generated)")
    
    # Write back
    phonetic_map["phonetic_tickers"] = merged
    phonetic_map["_v"] = "2.0-auto-generated"
    phonetic_map["_s"] = f"merged: auto-generated ({len(all_variations)}) + manual curated ({len(existing_tickers)})"
    
    with open(phonetic_path, 'w') as f:
        json.dump(phonetic_map, f, ensure_ascii=False, indent=2)
    
    print(f"\n✓ Updated: {phonetic_path}")
    print(f"  Total phonetic_tickers: {len(merged)}")
    
    # Show sample
    print(f"\nSample entries:")
    for k in list(merged.keys())[:8]:
        print(f"  '{k}' → {merged[k]}")


if __name__ == "__main__":
    main()
