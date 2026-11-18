import re
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Switches (see .env.example)
    data_backend: Literal["local", "supabase"] = "local"
    ai_provider: Literal["stub", "llm"] = "stub"
    auth_mode: Literal["stub", "supabase", "disabled"] = "stub"
    environment: Literal["development", "production"] = "development"

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
    supabase_jwt_algorithm: Literal["ES256", "RS256", "HS256"] = "ES256"
    guest_limit_enabled: bool = False
    guest_export_limit_enabled: bool = False
    guest_token_secret: str = ""

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
    telegram_allowed_user_ids: str = ""

    @property
    def telegram_allowed_ids(self) -> frozenset[int]:
        """Parse the same tester allowlist for webhook and polling dispatch."""
        values = self.telegram_allowed_user_ids.split(",")
        if not self.telegram_allowed_user_ids.strip():
            return frozenset()
        if any(not re.fullmatch(r"[0-9]+", value.strip()) or int(value.strip()) <= 0 for value in values):
            raise RuntimeError("TELEGRAM_ALLOWED_USER_IDS must contain comma-separated positive integers")
        return frozenset(int(value.strip()) for value in values)

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origins.split(",") if o.strip()]

    def validate_runtime(self) -> None:
        if self.data_backend == "supabase" and not (self.supabase_url and self.supabase_service_key):
            raise RuntimeError("DATA_BACKEND=supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY")
        if self.ai_provider == "llm" and not self.ai_api_key:
            raise RuntimeError("AI_PROVIDER=llm needs AI_API_KEY")
        if self.auth_mode == "supabase":
            if not self.supabase_url or self.data_backend != "supabase":
                raise RuntimeError("AUTH_MODE=supabase needs Supabase URL and data backend")
            if self.supabase_jwt_algorithm == "HS256" and not self.supabase_jwt_secret:
                raise RuntimeError("HS256 needs SUPABASE_JWT_SECRET")
        if (self.guest_limit_enabled or self.guest_export_limit_enabled) and (
            self.auth_mode != "supabase" or len(self.guest_token_secret) < 32
        ):
            raise RuntimeError("Guest limits need real Supabase auth and a GUEST_TOKEN_SECRET of at least 32 characters")
        if self.telegram_bot_token:
            if self.telegram_webhook_secret == "change-me" or not re.fullmatch(
                r"[A-Za-z0-9_-]{1,256}", self.telegram_webhook_secret
            ):
                raise RuntimeError("Telegram needs a non-default TELEGRAM_WEBHOOK_SECRET (1–256 letters, digits, _ or -)")
            if not self.telegram_allowed_ids:
                raise RuntimeError("Telegram needs a nonempty TELEGRAM_ALLOWED_USER_IDS tester allowlist")
        if self.environment == "production":
            if self.auth_mode == "stub" or self.include_unreviewed or self.data_backend != "supabase":
                raise RuntimeError("Production requires Supabase data, reviewed content and non-stub authentication")
            base = urlsplit(self.public_base_url)
            if base.scheme != "https" or not base.netloc:
                raise RuntimeError("Production needs an HTTPS PUBLIC_BASE_URL")
            if not self.cors_origins or any(
                (origin := urlsplit(value)).scheme != "https"
                or not origin.netloc
                or origin.path
                or origin.query
                or origin.fragment
                for value in self.cors_origins
            ):
                raise RuntimeError("Production needs explicit HTTPS FRONTEND_ORIGINS without trailing slashes")


@lru_cache
def get_settings() -> Settings:
    return Settings()
