from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Switches (see .env.example)
    data_backend: Literal["local", "supabase"] = "local"
    ai_provider: Literal["stub", "llm"] = "stub"
    auth_mode: Literal["stub", "supabase"] = "stub"

    public_base_url: str = "http://localhost:8000"
    frontend_origins: str = "http://localhost:5173"

    # Local data (DATA_BACKEND=local)
    seed_dir: Path = REPO_ROOT / "data" / "seed"
    images_dir: Path = REPO_ROOT / "data" / "images"
    media_dir: Path = BACKEND_DIR / "media"  # saved memes in local mode (gitignored)
    # Only review_status «approved» artworks are shown. true also shows «pending» ones, so the
    # team can work with fresh AI profiles before review. Never true on the live site.
    include_unreviewed: bool = False

    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_jwt_secret: str = ""

    # AI (ADR 0002). AI_PROVIDER=llm uses Gemini: embeddings for matching, LLM only in hybrid mode.
    ai_api_key: str = ""  # Gemini API key (Google AI Studio)
    ai_model: str = "gemini-3.1-flash-lite"  # LLM for MATCH_MODE=hybrid
    ai_timeout_s: float = 8.0
    embedding_model: str = "gemini-embedding-2"
    embedding_dim: int = 768
    embedding_timeout_s: float = 3.0
    match_mode: Literal["embeddings", "hybrid"] = "embeddings"
    match_weight_situation: float = 0.7  # score = w·best situation + (1-w)·whole profile
    match_avoid_threshold: float = 0.80  # drop an artwork when the phrase is this close to a do_not_use_for rule
    match_sensitive_penalty: float = 0.9  # is_sensitive artworks: score × this
    # Local copy of the vectors (written by data/scripts/embed_artworks.py, gitignored).
    embeddings_file: Path = REPO_ROOT / "data" / "embeddings" / "vectors.json"

    telegram_bot_token: str = ""
    telegram_webhook_secret: str = "change-me"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
