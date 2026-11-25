# ALYNNE.EDU - AI Education Platform

Platform AI edukasi all-in-one untuk pelajar, mahasiswa, guru, dan institusi. Speech-to-Text, Modul PDF, Mind Map, AI Assistant, Mode Belajar dengan focus detector, ambient sounds, analytics, dan referral system, semua dalam satu alur kerja terintegrasi.

Rilis ini menambah pilar fitur baru: **Lab 3D** (alat peraga Three.js yang bisa diputar 360° dan dibedah per bagian), **Simulasi Sidang** (dosen penguji AI berbasis suara), **Mode SKS** (saring 30% inti materi + detektor soal pengecoh saat waktu belajar mepet), **Lab Teks** (penerjemah bahasa akademis ke bahasa tongkrongan + korektor esai + audit catatan), dan **Pomodoro Pintar** (3 soal kilat sebelum istirahat).

## Fitur Utama

### 1. Speech-to-Text (STT) Hybrid

Hybrid architecture: Web Speech API untuk real-time + Whisper untuk post-processing.

**Mode Offline (Client-side):**
- Tiny (40MB Q8) - 65-75% akurasi, 5-10x realtime
- Small (150MB Q8) - 82-88% akurasi, 1.5-2x realtime (RECOMMENDED)
- Jalan di browser via Web Worker (transformers.js + ONNX Runtime Web)
- Bisa transcribe tanpa internet setelah model di-cache

**Mode Online (Server-side):**
- Large v3 Turbo (548MB) - 88-96% akurasi
- Large v3 (1.1GB) - 90-97% akurasi
- Diproses di server (faster-whisper, 8GB RAM VPS)

### 2. Mode Belajar (Deep Focus Study Mode)

Pipeline otomatis dari hasil STT ke sesi belajar interaktif:

```
STT Result
  -> Auto-split ke bab-bab (chapter splitter)
  -> Mindmap visual (SVG radial graph, bukan text tree)
  -> Kuis interaktif per bab (multiple choice, fill-in-blank)
  -> Mulai Sesi Belajar:
     - Pomodoro timer (25/5) + Pomodoro Pintar: 3 soal kilat sebelum istirahat (QuickQuizBreak)
     - Webcam focus detector (face + gaze tracking)
     - Smart warnings (Level 1: lembut, Level 2: istirahat)
     - Focus score + analytics
  -> Download Modul PDF (proper PDF via jsPDF, bukan TXT)
```

**Focus Detector:**
- Deteksi wajah (FaceDetector API + frame diff)
- Deteksi noise ambient (mic audio analyser)
- 100% client-side, video tidak dikirim ke server
- Toggle on/off, sensitivitas bisa diatur

### 3. AI Memory (Long-term Personalization)

AI mengingat user untuk pengalaman "rumah kedua":
- Greeting personal ("Selamat pagi, [nama]! Streak 7 hari!")
- Learning style preference (casual, formal, concise, detailed)
- Pomodoro preference (default 25/5, bisa custom)
- Focus sensitivity preference
- Recent activity (last 10 actions)
- Pending tasks (AI suggest on next visit)
- Quiz stats (total taken, accuracy)
- Streak tracking (current + longest)
- All stored in browser localStorage

### 4. Ambient Themes (Study Atmosphere)

Pilihan suara ambient untuk belajar yang nyaman:
- Lo-Fi (synthesized chord progression + vinyl crackle)
- White Noise
- Rain (filtered noise)
- Forest (filtered noise + bird chirps)
- Off
- Volume control
- 100% client-side via Web Audio API (no audio files)

### 5. Weekly Analytics Dashboard

Statistik belajar 7 hari terakhir:
- Total minutes studied
- Total sessions
- Streak (current + longest)
- Quiz accuracy
- Daily bar chart (visual)
- Best day highlight
- Achievements/badges (First Step, Consistent, Monthly Master, 10 Jam, Quiz Master)
- Total stats (all-time)

### 6. Referral System

Ajak teman, dapat bonus:
- Unique referral code (ALYNNE-XXXXXX)
- Share link (copy / Web Share API / WhatsApp)
- Track: teman bergabung, bulan gratis didapat
- "Give 1 month, Get 1 month" model

### 7. Modul PDF Generator (Proper PDF)

- Micro PDF per bab (jsPDF, dengan header, content, quiz, footer)
- Master PDF (cover page + table of contents + all chapters + all quizzes)
- Proper formatting: margins, page numbers, colored headers
- Tier 1/2/3 LLM structuring (Groq/Qwen fallback)

### 8. Mind Map

