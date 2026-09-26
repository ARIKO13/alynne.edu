# ALYNNE.EDU - AI Education Platform

Platform AI edukasi all-in-one untuk pelajar, mahasiswa, guru, dan institusi. Speech-to-Text, Modul PDF, Mind Map, AI Assistant, Mode Belajar dengan focus detector, ambient sounds, analytics, dan referral system, semua dalam satu alur kerja terintegrasi.

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
     - Pomodoro timer (25/5)
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

## Tech Stack

**Frontend:**
- Astro 5.7 + React 19
- TypeScript
- Tailwind CSS
- shadcn/ui components
- Zustand (state management, persisted to localStorage)
- transformers.js v4 (ONNX Runtime Web untuk client-side Whisper)
- jsPDF (proper PDF generation)
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
