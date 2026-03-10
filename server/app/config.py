"""MedTranslate server configuration via environment variables."""

from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables or .env file."""

    # PersonaPlex
    hf_token: str = ""
    personaplex_voice: str = "NATF2"
    personaplex_cpu_offload: bool = False

    # NVIDIA Riva NIM
    riva_api_url: str = ""
    riva_api_key: str = ""

    # Fish Audio TTS (legacy, kept for future voice cloning)
    fish_audio_api_key: str = ""
    fish_audio_model: str = "s1"

    # OpenAI TTS
    openai_api_key: str = ""

    # ElevenLabs TTS
    elevenlabs_api_key: str = ""

    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_key: str = ""

    # Server
    server_port: int = 8443
    session_timeout_minutes: int = 30
    max_session_duration_minutes: int = 120
    supported_languages: str = "en,es,ht,fr,pt,ru,zh,ar,vi,tl"
    default_language_pair: str = "en-es"

    # TLS
    tls_cert_path: str = ""
    tls_key_path: str = ""

    @property
    def supported_language_list(self) -> List[str]:
        return [lang.strip() for lang in self.supported_languages.split(",")]

    @property
    def valid_language_pairs(self) -> List[str]:
        """Generate all valid language pairs from supported languages."""
        langs = self.supported_language_list
        pairs = []
        for source in langs:
            for target in langs:
                if source != target:
                    pairs.append(f"{source}-{target}")
        return pairs

    class Config:
        env_file = ("../.env", "../../.env")
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()
