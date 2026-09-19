#!/usr/bin/env python3
"""Download Wikipedia abstract dumps untuk 150+ bahasa dunia. Extract semua kata."""
import json, re, gzip, subprocess, time, os
from pathlib import Path

OUTPUT = Path("/root/lina-learning/backend/data/datasets/world-languages.json")
TMP_DIR = Path("/tmp/wiki-world")
TMP_DIR.mkdir(exist_ok=True)

LANGS = [
    ("en","english"),("es","spanish"),("fr","french"),("de","german"),("ru","russian"),
    ("ja","japanese"),("zh","chinese"),("pt","portuguese"),("it","italian"),("ar","arabic"),
    ("ko","korean"),("tr","turkish"),("pl","polish"),("nl","dutch"),("fa","persian"),
    ("hi","hindi"),("vi","vietnamese"),("th","thai"),("sv","swedish"),("no","norwegian"),
    ("fi","finnish"),("da","danish"),("cs","czech"),("hu","hungarian"),("ro","romanian"),
    ("el","greek"),("uk","ukrainian"),("he","hebrew"),("bg","bulgarian"),("hr","croatian"),
    ("sr","serbian"),("sk","slovak"),("ca","catalan"),("ms","malay"),("tl","tagalog"),
    ("ta","tamil"),("te","telugu"),("bn","bengali"),("ur","urdu"),("mr","marathi"),
    ("gu","gujarati"),("kn","kannada"),("ml","malayalam"),("ne","nepali"),("si","sinhala"),
    ("my","burmese"),("km","khmer"),("lo","lao"),("mn","mongolian"),("ka","georgian"),
    ("hy","armenian"),("az","azerbaijani"),("kk","kazakh"),("uz","uzbek"),("sw","swahili"),
    ("am","amharic"),("ha","hausa"),("yo","yoruba"),("af","afrikaans"),("mg","malagasy"),
    ("haw","hawaiian"),("mi","maori"),("sm","samoan"),("fj","fijian"),("to","tongan"),
    ("eo","esperanto"),("la","latin"),("sa","sanskrit"),("pi","pali"),("eu","basque"),
    ("cy","welsh"),("ga","irish"),("is","icelandic"),("lv","latvian"),("lt","lithuanian"),
    ("et","estonian"),("sl","slovenian"),("sq","albanian"),("mk","macedonian"),("bs","bosnian"),
    ("gl","galician"),("be","belarusian"),("fo","faroese"),("gd","scottish_gaelic"),
    ("br","breton"),("co","corsican"),("fy","frisian"),("nds","low_german"),
    ("pms","piedmontese"),("lmo","lombard"),("nap","neapolitan"),("scn","sicilian"),
    ("sco","scots"),("bar","bavarian"),("ast","asturian"),("an","aragonese"),
    ("wa","walloon"),("sh","serbo_croatian"),("rue","rusyn"),("vep","veps"),
    ("sah","yakut"),("cv","chuvash"),("tt","tatar"),("ba","bashkir"),("ky","kyrgyz"),
    ("tk","turkmen"),("tg","tajik"),("ps","pashto"),("ku","kurdish"),("ckb","sorani"),
    ("sd","sindhi"),("pa","punjabi"),("or","odia"),("as","assamese"),("dz","dzongkha"),
    ("bo","tibetan"),("wuu","wu_chinese"),("hak","hakka"),("nan","min_nan"),
    ("yue","cantonese"),("gan","gan_chinese"),("cdo","min_dong"),("lzh","classical_chinese"),
    ("kl","greenlandic"),("se","northern_sami"),("crh","crimean_tatar"),("gag","gagauz"),
    ("ce","chechen"),("os","ossetian"),("mhr","mari"),("udm","udmurt"),("kv","komi"),
    ("myv","erzya"),("mdf","moksha"),("ab","abkhaz"),("ady","adyghe"),("kbd","kabardian"),
    ("inh","ingush"),("lbe","lak"),("lez","lezgi"),("dar","dargwa"),("tab","tabassaran"),
    ("xal","kalmyk"),("koi","komi_permyak"),("krc","karachay"),("olo","livvi"),
    ("rm","romansh"),("li","limburgish"),("zea","zeelandic"),("fur","friulian"),
    ("lij","ligurian"),("lld","ladin"),("vec","venetian"),("eml","emiliano"),
    ("ext","extremaduran"),("cbk","chavacano"),("pap","papiamento"),("nds_nl","dutch_low_saxon"),
    ("vls","west_flemish"),("srn","sranan"),("tet","tetum"),("tpi","tok_pisin"),
    ("bi","bislama"),("ch","chamorro"),("ty","tahitian"),("sn","shona"),("st","sotho"),
    ("tn","tswana"),("zu","zulu"),("xh","xhosa"),("rw","kinyarwanda"),("rn","kirundi"),
    ("lg","luganda"),("ny","chichewa"),("ki","kikuyu"),("so","somali"),("ti","tigrinya"),
    ("ff","fula"),("wo","wolof"),("bm","bambara"),("tw","twi"),("om","oromo"),
]

all_words = {}

def add_word(word, lang):
    w = word.strip().lower()
    if not w or len(w) < 2 or len(w) > 50:
        return
    if w not in all_words:
        all_words[w] = lang

def download_and_extract(lang_code, lang_name):
    dump_url = f"https://dumps.wikimedia.org/{lang_code}wiki/latest/{lang_code}wiki-latest-abstract.xml.gz"
    dump_file = TMP_DIR / f"{lang_code}wiki-abstract.xml.gz"

    result = subprocess.run(
        ["wget", "-q", "--timeout=60", "-O", str(dump_file), dump_url],
        capture_output=True, text=True, timeout=120
    )

    if not dump_file.exists() or dump_file.stat().st_size < 100:
        return 0

    count = 0
    try:
        with gzip.open(dump_file, 'rt', encoding='utf-8', errors='replace') as f:
            content = f.read()
            clean = re.sub(r'<[^>]+>', ' ', content)
            words = re.findall(r'[^\W\d_]{2,50}', clean, re.UNICODE)
            for word in words:
                add_word(word, lang_name)
                count += 1
    except Exception as e:
        pass

    try:
        dump_file.unlink()
    except:
        pass
    return count

print(f"Total languages: {len(LANGS)}\n")

for i, (lang_code, lang_name) in enumerate(LANGS):
    print(f"[{i+1}/{len(LANGS)}] {lang_name} ({lang_code})...", end=" ", flush=True)
    count = download_and_extract(lang_code, lang_name)
    unique = sum(1 for w, l in all_words.items() if l == lang_name)
    print(f"{count} words, {unique} unique")

    if (i + 1) % 20 == 0:
        print(f"\n  --- Progress: {len(all_words)} total unique ---\n")

    time.sleep(0.5)

print(f"\nTOTAL UNIQUE: {len(all_words)}")

counts = {}
for w, l in all_words.items():
    counts[l] = counts.get(l, 0) + 1

print("\nTop 30:")
for l, c in sorted(counts.items(), key=lambda x: -x[1])[:30]:
    print(f"  {l:20s}: {c:>8}")

output = {"_version":"1.0-world","terms":[{"word":w,"domain":f"world_{l}"} for w,l in sorted(all_words.items())]}
with open(OUTPUT, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False)

print(f"\nWritten: {OUTPUT} ({len(all_words)} entries, {OUTPUT.stat().st_size/1024/1024:.1f} MB)")
