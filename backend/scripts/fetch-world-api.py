#!/usr/bin/env python3
import json, re, time, urllib.request, urllib.parse
from pathlib import Path

OUTPUT = Path("/root/lina-learning/backend/data/datasets/world-languages.json")
all_words = {}

def add(word, lang):
    w = word.strip().lower()
    if not w or len(w) < 2 or len(w) > 50: return
    if w not in all_words:
        all_words[w] = lang

def fetch_allpages(lang, lang_name, max_p=5000):
    total = 0
    apcont = None
    while total < max_p:
        url = "https://%s.wikipedia.org/w/api.php?action=query&list=allpages&aplimit=500&apnamespace=0&format=json" % lang
        if apcont:
            url += "&apcontinue=" + urllib.parse.quote(apcont)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ALYNNE-Edu-Bot/5.0 (https://alynne.my.id)"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read())
                pages = data.get("query", {}).get("allpages", [])
                for p in pages:
                    t = re.sub("[^a-zA-Z\\s\\-]", "", p.get("title", "")).lower().strip()
                    if t and len(t) >= 3:
                        add(t.replace(" ", "_"), lang_name)
                        total += 1
                apcont = data.get("continue", {}).get("apcontinue")
                if not apcont: break
        except:
            break
        time.sleep(2)
    return total

LANGS = [
    ("en","english",8000),("es","spanish",4000),("fr","french",4000),
    ("de","german",4000),("ru","russian",3000),("ja","japanese",3000),
    ("zh","chinese",3000),("pt","portuguese",3000),("it","italian",3000),
    ("ar","arabic",2000),("ko","korean",2000),("tr","turkish",2000),
    ("nl","dutch",3000),("pl","polish",2000),("fa","persian",2000),
    ("hi","hindi",1000),("vi","vietnamese",2000),("th","thai",1000),
    ("sv","swedish",3000),("no","norwegian",2000),("fi","finnish",1000),
    ("da","danish",1000),("cs","czech",1000),("hu","hungarian",1000),
    ("ro","romanian",1000),("el","greek",1000),("uk","ukrainian",2000),
    ("he","hebrew",1000),("bg","bulgarian",1000),("hr","croatian",1000),
    ("sr","serbian",1000),("sk","slovak",500),("ca","catalan",2000),
    ("ms","malay",1000),("tl","tagalog",500),("ta","tamil",500),
    ("te","telugu",500),("bn","bengali",500),("ur","urdu",500),
    ("mr","marathi",300),("gu","gujarati",300),("kn","kannada",300),
    ("ml","malayalam",500),("ne","nepali",300),("si","sinhala",200),
    ("my","burmese",500),("km","khmer",200),("lo","lao",100),
    ("mn","mongolian",300),("ka","georgian",500),("hy","armenian",500),
    ("az","azerbaijani",500),("kk","kazakh",500),("uz","uzbek",500),
    ("sw","swahili",300),("af","afrikaans",500),("mg","malagasy",300),
    ("eo","esperanto",1000),("la","latin",500),("sa","sanskrit",200),
    ("eu","basque",500),("cy","welsh",500),("ga","irish",300),
    ("is","icelandic",300),("lv","latvian",300),("lt","lithuanian",500),
    ("et","estonian",500),("sl","slovenian",500),("sq","albanian",300),
    ("mk","macedonian",300),("bs","bosnian",300),("gl","galician",500),
    ("be","belarusian",500),("fo","faroese",100),("gd","scottish_gaelic",200),
    ("br","breton",200),("fy","frisian",200),("nds","low_german",200),
    ("sco","scots",200),("bar","bavarian",200),("ast","asturian",300),
    ("an","aragonese",200),("wa","walloon",200),("sh","serbo_croatian",500),
    ("nan","min_nan",500),("yue","cantonese",300),("wuu","wu_chinese",200),
    ("hak","hakka",200),("cdo","min_dong",200),("lzh","classical_chinese",200),
    ("kl","greenlandic",100),("se","northern_sami",200),
    ("crh","crimean_tatar",200),("gag","gagauz",100),
    ("ce","chechen",500),("os","ossetian",300),("mhr","mari",200),
    ("udm","udmurt",200),("myv","erzya",200),("mdf","moksha",100),
    ("ab","abkhaz",100),("kv","komi",100),("sah","yakut",300),
    ("cv","chuvash",300),("tt","tatar",500),("ba","bashkir",300),
    ("ky","kyrgyz",300),("tk","turkmen",200),("tg","tajik",300),
    ("ps","pashto",200),("ku","kurdish",300),("ckb","sorani",300),
    ("sd","sindhi",200),("pa","punjabi",300),("or","odia",200),
    ("as","assamese",100),("bo","tibetan",200),("ii","nuosu",100),
    ("tpi","tok_pisin",100),("tet","tetum",100),("bi","bislama",50),
    ("ch","chamorro",50),("ty","tahitian",100),("haw","hawaiian",100),
    ("mi","maori",200),("sm","samoan",50),("fj","fijian",50),
    ("to","tongan",50),("sn","shona",100),("st","sotho",50),
    ("tn","tswana",50),("zu","zulu",50),("xh","xhosa",50),
    ("rw","kinyarwanda",100),("rn","kirundi",50),("lg","luganda",50),
    ("ny","chichewa",50),("ki","kikuyu",50),("so","somali",100),
    ("ti","tigrinya",50),("ff","fula",50),("wo","wolof",50),
    ("bm","bambara",50),("tw","twi",50),("om","oromo",50),
]

print("Total: %d languages" % len(LANGS))
for i, (lang, name, max_p) in enumerate(LANGS):
    print("[%d/%d] %s (%s)..." % (i+1, len(LANGS), name, lang), end=" ", flush=True)
    cc = fetch_allpages(lang, name, max_p)
    u = sum(1 for w,l in all_words.items() if l == name)
    print("%d fetched, %d unique" % (cc, u))
    time.sleep(1)

print("\nTOTAL UNIQUE: %d" % len(all_words))
counts = {}
for w,l in all_words.items():
    counts[l] = counts.get(l, 0) + 1
print("\nTop 20:")
for l,cc in sorted(counts.items(), key=lambda x:-x[1])[:20]:
    print("  %-20s: %6d" % (l, cc))

output = {"_version":"3.0-world-api","terms":[{"word":w,"domain":"world_"+l} for w,l in sorted(all_words.items())]}
with open(OUTPUT, "w") as f:
    json.dump(output, f, ensure_ascii=False)
print("\nWritten: %s (%d entries, %.1f MB)" % (OUTPUT, len(all_words), OUTPUT.stat().st_size/1024/1024))
