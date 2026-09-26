# ALYNNE.EDU - AI Education Platform

Platform AI edukasi all-in-one untuk pelajar, mahasiswa, guru, dan institusi. Speech-to-Text, Modul PDF, Mind Map, AI Assistant, dan Mode Belajar dengan focus detector, semua dalam satu alur kerja terintegrasi.

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
  -> Mindmap animasi (nested tree view)
  -> Kuis interaktif per bab (multiple choice, fill-in-blank)
  -> Mulai Sesi Belajar:
     - Pomodoro timer (25/5)
     - Webcam focus detector (face + gaze tracking)
     - Smart warnings (Level 1: lembut, Level 2: istirahat)
     - Focus score + analytics
  -> Download Modul (TXT, semua bab + kuis)
```

**Focus Detector:**
- Deteksi wajah (FaceDetector API + frame diff)
- Deteksi noise ambient (mic audio analyser)
- 100% client-side, video tidak dikirim ke server
- Toggle on/off, sensitivitas bisa diatur

### 3. Modul PDF Generator

- Upload PDF/DOCX/PPTX/TXT
- AI struktur konten jadi modul belajar
- Tier 1: LLM cloud (Groq/Qwen)
- Tier 2: LLM fallback
- Tier 3: Local structure (offline)

### 4. Mind Map

- Generate dari transkrip STT
- Generate dari materi upload
- Interactive node expansion

### 5. AI Assistant

- Chat dengan AI (Groq/Qwen backend)
- Context dari transkrip dan materi
- Multi-turn conversation

### 6. Image Sharpener

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
  activeSubscription TEXT NOT NULL DEFAULT 'trial',
  packetSubscription TEXT NOT NULL DEFAULT 'none',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
```

STT history dan personal dictionary disimpan di browser localStorage (hemat D1 quota).

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
     - Buat Modul PDF -> AI structures content
     - Generate Langsung -> STT + PDF in one click
     - Mode Belajar -> Chapters + Mindmap + Quiz + Focus Timer
```

## Privacy

- STT transcript: localStorage (browser, tidak dikirim ke server)
- Webcam video: 100% client-side, tidak direkam/dikirim
- User account: Cloudflare D1 (uid, username, gmail, subscription status)
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
