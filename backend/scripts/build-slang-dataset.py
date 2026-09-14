#!/usr/bin/env python3
"""Build slang dataset (IndoCollex equivalent) — abbreviations + sosmed + typos + IndoNLU."""
import json, re, os
from pathlib import Path

DEPLOY = Path(__file__).resolve().parent.parent.parent / ".deploy"
DATASETS = Path(__file__).resolve().parent.parent.parent / ".datasets"

abbreviations = {
    "tdk":"tidak","td":"tidak","gk":"tidak","ga":"tidak","gak":"tidak","nggak":"tidak","ngga":"tidak","ndak":"tidak","kagak":"tidak",
    "bkn":"bukan","blm":"belum","blum":"belum","sdh":"sudah","udh":"sudah","udah":"sudah","dah":"sudah",
    "bbrp":"beberapa","brapa":"berapa","brp":"berapa","yg":"yang","dgn":"dengan","dng":"dengan",
    "utk":"untuk","krn":"karena","krna":"karena","sprt":"seperti","spt":"seperti","sprti":"seperti",
    "sdgkan":"sedangkan","sdg":"sedang","tlg":"tolong","tlng":"tolong","trs":"terus","teros":"terus","trus":"terus",
    "dlm":"dalam","ats":"atas","bwh":"bawah","dtg":"datang","dtng":"datang","brg":"barang","brng":"barang",
    "org":"orang","skrg":"sekarang","skrang":"sekarang","nnti":"nanti","nti":"nanti","ntar":"nanti",
    "bsk":"besok","bsok":"besok","kmrn":"kemarin","kmaren":"kemarin","hr":"hari","hrini":"hari ini",
    "bln":"bulan","blnn":"bulan","thn":"tahun","th":"tahun","mng":"minggu","mgg":"minggu","mnt":"menit","dt":"detik",
    "sy":"saya","aq":"aku","ak":"aku","q":"aku","gue":"aku","gw":"aku","km":"kamu","kmu":"kamu","lu":"kamu","lo":"kamu","elu":"kamu",
    "dy":"dia","dya":"dia","kmi":"kami","mrk":"mereka","klian":"kalian","kliann":"kalian",
    "ap":"apa","gmn":"bagaimana","gimana":"bagaimana","gemana":"bagaimana","kmn":"ke mana","kmana":"ke mana","drs":"dari mana",
    "kn":"kenapa","knp":"kenapa","bru":"baru","br":"baru","jgn":"jangan","bnr":"benar","bner":"benar","bnar":"benar",
    "bner2":"benar-benar","bnr2":"benar-benar","bgt":"sangat","bget":"sangat","banget":"sangat",
    "skli":"sekali","skl":"sekali","skali":"sekali","blg":"bilang","bkin":"bikin","bwt":"buat",
    "ngrt":"mengerti","ngmong":"berbicara","lyat":"lihat","dgr":"dengar","dyg":"dengar",
    "pgn":"ingin","pngn":"ingin","mao":"mau","mo":"mau","mw":"mau","ajk":"ajak","tgu":"tunggu","tgg":"tunggu",
    "cri":"mencari","jwb":"jawab","jwab":"jawab","tny":"bertanya","tnya":"bertanya",
    "bgs":"bagus","bgu":"bagus","jelex":"jelek","jlek":"jelek","cntk":"cantik","gntg":"ganteng",
    "bsar":"besar","bsr":"besar","kcil":"kecil","kcl":"kecil","pnjg":"panjang","pjg":"panjang","pndk":"pendek","pdk":"pendek",
    "tp":"tapi","tpi":"tapi","kl":"kalau","klo":"kalau","jka":"jika","jik":"jika",
    "shg":"sehingga","shingga":"sehingga","spy":"supaya","sblm":"sebelum","sblum":"sebelum",
    "ssudah":"sesudah","ssdh":"sesudah","stlh":"setelah","pg":"pagi","pgi":"pagi","sre":"sore",
    "mlm":"malam","malem":"malam","mna":"mana","gpp":"tidak apa-apa","gapapa":"tidak apa-apa",
    "btw":"ngomong-ngomong","fwi":"untuk informasi","imho":"menurut saya",
    "comp":"company","corp":"corporation","info":"informasi","stats":"statistik","stat":"statistik",
}
print(f"[1/4] Built {len(abbreviations)} abbreviations")

