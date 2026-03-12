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
    "natural-sounding translations. Preserve medical terminology. "
    "Output ONLY the translated text, nothing else — no quotes, no labels, "
    "no explanations."
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
        self._client = httpx.AsyncClient(timeout=30.0)
        logger.info("Translation pipeline initialized (NVIDIA NIM — %s)", self._model)

    async def shutdown(self):
        if self._client:
            await self._client.aclose()
            logger.info("Translation pipeline shut down")

    async def translate(self, text: str, from_lang: str, to_lang: str) -> str | None:
        """Translate text between languages. Returns translated string or None on error."""
        from_name = LANG_NAMES.get(from_lang, from_lang)
        to_name = LANG_NAMES.get(to_lang, to_lang)

        user_msg = f"Translate the following text from {from_name} to {to_name}:\n\n{text}"

        try:
            resp = await self._client.post(
                self._api_url,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._model,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                    ],
                    "temperature": 0.1,
                    "max_tokens": 512,
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
