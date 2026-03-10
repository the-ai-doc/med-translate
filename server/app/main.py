"""
MedTranslate — FastAPI Server
WebSocket endpoint for real-time medical translation.
Client does ASR via Web Speech API, server translates via NVIDIA NIM.
"""
import logging
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, File, Form, UploadFile, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx
import uuid
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .hipaa.audit import AuditLogger
from .hipaa.session import SessionManager
from .translation import TranslationPipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("medtranslate")


@asynccontextmanager
async def lifespan(app):
    logger.info("MedTranslate server starting...")
    app.state.translation = TranslationPipeline()
    await app.state.translation.initialize()
    app.state.audit = AuditLogger()
    app.state.sessions = SessionManager()
    app.state.http = httpx.AsyncClient(timeout=30.0)
    logger.info("All services initialized")
    yield
    await app.state.http.aclose()
    await app.state.translation.shutdown()
    logger.info("MedTranslate server stopped")


app = FastAPI(
    title="MedTranslate",
    description="HIPAA-Compliant Real-Time Medical Translation",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "MedTranslate",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ── TTS Proxy (forwards to Modal serverless function) ───────────────
class TTSRequest(BaseModel):
    text: str
    lang: str = "ht"


@app.post("/api/tts")
@app.get("/api/tts")
async def text_to_speech(text: str = None, lang: str = "ht", req: TTSRequest = None):
    """
    Proxy TTS requests to ElevenLabs API using HTTP streaming.
    Streams chunks using eleven_turbo_v2_5 for ultra-low latency.
    Supports GET (for direct <audio src> streaming on iOS) and POST.
    """
    input_text = text if text else (req.text if req else "")
    input_lang = lang if text else (req.lang if req else "ht")

    if not input_text:
        raise HTTPException(status_code=400, detail="Text is required")

    if not settings.elevenlabs_api_key:
        logger.error("ElevenLabs API key missing for TTS")
        raise HTTPException(status_code=503, detail="ElevenLabs audio not configured")

    # Use George (JBFqnCBcs6Z1x3S6H7Zc) - a warm, reassuring, English-native voice 
    # that Eleven Turbo v2.5 can flex into ~32 languages automatically.
    voice_id = "JBFqnCBcs6Z1x3S6H7Zc" 

    payload = {
        "text": input_text,
        "model_id": "eleven_turbo_v2_5",
        "output_format": "mp3_44100_128",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75
        }
    }
    
    headers = {
        "xi-api-key": settings.elevenlabs_api_key,
        "Content-Type": "application/json"
    }

    async def stream_audio():
        try:
            # Open a streaming connection to ElevenLabs and yield raw bytes
            # instantly as they arrive, enabling sub-250ms playback.
            async with httpx.AsyncClient() as client:
                async with client.stream(
                    "POST",
                    f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream",
                    headers=headers,
                    json=payload,
                    timeout=20.0
                ) as response:
                    response.raise_for_status()
                    async for chunk in response.aiter_bytes():
                        yield chunk
        except httpx.HTTPStatusError as e:
            logger.error("ElevenLabs HTTP error: %s - %s", e.response.status_code, e)
        except Exception as e:
            logger.error("ElevenLabs stream error: %s", e)

    return StreamingResponse(
        stream_audio(),
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": "inline",
            "Transfer-Encoding": "chunked"
        }
    )


@app.post("/api/train")
async def handle_training_upload(
    audio: UploadFile = File(...),
    phrase: str = Form("..."),
    lang: str = Form("ht"),
    pin: str = Form("000000")
):
    """
    Receives optimized .webm audio from the frontend Training Portal,
    and pipes it directly into the HIPAA-compliant Supabase Storage bucket.
    """
    if not settings.supabase_url or not settings.supabase_service_key:
        logger.warning(f"Audio received from {pin} but Supabase is not configured.")
        return {"status": "mock_success", "message": "Audio received. Configure Supabase to persist."}

    headers = {
        "apikey": settings.supabase_service_key,
        "Authorization": f"Bearer {settings.supabase_service_key}"
    }

    try:
        audio_bytes = await audio.read()
        file_id = str(uuid.uuid4())
        file_path = f"{lang}/{pin}/{file_id}.webm"
        
        # 1. Upload audio to Supabase Storage
        upload_url = f"{settings.supabase_url}/storage/v1/object/voice-training-bucket/{file_path}"
        async with httpx.AsyncClient() as client:
            upload_res = await client.post(
                upload_url,
                headers={**headers, "Content-Type": "audio/webm"},
                content=audio_bytes
            )
            upload_res.raise_for_status()
        
        public_audio_url = f"{settings.supabase_url}/storage/v1/object/public/voice-training-bucket/{file_path}"

        # 2. Mock Phrase Lookup / Insertion
        insert_url = f"{settings.supabase_url}/rest/v1/voice_contributions"
        payload = {
            "phrase_id": None, 
            "provider_pin": pin,
            "language_code": lang,
            "audio_url": public_audio_url,
            "is_approved": None
        }
        async with httpx.AsyncClient() as client:
            await client.post(insert_url, headers={**headers, "Content-Type": "application/json", "Prefer": "return=minimal"}, json=payload)
            
        return {"status": "success", "file_id": file_id}

    except Exception as e:
        logger.error(f"Error processing training audio: {e}")
        raise HTTPException(status_code=500, detail=str(e))