sosmed_slang = {
    "wkwk":"tertawa","wkwkwk":"tertawa","wkwkwkwk":"tertawa","haha":"tertawa","hahaha":"tertawa","hehe":"tertawa","hihi":"tertawa","lol":"tertawa","wkakak":"tertawa",
    "bgt":"sangat","bget":"sangat","banget":"sangat","bngt":"sangat","kalo":"kalau","klo":"kalau","klau":"kalau",
    "udah":"sudah","udh":"sudah","dah":"sudah","emang":"memang","mmg":"memang","emg":"memang",
    "gitu":"begitu","gto":"begitu","gt":"begitu","bener":"benar","bnr":"benar","bner":"benar",
    "beneran":"benar-benar","bnr2":"benar-benar","gini":"begini","gn":"begini",
    "tau":"tahu","tw":"tahu","ngomong":"berbicara","ngmong":"berbicara","ngerti":"mengerti","ngrt":"mengerti",
    "bikin":"membuat","bkin":"membuat","bwt":"buat","bilang":"mengatakan","blg":"mengatakan",
    "nonton":"menonton","ntn":"menonton","dateng":"datang","dtg":"datang","napa":"kenapa","npa":"kenapa","knp":"kenapa",
    "yah":"ya","yh":"ya","nih":"ini","nh":"ini","tuh":"itu","th":"itu","doang":"saja","dang":"saja",
    "mulu":"terus","mlu":"terus","ane":"saya","agan":"saudara","bro":"saudara","sis":"saudari",
    "skali":"sekali","skli":"sekali","skl":"sekali","kepo":"ingin tahu","kp":"ingin tahu",
    "galau":"sedih","gl":"sedih","gabut":"bosan","gbt":"bosan","bucin":"budak cinta","jomblo":"lajang",
    "rebahan":"berbaring","rbhn":"berbaring","halu":"berhalusinasi","salfok":"salah fokus","mager":"malas gerak",
    "cuan":"keuntungan","rugi":"kerugian","long":"beli","short":"jual","hold":"tahan","trading":"perdagangan",
    "trader":"pedagang","investor":"penanam modal","bullish":"naik","bearish":"turun",
    "pump":"naik","dump":"turun","moon":"naik tinggi","diamond":"tahan kuat","paper":"jual cepat",
    "fomo":"takut ketinggalan","dyor":"lakukan riset sendiri","katlos":"cut loss","tekprofit":"take profit","tp":"take profit",
    "bug":"kesalahan","debug":"perbaiki kesalahan","deploy":"terapkan","coding":"menulis kode",
    "compile":"kompilasi","runtime":"waktu eksekusi","frontend":"antarmuka","backend":"server",
    "krn":"karena","krna":"karena","sprt":"seperti","spt":"seperti","shg":"sehingga","shingga":"sehingga",
    "dlm":"dalam","ats":"atas","bwh":"bawah","skrg":"sekarang","skrang":"sekarang",
}
print(f"[2/4] Built {len(sosmed_slang)} sosmed slang")

typos = {
    "sklian":"sekalian","skit":"sakit","bgs":"bagus","skrg":"sekarang","skrang":"sekarang",
    "skli":"sekali","skali":"sekali","bkn":"bukan","emng":"memang","emg":"memang","mmg":"memang",
    "sktr":"sekitar","skitar":"sekitar","sblm":"sebelum","sblum":"sebelum","ssdh":"sesudah","ssudah":"sesudah","stlh":"setelah",
    "sistim":"sistem","metoda":"metode","strateji":"strategi","difinisi":"definisi",
    "annalisa":"analisis","analisa":"analisis","produktifitas":"produktivitas","hipotesa":"hipotesis",
    "algoritm":"algoritma","ngapain":"mengapa","kloropls":"kloroplas","klorofi":"klorofil",
    "fotosintessa":"fotosintesis","fotosintesa":"fotosintesis","molekule":"molekul","atome":"atom",
    "trgonometri":"trigonometri","trgonom":"trigonometri","parabela":"parabola","matematka":"matematika",
}
print(f"[3/4] Built {len(typos)} typos")

indonlu_slang_set = set()
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
                            tokens = re.findall(r"\b[a-zA-Z]+\b", line.lower())
                            for tok in tokens:
                                if len(tok) >= 3 and not re.search(r"(.)\1{2,}", tok):
                                    indonlu_slang_set.add(tok)
                    file_count += 1
                except Exception:
                    pass
    print(f"[4/4] Extracted {len(indonlu_slang_set):,} sosmed words from IndoNLU ({file_count} files)")
else:
    print(f"[4/4] IndoNLU not found, skipping")

combined = {}
combined.update(abbreviations)
combined.update(sosmed_slang)
combined.update(typos)
final_slang = {k.lower(): v for k, v in combined.items() if k and v}

output = {
    "_v": "1.0-indocollex-equivalent",
    "abbreviations": abbreviations,
    "sosmed_slang": sosmed_slang,
    "typos": typos,
    "indonlu_sosmed_words": sorted(list(indonlu_slang_set))[:5000],
    "combined_slang": final_slang,
    "_stats": {
        "abbreviations_count": len(abbreviations),
        "sosmed_slang_count": len(sosmed_slang),
        "typos_count": len(typos),
        "indonlu_sosmed_words_count": len(indonlu_slang_set),
        "combined_slang_total": len(final_slang),
    }
}

output_path = DEPLOY / "slang-dataset.json"
output_path.write_text(json.dumps(output, ensure_ascii=False))
print(f"\n✓ Saved: {output_path}")
print(f"  Size: {output_path.stat().st_size / 1024:.1f} KB")
print(f"  Combined slang total: {len(final_slang):,}")
