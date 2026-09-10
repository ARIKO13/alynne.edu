# 🔑 Environment Variables

## Frontend (`frontend/.env`)

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `production` |
| `HOST` | Bind address | `0.0.0.0` |
| `PORT` | App port | `3000` |
| `NEXTAUTH_URL` | App URL | `https://alynne.my.id` |
| `NEXTAUTH_SECRET` | Auth secret | random string |
| `GOOGLE_CLIENT_ID` | Google OAuth | `xxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth | `GOCSPX-xxx` |
| `GATEWAY_API_KEY` | Gateway API | `gw_sk_xxx` |
| `GROQ_API_KEY` | Groq AI | `gsk_xxx` |
| `GROQ_PDF_KEY` | Groq PDF | `gsk_xxx` |
| `CF_API_TOKEN` | Cloudflare D1 | `cfut_xxx` |
| `CF_ACCOUNT_ID` | CF Account | hex string |
| `CF_DATABASE_ID` | D1 Database ID | UUID |

## Backend (`backend/ecosystem.config.cjs` env section)

| Variable | Default | Description |
|----------|---------|-------------|
| `WHISPER_MODEL` | `large-v3-turbo` | Whisper model |
| `WHISPER_COMPUTE` | `int8` | Quantization (8-bit) |
| `CHUNK_MINUTES` | `1` | Transcribe chunk size |
| `CHUNK_COOLDOWN` | `0.5` | Seconds between chunks |
| `QWEN_MODEL_PATH` | `/root/models/...` | Qwen GGUF path |
| `QWEN_N_CTX` | `4096` | Context window |
| `MAX_QUEUE_SIZE` | `10` | Max queued jobs |
| `IDLE_TIMEOUT` | `300` | Auto-unload after N seconds idle |
