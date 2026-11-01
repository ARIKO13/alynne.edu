# DESIGN.md — Kontrak Desain ALYNNE.EDU

> Sistem desain terkunci. Semua halaman & komponen baru HARUS mengikuti file ini.
> Disusun dari audit 6 skill anti-slop (Anthropic frontend-design, taste-skill,
> kill-ai-slop, hallmark, zero-slop, avoid-ai-design) + scan 2026-11-01:
> 26 grup / 1.189 hit (kill-ai-slop) · 161 temuan / 14 P0 (avoid-ai-design).
> Prinsip induk: **slop = keputusan yang tidak diambil.** Setiap pilihan visual
> harus bisa dijelaskan "kenapa". Referensi arah: login screen terbaru
> (flat, satu aksen, tanpa efek) — itu standarnya, bukan landing page lama.
>
> **Eksekusi 2026-11-01 (deploy terverifikasi):** P0 14 → **0**, P1 103 → 62
> (sisa = pilihan kontrak: set ikon Lucide, tema gelap + status, konten dokumen
> hasil generate; K7 dihaluskan via `:focus-visible` global). Perubahan utama:
> token lengkap di `global.css` (+`--surface/--surface-2/--text-2/--text-3/
> --accent-hover/--ok/--warn/--err`, text-3 dinaikkan ke `#8B8B93` agar lolos
> WCAG AA 4.5:1), `overflow-x: clip`, `.btn` flat, Dialog pakai token bersama,
> halaman publik (index/billing/contact/about/panduan) di-de-slop: tanpa pill
> eyebrow, headline solid, hero rata kiri, copy spesifik bahasa Indonesia,
> tanpa emoji di UI, tanpa gradien (logo Instagram = satu-satunya pengecualian
> brand), kartu aksi STT seragam, label kapital → sentence case 11px, angka
> tidak terukur ("24/7") diganti fakta nyata. Inter ditoleransi sesuai §6
> (waiver `avoid-ai-design-ignore-file: T1`); URL font NavLayout yang rusak
> diperbaiki; `#050507` disatukan ke `--bg`.
>
> **Ronde 2 — 2026-11-01 (commit `7ec9306`, deploy terverifikasi):** scan
> kill-ai-slop 1.024 → **889 hit** (sisa = FP & pilihan kontrak: komentar,
> warna status beneran, mono kode/transkrip/timer, emoji di pesan share
> WhatsApp, diagram admin). Dibersihkan: gradien kartu flashcard & tombol
> checkout (glow + brightness ikut dihapus) → flat `--accent`/tint;
> radial-gradient mindmap → flat; `transition-all` 72× → transisi scoped
> (`transition-colors`, `transition-[width]`, `transition-shadow`,
> `transition-transform`); `hover:scale`/`scale-110` dihapus
> (feature-tutorial, swatch bookmark); emoji-ikon UI dibersihkan (StatCard
> dataset-library, peringatan StudyPipeline, SlideExporter, Scratchpad,
> monitoring, image-sharpener, node Mermaid architecture-view, placeholder
> billing); kicker kapital → sentence case (VisualisasiPanel, ai-assistant,
> modul-panel, header tabel admin); violet/purple lama dimigrasi
> (color-coding kategori → zinc, aksen AI → `#7C3AED`, `#B794F6` → token);
> badge "NEW" dilepas; sisa "24/7" → "Prioritas antrean dukungan"; panah
> `←` dilepas dari link; `font-mono` textarea Scratchpad → text face;
> `shadow-2xl` → `shadow-lg`. Waiver tetap: gradien logo Instagram (brand),
> pulse pada status nyata (REC, matchmaking, recording), pill
> "Available/Coming Soon", Inter (§6). Komponen mati terdeteksi:
> `payment-wall.tsx` (tidak di-import) — kandidat dihapus.
>
> **Ronde 3 — 2026-11-01 (elevasi komposisi):** ronde 1–2 membersihkan slop
> (menghapus), ronde 3 menambah kualitas positif (mengisi). (1) §6 ditutup:
> body tetap Inter, headline publik pakai display face **Bricolage Grotesque**
> (token `--font-display` + utilitas `.font-display`; Google Fonts, `display=swap`,
> fallback Inter — aman offline). (2) Homepage ditulis ulang: hero rata kiri +
> panel ilustrasi produk nyata (rangkuman/kuis/flashcard dengan konten sample
> Biologi, flat, token-only), seksi "Cara kerja" 3 langkah bernomor, grid
> 6 fitur aktual produk (hairline divider `gap-px`, bukan kartu melayang),
> CTA band; semua copy faktual — harga diambil dari `billing-models.ts`
> (Rp 50.000 / 30 hari; klaim "gratis" dilarang karena tidak ada tier gratis).
> Ikon = inline SVG path Lucide (stroke 1.5), bukan emoji. Login screen TIDAK
> diubah (ia referensi §1). Kepemilikan keputusan: ukuran font publik kini
> display/h2/h3/body/micro = 5 skala (sesuai §7).
>
> **Ronde 4 — 2026-11-01 (penggantian palet — keputusan owner):** owner menilai
> palet ungu terlihat AI-slop dan minta aksen yang "mata adem" untuk belajar.
> Aksen diganti biru laut tenang (sky): `--accent #7C3AED → #0369A1` (sky-700,
> fill tombol), `--accent-hover #6D28D9 → #075985` (sky-800), token baru
> `--accent-soft #38BDF8` (sky-400 — teks/ikon/garis aksen di atas bg gelap).
> Kontras terverifikasi WCAG: putih di --accent 5.93:1 (lama 5.70), --accent-soft
> di --bg 9.24:1 (lama 3.47), ring 3.34:1. Migrasi mekanis 57 file: hex
> `#7C3AED/#B794F6/#A78BFA/#8B5CF6/#6D28D9` (semua case) → token/hex baru per
> konteks (teks→accent-soft, fill→accent, SVG→#38BDF8); kelas violet-*/purple-*
> → sky-*; hover oranye liar `#d14e1c` (4 file) → `--accent-hover`.
> §1 diperbarui: "satu aksen violet" → "satu aksen biru laut". Audit interior
> (login demo) menemukan slop copy yang ikut dibetulkan: bahasa campur EN/ID
> (Back→Kembali, Settings→Pengaturan, Logout→Keluar, Entire Screen→Seluruh
> Layar, Start/Stop Recording→Mulai/Berhenti Merekam, Paste YouTube URL→Tempel
> URL YouTube, Instant•No processing→Instan•tanpa pemrosesan, Due→Jatuh tempo,
> Master→Dikuasai, Combined Methods→Mode gabungan), dev-speak dihapus (banner
> "reliable, no crash", "Algoritma SM-2 (sama kayak Anki)", "generate flashcard
> dari transcript"), tombol "Ambil" merah (semantik destructive salah) → netral.
> Sisa P2 (backlog): nama fitur EN melekat dipertahankan (Speech to Text,
> Knowledge Hub, Scratchpad, Spaced repetition). **Bug produksi terpisah (bukan
> desain): D1 API 401 Authentication error — `CF_API_TOKEN` di .env VPS invalid/
> expired; semua fitur DB (demo-login, profil, langganan) 500. Perlu token
>
> **Ronde 5 — 2026-11-01 (redam saturasi, membumi — arah owner):** owner
> mengirim rulebook anti-slop: larang gradasi ungu→biru/cyan di bg gelap &
> warna neon tanpa fungsi; pakai warna muted/membumi; batasi 1–2 aksen.
> Dieksekusi: (1) netral dingin zinc → **stone hangat** (1.111 kelas di 62
> file; token: --bg #0D0C0A, --surface #161412, --surface-2 #1E1B18,
> --border #2B2723, --text #F5F2ED, --text-2 #ABA49A, --text-3 #8E8880 —
> semua ≥ 5.5:1). (2) aksen sky → **teal-sage muted**: --accent #0F766E,
> --accent-hover #115E59, --accent-soft #7FC4B8; saturasi aksen teks
> 0.93 → 0.37; kelas sky → token/teal; hex ronde-4 #38BDF8/#0284C7/#075985
> → padanan teal. (3) **gradasi teal→ungu + glow ungu** di quiz-panel (3
> tombol) — pelanggaran langsung larangan owner — → flat + tanpa glow;
> violet lolos #A57CE8 (indirect) & #C4B5FD (MindmapGraph aktif, panduan
> h3) dimusnahkan. (4) Waiver baru: **LofiBackground** (ungu-navy sunset)
> = fitur ambient sesi fokus (muncul hanya saat timer berjalan, intensity
> 0.3–0.4, pointer-events-none) — fitur produk "belajar sambil main",
> bukan dekorasi; kandidat review produk, tidak dihapus di sini. Warna
> kategori data-viz (chart/mindmap/diagram) dipertahankan = encoding
> konten, bukan ornamen. Statistik kontras dihitung via skrip (WCAG).
>
> **Ronde 6 — 2026-11-01 (palet "lampu belajar malam" — keputusan owner):**
> owner mengirim referensi warna cahaya lampu — oranye hangat (cozy, tak
> menyilaukan), merah (malam/relaksasi, bukan fokus), putih netral ±4000K
> (fokus belajar lama) — plus "sama warna hitam. nih pake". Arah: hitam +
> oranye + putih netral. Dieksekusi: (1) aksen teal-sage → **oranye terbakar
> muted**: `--accent #0F766E → #C2410C` (hue 17°), `--accent-hover #115E59 →
> #9A3412`, `--accent-soft #7FC4B8 → #D9A87E` (peach muted, hue 28°).
> Kontras terverifikasi via skrip WCAG: putih di --accent 5.18:1,
> --accent-soft di --bg 9.17:1 (di --surface 8.62:1), ring 3.78:1.
> (2) Dasar hitam hangat `#0D0C0A` + teks putih netral `#F5F2ED`
> dipertahankan — sudah sesuai arah owner sejak ronde 5. (3) Merah
> `--err #EF4444` tetap khusus status error, bukan warna aksi (sesuai
> catatan owner). (4) Migrasi mekanis 30 file: hex #0F766E/#115E59/#7FC4B8
> → padanan oranye — termasuk konstanta canvas/SVG (ctx.strokeStyle dkk.
> butuh hex literal, var() tidak terbaca di canvas); kelas teal-400/500/
> 700/800 → orange-400/700/800/900 (fill solid → step 700 agar teks putih
> ≥ 4.5:1). Sisa teal aktif: 0. Waiver tetap: gradien logo Instagram,
> LofiBackground, warna kategori data-viz. Tabel §2 disinkronkan dengan
> nilai stone ronde 5 yang tertinggal.

## 1. Arah (satu kalimat)

Aplikasi belajar gelap yang tenang dan padat-fungsi: satu permukaan flat,
satu aksen oranye hangat membumi, tipografi yang jelas, gerak yang beralasan — nol ornamen.

## 2. Token (wajib lewat token, dilarang nilai literal baru)

| Token | Nilai | Peran |
|---|---|---|
| `--bg` | `#0D0C0A` (warm) | Satu-satunya latar. Tidak ada gradient atmosfer. |
| `--surface` | `#161412` | Kartu/panel, **opaque** (bukan blur, bukan alpha). |
| `--surface-2` | `#1E1B18` | Hover / nested sekali. |
| `--border` | `#2B2723` | Pembatas. 1px, boleh hilang kalau spacing sudah cukup. |
| `--text` | `#F5F2ED` · `--text-2: #ABA49A` · `--text-3: #8E8880` | 3 tingkat, cukup. |
| `--accent` | `#C2410C` (hover `#9A3412`, teks/garis di bg gelap: `--accent-soft #D9A87E`) | SATU aksen oranye hangat muted (ronde 6, "lampu belajar malam"). Flat. Bukan gradient. Hanya untuk aksi primer & fokus. |
| `--ok / --warn / --err` | `#10B981` / `#F59E0B` / `#EF4444` | Hanya status BENERAN status. Warna membawa kata, bukan menggantikan kata. |

- Radius: **skala 2 langkah** — `6px` (kontrol) dan `12px` (kontainer). Nested:
  inner = outer − padding. Dilarang campur `rounded-full` untuk kartu.
- Shadow: pakai border saja untuk kedalaman. Kalau perlu shadow: blur kecil,
  offset kecil, opacity rendah, **tanpa warna** (dilarang glow violet/pink/biru).
- Semua warna & font-family wajib dideklarasikan di blok token; tidak ada
  hex literal baru di komponen (violet lama `#8B5CF6/#B794F6/F687B3` di-migrate
  ke token di atas, jangan diperbanyak).

## 3. Utility yang DIHAPUS dari global.css (terbukti slop)

`glass-card`, `glass-card-sm`, `glow-violet*`, `gradient-mesh`,
`.btn-primary`/`.btn-accent` (gradient + `transition: all` + hover scale + glow),
`.text-gradient` (bg-clip-text). Pengganti: `.btn-primary` = flat `--accent`,
radius 6, transition hanya `background-color 150ms`; judul = solid `--text`.

## 4. Aturan lantai (non-negotiable, dari hallmark + anthropic + kill-ai-slop)

1. **Dilarang `transition: all`** — transisi hanya properti yang berubah
   (background, border, opacity), 120–200ms, ease standar. Dilarang
   `hover:scale` di kartu; hover = perubahan permukaan.
2. **Dilarang gradient** indigo→violet/pink di mana pun; dilarang headline
   `bg-clip-text`. Satu aksen flat.
3. **Dilarang glassmorphism** (`backdrop-blur` di kartu/panel). Blur hanya jika
   ada lapisan nyata di belakangnya (mis. nav di atas konten scroll — pun boleh
   tanpa blur).
4. **Dilarang emoji sebagai ikon/bullet** di UI; dilarang status dot ber-pulse
   tanpa state asli di belakangnya.
5. **Dilarang label KAPITAL ber-tracking** di atas tiap heading (kicker/eyebrow),
   badge dekoratif ("✨ New"), meta string pakai titik-tengah, panah menempel
   di CTA. Label = sentence case, ukuran lebih kecil, tanpa letter-spacing.
6. **Dilarang angka/statistik yang tidak terukur** (24/7, 10k+, 99.9%).
   Angka hanya yang nyata & bisa dicek.
7. **Fokus terlihat**: semua elemen interaktif punya `:focus-visible` instan.
   **`prefers-reduced-motion`** dihormati di semua animasi. `overflow-x: clip`
   di html/body.
8. **Satu ide per layar.** Headline hero ≤ 7 kata + 1 kalimat bantu + 1 CTA.
   ±80 kata per layar. Bold boleh asal di SATU tempat (signature), sisanya
   tenang.
9. **Struktur dari ruang, bukan kotak**: dilarang kartu di dalam kartu;
   grup pakai spacing + alignment; heading itu bukan konten berbingkai.
   Spacing pakai skala 4/8/16/32/64 secara TIDAK merata (rapat dalam grup,
   lega antar grup) — dilarang satu nilai `gap/p-4` buat semuanya.
10. **Mono (`font-mono`) hanya untuk kode/transkrip/angka timer** — bukan gaya
    "terminal cantik" untuk label UI.
11. Hierarki dari ukuran & jarak: skala maks 5 ukuran font dengan lompatan
    nyata (≥1.25×). Dilarang menyebar warna aksen ke kata-kata di paragraf.

## 5. Copy (bahasa Indonesia, suara produk)

- Spesifik > puitis: sebut nama fitur, angka nyata, konsekuensi.
- Aktif: CTA menyatakan aksinya ("Simpan progres", bukan "Submit").
- Satu nama dipakai konsisten dari tombol sampai notifikasi.
- Error: jelaskan apa yang gagal + cara memperbaiki, tanpa minta maaf, tanpa
  drama. Empty state = undangan bertindak.
- Dilarang pola: "Bukan sekadar X — ini Y", "Tingkatkan/Unlock potensi",
  tricolon tiga kata, tanda pisah (—) berlebihan.

## 6. Tipografi

Saat ini: Inter (default ekosistem — **keputusan yang belum diambil**).
Status: ditoleransi sementara, dicatat sebagai utang desain. Kalau suatu saat
diganti: pilih dengan alasan yang bisa diucapkan (bukan lompat ke Space Grotesk
atau cream+serif — itu slop gelombang kedua). Body ≥ 16px, baris ≤ 80 karakter.

## 7. Gerak (motion)

Satu momen khas per halaman (page-load / satu reveal) — sisanya diam.
Gerak yang menjawab aksi user (buka dialog, submit, drag) selalu boleh.
Dilarang: fade-up di setiap section, hover-lift di setiap kartu, easing pegas,
loop tak berujung yang tidak berarti.

## 8. Proses sebelum ship UI baru / redesign

1. Baca DESIGN.md ini dulu; jangan regenerasi gaya dari nol per halaman.
2. Rancang: 4–6 warna + peran, peran font, komposisi dalam 1 kalimat, dan
   1 detail signature. Uji: "apakah aku akan menghasilkan hal yang sama untuk
   produk lain?" — kalau ya, ubah dan catat apa yang berubah.
3. Scan sebelum & sesudah:
   ```bash
   node design-skills/kill-ai-slop/skill/scripts/scan.mjs frontend/src
   node design-skills/avoid-ai-design/scripts/detect.mjs frontend/src
   ```
   Target: P0 = 0. P1 yang memang sengaja ditandai di source dengan
   `avoid-ai-design-ignore: <ID>` / `deslop-ignore` + alasan.
4. Lihat hasilnya di browser (screenshot) sebelum claim selesai — scan bersih
   ≠ halaman bagus.
