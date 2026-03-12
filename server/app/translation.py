from __future__ import annotations
"""
Translation Pipeline — NVIDIA NIM API (meta/llama-3.3-70b-instruct).
Handles EN↔ES and EN↔HT medical translation via chat completions.
"""
import logging
import httpx
from .config import settings

logger = logging.getLogger("medtranslate.translation")

LANG_NAMES = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "ar": "Arabic",
    "ru": "Russian",
    "zh": "Mandarin Chinese",
    "vi": "Vietnamese",
    "tl": "Tagalog",
    "pt": "Portuguese",
    "ht": "Haitian Creole",
    "hi": "Hindi",
    "ur": "Urdu",
    "ja": "Japanese",
    "de": "German",
}

SYSTEM_PROMPT = (
    "You are a professional medical interpreter providing accurate, "
    "natural-sounding translations. Preserve medical terminology exactly. "
    "Output ONLY the translated text, nothing else — no quotes, no labels, "
    "no explanations, no commentary.\n\n"
    "Examples:\n"
    "User: Translate from English to Spanish: Do you have any allergies to medications?\n"
    "Assistant: ¿Tiene alguna alergia a los medicamentos?\n\n"
    "User: Translate from Spanish to English: Me duele mucho el pecho.\n"
    "Assistant: My chest hurts a lot.\n\n"
    "User: Translate from English to French: When was the last time you ate or drank anything?\n"
    "Assistant: Quand avez-vous mangé ou bu quelque chose pour la dernière fois ?\n\n"
    "User: Translate from English to Hindi: Are you experiencing any pain right now?\n"
    "Assistant: क्या आपको अभी कोई दर्द हो रहा है?\n\n"
    "Follow this exact pattern. Translate faithfully without additions."
)


class TranslationPipeline:
    """Translates text using NVIDIA NIM chat completions API."""

    def __init__(self):
        self._client: httpx.AsyncClient | None = None
        self._model = "meta/llama-3.3-70b-instruct"
        self._api_url = None
        self._api_key = None

    async def initialize(self):
        base_url = settings.riva_api_url
        if base_url and not base_url.startswith("http"):
            base_url = "https://" + base_url
        self._api_url = base_url + "/chat/completions"
        self._api_key = settings.riva_api_key
        self._client = httpx.AsyncClient(timeout=15.0)
        logger.info("Translation pipeline initialized (NVIDIA NIM — %s)", self._model)

    async def shutdown(self):
        if self._client:
            await self._client.aclose()
            logger.info("Translation pipeline shut down")

    def _build_messages(self, text: str, from_lang: str, to_lang: str) -> list[dict]:
        """Build the chat messages array for translation."""
        from_name = LANG_NAMES.get(from_lang, from_lang)
        to_name = LANG_NAMES.get(to_lang, to_lang)
        user_msg = f"Translate the following text from {from_name} to {to_name}:\n\n{text}"
        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ]

    async def translate(self, text: str, from_lang: str, to_lang: str) -> str | None:
        """Translate text between languages. Returns translated string or None on error."""
        try:
            resp = await self._client.post(
                self._api_url,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._model,
                    "messages": self._build_messages(text, from_lang, to_lang),
                    "temperature": 0.1,
                    "max_tokens": 256,
                },
            )

            if resp.status_code != 200:
                logger.error("NIM API error %d: %s", resp.status_code, resp.text[:200])
                return None

            result = resp.json()
            translation = result["choices"][0]["message"]["content"].strip()
            
            # Clean up any unwanted wrapping the model might add
            for prefix in ['"', "'", "Translation:", "Translated:"]:
                if translation.startswith(prefix):
                    translation = translation[len(prefix):]
            for suffix in ['"', "'"]:
                if translation.endswith(suffix):
                    translation = translation[:-len(suffix)]
            
            return translation.strip()

        except httpx.TimeoutException:
            logger.error("NIM API timeout for: %s", text[:40])
            return None
        except Exception as e:
            logger.error("Translation error: %s", e)
            return None

    async def translate_stream(self, text: str, from_lang: str, to_lang: str):
        """
        Stream translation tokens as they arrive from NVIDIA NIM.
        Yields individual tokens/chunks. The caller can send them
        to the client immediately for progressive display.
        
        On error, yields nothing (caller should handle the empty case).
        """
        import json as _json

        try:
            async with self._client.stream(
                "POST",
                self._api_url,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._model,
                    "messages": self._build_messages(text, from_lang, to_lang),
                    "temperature": 0.1,
                    "max_tokens": 256,
                    "stream": True,
                },
            ) as response:
                if response.status_code != 200:
                    await response.aread()
                    logger.error("NIM streaming error %d: %s", response.status_code, response.text[:200])
                    return

                async for line in response.aiter_lines():
                    # SSE format: "data: {...}" or "data: [DONE]"
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:]  # strip "data: "
                    if payload.strip() == "[DONE]":
                        return
                    try:
                        chunk = _json.loads(payload)
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        token = delta.get("content", "")
                        if token:
                            yield token
                    except _json.JSONDecodeError:
                        continue

        except httpx.TimeoutException:
            logger.error("NIM streaming timeout for: %s", text[:40])
        except Exception as e:
            logger.error("Streaming translation error: %s", e)
