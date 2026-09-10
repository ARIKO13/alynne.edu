# ALYNNE.EDU

Full-stack learning platform with AI-powered transcription, chat, and study tools.

## 📁 Project Structure

```
alynne.edu/
├── frontend/              # Astro + React app (lina-learning)
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Astro pages + API routes
│   │   ├── hooks/         # React hooks (use-speech-recognition, etc)
│   │   ├── lib/           # Utilities (store, webllm, pdf-generator, etc)
│   │   └── styles/        # CSS
│   ├── public/            # Static assets
│   ├── package.json
│   ├── astro.config.mjs
│   └── ecosystem.config.cjs  # PM2 config
│
├── whisper-backend/       # FastAPI backend (Whisper STT + Qwen LLM)
│   ├── main.py            # Main API (v7: lazy chunking + subprocess + queue)
│   └── ecosystem.config.cjs
│
├── config/                # Server configs
│   └── Caddyfile          # Caddy reverse proxy config
│
├── scripts/               # Utility scripts
│   ├── deploy.py          # Deployment helpers
│   └── ...
│
└── README.md
```

## 🏗️ Architecture

```
Browser → Caddy (443) → Astro (3000) → whisper-backend (8000)
                          ↓                    ↓
                     Cloudflare D1        Whisper large-v3-turbo (int8)
                     (User, Subscription, Qwen2.5-1.5B-Instruct (4-bit)
                      MindMap, Progress)
```

### Frontend Stack
- **Astro 5** (SSR mode, Node adapter)
- **React 19** (islands)
- **Tailwind CSS 4**
- **Zustand** (state management, persisted to localStorage)
- **WebLLM** (client-side AI via WebGPU)

### Backend Stack
- **FastAPI** (Python)
- **faster-whisper** large-v3-turbo (int8, 8-bit)
- **llama-cpp-python** + Qwen2.5-1.5B-Instruct (Q4_K_M, 4-bit)
- **Job queue** (in-memory, 1 worker, max 10 jobs)
- **Subprocess isolation** (100% RAM reclaim per chunk)
- **Lazy chunking** (1-minute chunks, ffmpeg split)

### Infrastructure
- **Caddy 2** (auto HTTPS, reverse proxy)
- **PM2** (process manager)
- **Cloudflare D1** (SQLite database)
- **UFW + Fail2ban** (security)

## 🚀 Features

### Speech-to-Text
- **Web Speech API** (primary, browser-based, free, unlimited)
- **Whisper large-v3-turbo** (server, for uploaded files)
- **Groq API** (fallback, fast external)
- **Hybrid capture** (mic + system audio for Zoom/Meet)
- **Chunked upload** (25MB chunks, no timeout)
- **YouTube Transkrip** (instant, no processing)

### AI Chat
- **WebLLM** (client-side, browser WebGPU, free)
- **Groq API** (server fallback)
- **Qwen 1.5B** (local server fallback)

### Other
- Google OAuth authentication
- Mind map generation
- PDF generation (jsPDF)
- Game/quiz system
- Progress tracking + certificates
- Subscription/payment (Midtrans QRIS)

## 🔧 Setup

### Prerequisites
- Node.js 20+
- Python 3.12+
- ffmpeg
- 8GB RAM (for whisper + qwen)

### Frontend
```bash
cd frontend
cp .env.template .env  # Fill in your values
npm install --legacy-peer-deps
npm run build
pm2 start ecosystem.config.cjs
```

### Whisper Backend
```bash
cd whisper-backend
pip install faster-whisper uvicorn fastapi python-multipart llama-cpp-python
# Download models:
# - Whisper: automatic (first run)
# - Qwen: huggingface-cli download Qwen/Qwen2.5-1.5B-Instruct-GGUF qwen2.5-1.5b-instruct-q4_k_m.gguf
pm2 start ecosystem.config.cjs
```

### Caddy
```bash
sudo cp config/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 🌐 Production

- **VPS**: 176.100.37.238 (ServerUtama, Ubuntu 24.04, 8GB RAM, 2 vCPU)
- **Domain**: alynne.my.id
- **SSL**: Let's Encrypt (auto via Caddy)

## 📝 License

Private project. All rights reserved.