@app.get("/api/train/queue")
async def get_training_queue():
    if not settings.supabase_url: return []
    headers = {"apikey": settings.supabase_service_key, "Authorization": f"Bearer {settings.supabase_service_key}"}
    url = f"{settings.supabase_url}/rest/v1/voice_contributions?is_approved=is.null&limit=10"
    async with httpx.AsyncClient() as client:
        res = await client.get(url, headers=headers)
        return res.json() if res.status_code == 200 else []

@app.post("/api/train/review")
async def submit_training_review(record_id: str = Form(...), is_approved: bool = Form(...), pin: str = Form(...)):
    if not settings.supabase_url: return {"status": "error"}
    headers = {"apikey": settings.supabase_service_key, "Authorization": f"Bearer {settings.supabase_service_key}", "Content-Type": "application/json"}
    url = f"{settings.supabase_url}/rest/v1/voice_contributions?id=eq.{record_id}"
    payload = {"is_approved": is_approved, "reviewed_by": pin}
    async with httpx.AsyncClient() as client:
        res = await client.patch(url, headers=headers, json=payload)
        res.raise_for_status()
    return {"status": "success"}

@app.get("/api/phrases/custom")
async def get_custom_phrases(pin: str):
    if not settings.supabase_url: return []
    headers = {"apikey": settings.supabase_service_key, "Authorization": f"Bearer {settings.supabase_service_key}"}
    url = f"{settings.supabase_url}/rest/v1/custom_phrases?provider_pin=eq.{pin}&order=created_at.desc"
    async with httpx.AsyncClient() as client:
        res = await client.get(url, headers=headers)
        return res.json() if res.status_code == 200 else []

@app.post("/api/phrases/custom")
async def add_custom_phrase(pin: str = Form(...), phrase: str = Form(...)):
    if not settings.supabase_url: return {"status": "error"}
    headers = {"apikey": settings.supabase_service_key, "Authorization": f"Bearer {settings.supabase_service_key}", "Content-Type": "application/json", "Prefer": "return=minimal"}
    url = f"{settings.supabase_url}/rest/v1/custom_phrases"
    payload = {"provider_pin": pin, "phrase_text": phrase, "category": "Custom"}
    async with httpx.AsyncClient() as client:
        res = await client.post(url, headers=headers, json=payload)
        res.raise_for_status()
    return {"status": "success"}
@app.websocket("/ws")
async def translation_session(ws: WebSocket):
    """
    Text-based translation WebSocket.
    
    Client sends JSON:
      { "type": "translate", "text": "...", "from": "en", "to": "es", "session_id": "..." }
      { "type": "start_session", "from": "en", "to": "es", "session_id": "..." }
      { "type": "end_session", "session_id": "..." }
    
    Server responds JSON:
      { "type": "translation", "original": "...", "text": "..." }
      { "type": "error", "message": "..." }
    """
    await ws.accept()
    session_id = None
    pipeline = app.state.translation
    sessions = app.state.sessions
    audit = app.state.audit

    logger.info("WebSocket connected")

    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type", "")

            if msg_type == "start_session":
                session_id = data.get("session_id", "unknown")
                from_lang = data.get("from", "en")
                to_lang = data.get("to", "es")
                await sessions.create(session_id, from_lang, to_lang)
                await audit.log("session_start", session_id, {"from": from_lang, "to": to_lang})
                await ws.send_json({"type": "session_started", "session_id": session_id})
                logger.info("Session %s started: %s->%s", session_id[:8], from_lang, to_lang)

            elif msg_type == "translate":
                text = data.get("text", "").strip()
                from_lang = data.get("from", "en")
                to_lang = data.get("to", "es")
                sid = data.get("session_id", session_id or "unknown")

                if not text:
                    continue

                logger.info("Translating [%s->%s]: %s", from_lang, to_lang, text[:60])

                translation = await pipeline.translate(text, from_lang, to_lang)

                if translation:
                    await ws.send_json({
                        "type": "translation",
                        "original": text,
                        "text": translation,
                    })
                    logger.info("Translation sent: %s", translation[:60])
                else:
                    await ws.send_json({
                        "type": "error",
                        "message": "Translation failed — please repeat",
                    })

            elif msg_type == "end_session":
                sid = data.get("session_id", session_id)
                if sid:
                    duration = sessions.get_duration(sid)
                    await sessions.end(sid)
                    await audit.log("session_end", sid, {"duration_seconds": duration})
                    logger.info("Session %s ended (%ds)", sid[:8], duration)
                await ws.send_json({"type": "session_ended"})

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error("WebSocket error: %s", e)
    finally:
        if session_id:
            await sessions.end(session_id)