- Visual SVG radial graph (MindmapGraph component)
- Center node: root title
- Outer nodes: chapters (clickable)
- Active chapter highlighted with glow effect
- Connection lines (dashed = inactive, solid = active)
- Interactive: click node to select chapter

### 9. AI Assistant

- Chat dengan AI (Groq/Qwen backend)
- Context dari transkrip dan materi
- Multi-turn conversation

### 10. Image Sharpener

- Upscale gambar low-res
- AI enhancement

### 11. Lab 3D: Alat Peraga Interaktif (Three.js)

Mengubah konsep materi menjadi alat peraga 3D ringan yang bisa diputar 360 derajat, di-zoom, dan dibedah bagian-bagiannya (explode view dengan label anotasi). Tab `Lab 3D` (`ThreeDExplainer.tsx`), 3 model parametrik tanpa file aset:

- **Kubus (s = 2)**: 6 sisi terpisah saat dibedah (mirip jaring-jaring), diagonal ruang `d = s√3`, rumus V = s³ dan L = 6s²
- **Struktur sel hewan**: membran, inti sel, mitokondria, retikulum endoplasma, badan Golgi, ribosom (semua berlabel fungsi)
- **Molekul**: H2O (bengkok 104,5°, polar), CO2 (linear 180°, rangkap dua, nonpolar), CH4 (tetrahedral 109,5°) — ball-and-stick dengan ikatan yang ikut memanjang saat dibedah

Interaksi: OrbitControls (drag 360°, scroll zoom), auto-rotate opsional, toggle label, reset tampilan. `prefers-reduced-motion` dihormati (explode instan, auto-rotate mati). Label dirender sebagai overlay HTML yang diproyeksikan dari koordinat 3D tiap frame.

### 12. Simulasi Sidang Skripsi & Ujian Lisan

AI berperan sebagai "dosen penguji" untuk menguji argumen dan kesiapan mental sebelum sidang (tab `Simulasi Sidang`, `SidangSimulator.tsx`):

- Setup: judul/topik, bidang, jumlah pertanyaan (5/7/10), gaya penguji (skeptis / netral / membantu)
- Suara: TTS membacakan pertanyaan (`text-to-speech.ts`), jawaban lewat mikrofon (Web Speech API, id-ID) atau teks
- Pertanyaan berjenjang: urgensi → teori → metodologi → analisis → pertahanan; penguji meminta klarifikasi spesifik kalau jawaban kabur
- Evaluasi akhir: skor rubrik 4 aspek (penguasaan materi, ketajaman argumen, kejelasan penyampaian, ketahanan menghadapi tekanan), catatan per pertanyaan, kekuatan, yang harus diperbaiki
- Anti-halusinasi: penilaian dikunci hanya pada judul/topik dan jawaban yang diberikan

### 13. Mode SKS (Sistem Kebut Semalam) + Detektor Jebakan Soal

Saat waktu belajar mepet (H-1 jam ujian), saring 30% inti materi paling krusial dan prediksi soal pengecoh (tab `Mode SKS`, `CramMode.tsx` + API `api/ai/cram.ts`):

- Sumber: tempel manual, transkrip terakhir, atau materi unggahan (dari store)
- Output: inti 30% berprioritas (wajib/penting + alasan), 4-6 prediksi soal pengecoh interaktif (jawaban pengecoh + kenapa menggoda + penjelasan), fakta kilat untuk hafalan, checklist belajar H-1
- Tipe ujian: UTBK/SNBT, UAS kampus, kuis kilat, ujian lisan
- Fallback offline: kalau server AI mati, heuristic lokal tetap menyaring ±30% paragraf terpenting (definisi/angka/heading); deteksi jebakan tetap butuh server
- Strict grounding: jawaban terkunci hanya pada materi yang dimasukkan user

### 14. Lab Teks: Penerjemah Tongkrongan, Korektor Esai, Audit Catatan

Tiga alat teks dalam satu tab (`Lab Teks`, `LabTeks.tsx`, semua lewat `/api/ai/chat`):

- **Penerjemah tongkrongan**: jurnal/slide dosen yang kaku → penjelasan santai (3 tingkat: santai banget, seimbang, untuk presentasi) — istilah teknis dipertahankan + dijelaskan, fakta tidak diubah
- **Korektor esai**: draf dinilai sesuai rubrik (esai umum / proposal PKM / bab skripsi / esai beasiswa) — nilai total, skor per komponen, kekuatan, revisi urut prioritas dengan kutipan kalimat asli
- **Audit catatan**: catatan kamu vs materi/slide dosen → salah konsep (kutipan asli + fakta benar), bagian terlewat, bagian yang sudah tertangkap

### 15. Konteks Hiper-Lokal Indonesia + Anti-Halusinasi

