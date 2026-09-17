# 📚 Architecture

## System Overview

```
                    ┌─────────────┐
                    │   Browser    │
                    │  (Chrome 113+)│
                    └──────┬──────┘
                           │ HTTPS
                    ┌──────▼──────┐
                    │   Caddy 2    │ (port 443, auto SSL)
                    │ Reverse Proxy│
                    └──┬───────┬──┘
                       │       │
          ┌────────────▼──┐   ┌─▼──────────────┐
          │  Astro (3000)  │   │ Whisper (8000) │
          │  Frontend + API│   │   Backend      │
          └───────┬────────┘   └───────┬────────┘
                  │                    │
         ┌────────┼──────────┐         │
         │        │          │         │
   ┌─────▼──┐ ┌──▼───┐ ┌───▼────┐  ┌──▼──────────┐
   │ CF D1  │ │ Groq │ │Gateway │  │ Whisper     │
   │ (DB)   │ │ API  │ │  API   │  │ large-v3-   │
   └────────┘ └──────┘ └────────┘  │ turbo (int8)│
                                   ├─────────────┤
                                   │ Qwen 1.5B   │
                                   │ (4-bit Q4)  │
                                   └─────────────┘
```

## Frontend (Astro + React)

### Pages
- `/` — Landing page
- `/about` — About
- `/contact` — Contact
- `/edu` — Main app (login → dashboard)
- `/manual` — Manual input

### API Routes (`src/pages/api/`)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/*` | GET/POST | Google OAuth (login, callback, session, logout) |
| `/api/ai/chat` | POST | AI chat (Groq → Qwen fallback) |
| `/api/stt/groq` | POST | Groq Whisper STT |
| `/api/stt/enhance` | POST | Text enhancement (local dict → Groq → Qwen) |
| `/api/whisper/transcribe` | POST | Upload file → whisper-backend |
| `/api/whisper/transcribe-chunk-stream` | POST | Chunked upload (25MB) |
| `/api/whisper/transcribe-chunked/[id]` | POST | Trigger transcribe after upload |
| `/api/whisper/jobs/[id]` | GET/DELETE | Poll job status / cancel |
| `/api/youtube/transcript` | POST | YouTube caption fetch (instant) |
| `/api/bookmarks/*` | GET/POST/DELETE | User bookmarks |
| `/api/mindmaps/*` | GET/POST/DELETE | Mind map CRUD |
| `/api/payment/*` | POST | Midtrans QRIS payment |
| `/api/progress/*` | GET/POST | Progress tracking |
| `/api/admin/*` | GET | Admin stats/users |
| `/api/user/*` | GET/PUT | User profile |

### Components
| Component | Description |
|-----------|-------------|
| `STTPanel` | Speech-to-Text (Web Speech + Whisper + Groq) |
| `MediaUpload` | File upload (chunked 25MB + duration warning) |
| `YouTubeTranscript` | YouTube URL → instant transcript |
| `AIAssistant` | AI Chat (WebLLM → Groq → Qwen) |
| `MindmapPanel` | Mind map generation |
| `QuizPanel` | Quiz/game system |
| `MaterialUpload` | PDF/material upload |
| `PaymentWall` | Subscription (Midtrans QRIS) |
| `AdminPanel` | Admin dashboard |
| `SettingsDialog` | Settings (API keys, study mode) |

### State Management
- **Zustand** with `persist` middleware (localStorage)
- Key: `lina-learning-v2`
- Persisted: transcript, transcriptEntries, apiKeys, user, studyMode config

## Backend (FastAPI + Whisper + Qwen)

### Endpoints
| Route | Method | Description |
|-------|--------|-------------|
| `/health` | GET | Health check + model status |
| `/transcribe` | POST | Async transcribe (return job_id) |
| `/transcribe/sync` | POST | Sync transcribe (blocking) |
| `/transcribe/stream` | POST | SSE streaming transcribe |
| `/transcribe-chunk-stream` | POST | Upload 25MB chunk (store only) |
| `/transcribe-chunked/{id}` | POST | Trigger transcribe after chunked upload |
| `/jobs` | GET | List all jobs |
| `/jobs/{id}` | GET | Job status + partial_text |
| `/jobs/{id}` | DELETE | Cancel job |
| `/llm/chat` | POST | Qwen chat (OpenAI-compatible) |
| `/llm/enhance` | POST | Qwen text enhancement |
| `/llm/health` | GET | Qwen status |
| `/llm/load` | POST | Manual Qwen load |
| `/llm/unload` | POST | Manual Qwen unload (free RAM) |
| `/cleanup` | POST | Aggressive memory cleanup |

### Processing Pipeline
```
Upload file → Chunk 25MB (client) → Store on server
                                        ↓
                                 Assemble chunks
                                        ↓
                                 ffmpeg → WAV 16kHz
                                        ↓
                                 Split 1-min chunks
                                        ↓
                              For each 1-min chunk:
                                ├── ffmpeg extract
                                ├── subprocess transcribe (whisper)
                                ├── update partial_text
                                ├── gc.collect() + sleep(0.5s)
                                └── next chunk
                                        ↓
                                 Merge all text → complete
```

### Memory Management
- **Subprocess isolation**: each 1-min chunk transcribed in separate process → 100% RAM reclaim
- **Dynamic loading**: Whisper + Qwen loaded on-demand, auto-unload after 5min idle
- **Aggressive cleanup**: gc.collect() + torch.empty_cache() + malloc_trim + drop_caches
- **Queue system**: max 10 jobs, 1 worker (no OOM)

## Database (Cloudflare D1)

### Tables
| Table | Description |
|-------|-------------|
| `User` | User accounts (Google OAuth) |
| `Subscription` | Subscription/trial tracking |
| `DailyProgress` | Daily study progress |
| `MonthlyRecap` | Monthly summary |
| `YearlyRecord` | Yearly summary |
| `MindMap` | Saved mind maps |
| `Certificate` | Generated certificates |
| `_cf_KV` | Cloudflare KV store |

## Security
- SSH key authentication (password disabled)
- UFW firewall (22, 80, 443 only)
- Fail2ban (auto-ban brute-force)
- Auto security updates
- CSRF protection (configurable)
- HTTPS only (Caddy auto-redirect)
