# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MedTranslate is a HIPAA-compliant, real-time medical translation PWA for hospital bedside use. It translates bidirectionally between **English ↔ Spanish** and **English ↔ Haitian Creole**.

**Public URL**: `https://translate.theaidoc.ai` (via Cloudflare Tunnel)

## Build & Run Commands

### Client (port 3000/3005)
```bash
cd client
npm install
npm run dev        # Vite dev server (HTTPS required for mic permissions)
npm run build      # Production build
```

### Server (port 8443/8000)
```bash
cd server
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8443 --ssl-keyfile certs/key.pem --ssl-certfile certs/cert.pem
```

### Full Stack (Docker)
```bash
docker-compose up
```

### Server Tests
```bash
cd server && pytest tests/ -v
```

### E2E Tests (Playwright)
```bash
cd client && npx playwright test
```

## Production Services (macOS launchd)

The app runs as three macOS Launch Agents located in `~/Library/LaunchAgents/`:
- `ai.theaidoc.medtranslate-frontend.plist` — Vite dev server
- `ai.theaidoc.medtranslate-backend.plist` — FastAPI server (requires SSL certs at `server/certs/`)
- `ai.theaidoc.medtranslate-tunnel.plist` — Cloudflare tunnel to `translate.theaidoc.ai`

```bash
# Restart services
launchctl unload ~/Library/LaunchAgents/ai.theaidoc.medtranslate-*.plist
launchctl load ~/Library/LaunchAgents/ai.theaidoc.medtranslate-*.plist

# Check logs
tail -f /tmp/medtranslate-*.err /tmp/medtranslate-*.log
```

## Architecture

```
Phone (PWA) <-WSS-> FastAPI Server -> Translation API -> WSS -> Phone
                         |
                    Supabase (session metadata + audit trail, NO PHI)
```

### Three Components

| Component | Path | Tech | Purpose |
|-----------|------|------|---------|
| Client | `/client/` | Vite + Vanilla JS | Mobile-first PWA |
| Server | `/server/` | FastAPI + WebSockets | Translation orchestration |
| Database | `/supabase/` | PostgreSQL + RLS | Sessions & audit (no PHI) |

### Key Client Files
- `client/js/app.js` — State machine, audio recording, WebSocket, slidable mic direction logic
- `client/js/audio-processor.js` — WebAudio mic capture at 24kHz

### Key Server Files
- `server/app/main.py` — FastAPI app, `/ws/translate` WebSocket endpoint
- `server/app/translation.py` — Translation API integration (Riva or OpenAI-compatible)
- `server/app/tts.py` — Text-to-speech handling
- `server/app/hipaa/` — Audit logging, AES-256-GCM encryption, session lifecycle

## Environment Variables

Server requires a `.env` file in `/server/`:
```
NVIDIA_API_KEY=           # For Riva APIs
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
```

## HIPAA Constraints (Critical)

**All code MUST follow these rules:**

1. **NEVER log audio content, transcripts, or patient speech** to files, console, or database
2. **NEVER write audio to disk** — all audio processing must be in-memory only
3. **Audio buffers must be ephemeral** — zeroed and freed when session ends
4. **Session metadata only** in database: session ID, user ID, timestamps, language pair, duration
5. **TLS everywhere** — WebSocket connections must use WSS (TLS 1.3)
6. **AES-256-GCM** for any in-memory audio buffer encryption

## UI/UX Notes

- **Slidable Mic**: Hold-to-translate button slides left (EN→ES) or right (ES→EN) to change direction
- **Dark mode**: Deep navy/charcoal with high contrast for bright hospital lighting
- **Large touch targets**: Minimum 48px, usable with gloved hands
- **Three screens**: Login (PIN/Google/Apple/Guest) → Language Selection → Active Translation

## Authentication

Users can log in via Google, Apple, or continue as Guest. Premium features (Voice Model Contribution) require authentication.