- Semua prompt fitur baru ditulis untuk konteks kampus/kurikulum Indonesia: gaya dosen penguji sidang, soal ala UTBK/SNBT dan UAS kampus, rubrik PKM, bahasa Indonesia formal ↔ santai
- Strict grounding di seluruh fitur AI baru: Mode SKS hanya menjawab dari materi user, korektor esai kutip teks asli, audit catatan hanya membandingkan dua teks yang diberikan, dosen penguji dilarang mengarang data/kutipan

## Roadmap (planned)

Urutan berikutnya sesuai rencana produk:

1. **Chrome Extension "ALYNNE Companion"**: mode ketiduran/bengong (rangkum 10 menit terakhir Google Meet/Zoom), radar absen & generator pertanyaan keaktifan, one-click clipper + integrator Google Classroom/Moodle
2. **Bot WhatsApp / Telegram**: foto papan tulis atau forward PDF dari grup kelas → otomatis jadi modul belajar di akun web
3. **Mabar Kuis & shareable deck**: multiplayer quiz battle + tautan berbagi satu klik ke grup kelas (leaderboard tanpa upload ulang materi); saat ini `QuizBattle` masih single-player
4. **AI Study Buddy proaktif (maskot)**: karakter di pojok layar yang menyapa dan menawarkan bantuan 3D/analogi saat user terlihat stuck; saat ini `StudyBuddy` baru mode diskusi on-demand
5. **Strict grounding dengan rujukan halaman**: kuis/rangkuman terkunci pada PDF user lengkap dengan sitasi halaman

## Tech Stack

**Frontend:**
- Astro 5.7 + React 19
- TypeScript
- Tailwind CSS
- shadcn/ui components
- Zustand (state management, persisted to localStorage)
- transformers.js v4 (ONNX Runtime Web untuk client-side Whisper)
- jsPDF (proper PDF generation)
- three.js (Lab 3D: alat peraga WebGL interaktif)
- Web Audio API (ambient sounds synthesis)

**Backend:**
- Node.js (Astro SSR) on port 3000
- Python faster-whisper on port 8000 (PM2 managed)
- Cloudflare D1 (HTTP API) untuk user data

**Infrastructure:**
- VPS: 8GB RAM, 2 CPU, 48GB SSD
- PM2 process manager
- Caddy reverse proxy (HTTPS via alynne.my.id)
- Cross-Origin headers untuk SharedArrayBuffer support

## Database Schema

Cloudflare D1 (single table, simplified):

```sql
CREATE TABLE User (
  uid TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  gmail TEXT NOT NULL UNIQUE,
  activeSubscription TEXT NOT NULL DEFAULT "trial",
  packetSubscription TEXT NOT NULL DEFAULT "none",
  createdAt TEXT NOT NULL DEFAULT (datetime("now"))
);
```

STT history, AI memory, personal dictionary, focus stats, referral data
semua disimpan di browser localStorage (hemat D1 quota).

## Deployment

```bash
# Frontend
cd /root/lina-learning
npm run build
pm2 restart lina-learning

# Backend (whisper)
pm2 restart whisper-backend
```

## Pricing

| Tier | Price | Features |
|------|-------|----------|
| Lite | Rp 50.000 | 50 chat/day, STT dasar, 7-day history |
| Plus | Rp 100.000 | Unlimited chat, STT + Screen capture, PDF, Mind Map |
| Pro | Rp 200.000 | All Plus + faster-whisper HD, analytics |
| Ultra | Rp 350.000 | All Pro + 25 akun, custom AI persona |

## Architecture Flow

```
User
  -> Web Speech API (real-time, instant feedback)
  -> MediaRecorder (parallel audio capture)
  -> Stop -> Whisper post-processing
  -> (Mode Offline: client Web Worker | Mode Online: server)
  -> Transcript
  -> User chooses:
     - Buat Modul PDF -> AI structures content -> jsPDF download
     - Generate Langsung -> STT + PDF in one click
     - Mode Belajar -> Chapters + Visual Mindmap + Quiz + Focus Timer
       + Ambient Sounds + Analytics tracking
  -> AI Memory records activity, updates streak, suggests pending tasks
```

## Privacy

- STT transcript: localStorage (browser, tidak dikirim ke server)
- Webcam video: 100% client-side, tidak direkam/dikirim
- AI Memory: localStorage (preferences, stats, activity history)
- Ambient audio: synthesized in-browser, no audio files
- User account: Cloudflare D1 (uid, username, gmail, subscription status)
- Referral: code stored in localStorage, no PII shared
- Tidak ada tracking third-party

## Development

```bash
npm install
npm run dev
npm run build
npm run preview
```

## License

Proprietary - Povycon Technology 2026
