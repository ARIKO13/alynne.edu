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

## 1. Arah (satu kalimat)

Aplikasi belajar gelap yang tenang dan padat-fungsi: satu permukaan flat,
satu aksen violet, tipografi yang jelas, gerak yang beralasan — nol ornamen.

## 2. Token (wajib lewat token, dilarang nilai literal baru)

| Token | Nilai | Peran |
|---|---|---|
| `--bg` | `#09090B` | Satu-satunya latar. Tidak ada gradient atmosfer. |
| `--surface` | `#111113` | Kartu/panel, **opaque** (bukan blur, bukan alpha). |
| `--surface-2` | `#18181B` | Hover / nested sekali. |
| `--border` | `#27272A` | Pembatas. 1px, boleh hilang kalau spacing sudah cukup. |
| `--text` | `#FAFAFA` · `--text-2: #A1A1AA` · `--text-3: #71717A` | 3 tingkat, cukup. |
| `--accent` | `#7C3AED` (hover `#6D28D9`) | SATU aksen. Flat. Bukan gradient. Hanya untuk aksi primer & fokus. |
| `--ok / --warn / --err` | `#10B981` / `#F59E0B` / `#EF4444` | Hanya status BENERAN status. Warna membawa kata, bukan menggantikan kata. |

- Radius: **skala 2 langkah** — `6px` (kontrol) dan `12px` (kontainer). Nested:
  inner = outer − padding. Dilarang campur `rounded-full` untuk kartu.
- Shadow: pakai border saja untuk kedalaman. Kalau perlu shadow: blur kecil,
  offset kecil, opacity rendah, **tanpa warna** (dilarang glow violet/pink).
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
