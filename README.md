# ALYNNE.EDU

Full-stack learning platform with AI-powered transcription, chat, and study tools.

## 📁 Project Structure

```
alynne.edu/
├── frontend/              # Astro + React app (UI only)
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Astro pages + API routes
│   │   ├── hooks/         # React hooks
│   │   ├── lib/           # Utilities (store, webllm, etc)
│   │   └── styles/
│   ├── public/
│   ├── package.json
│   └── astro.config.mjs
│
├── backend/               # Everything server-side
│   ├── main.py            # Whisper + Qwen API (FastAPI)
│   ├── ecosystem.config.cjs
│   ├── config/            # Server configs
│   │   ├── Caddyfile
│   │   ├── frontend.env       # API keys, DB credentials
│   │   ├── backend.env        # Whisper + Qwen config
│   │   └── *.ecosystem.config.cjs
│   ├── credentials/       # SSH keys + VPS access
│   │   ├── vps_new_sshkey
│   │   └── vps-new-credentials.*
│   ├── database/          # DB schema
│   │   └── schema.sql
│   ├── docs/              # Documentation
│   │   ├── ARCHITECTURE.md
│   │   ├── DEPLOYMENT.md
│   │   └── ENVIRONMENT.md
│   └── scripts/           # Deploy utilities
│
└── README.md
```

## 🏗️ Architecture

```
Browser → Caddy (443) → Astro frontend (3000) → whisper-backend (8000)
                          ↓                          ↓
                   Cloudflare D1              Whisper large-v3-turbo
                   (User, Subscription,       Qwen2.5-1.5B-Instruct (4-bit)
                    MindMap, Progress)
```

## 🔧 Quick Start

### Frontend
```bash
cd frontend
cp ../backend/config/frontend.env .env
npm install --legacy-peer-deps
npm run build
pm2 start ecosystem.config.cjs
```

### Backend
```bash
cd backend
pip install faster-whisper uvicorn fastapi python-multipart llama-cpp-python
pm2 start ecosystem.config.cjs
```

See `backend/docs/DEPLOYMENT.md` for full setup guide.
