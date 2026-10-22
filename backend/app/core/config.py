"""All runtime settings. Values come from environment variables or the repo-level .env file."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(REPO_DIR / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str = "development"
    log_level: str = "INFO"

    # Database (Postgres + pgvector)
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/contracts"

    # Access control: the frontend proxy sends this key on every request.
    api_key: str | None = None
    cors_origins: str = "http://localhost:3000"

    # Google Drive
    google_drive_service_account_json: str | None = None  # path to file or raw JSON
    google_drive_folder_id: str | None = None  # id of MITVE TOOLS/NECHASIM/CONTRACTS
    google_drive_folder_path: str = "MITVE TOOLS/NECHASIM/CONTRACTS"

    # LLM providers. "auto" picks Anthropic when its key exists, otherwise OpenAI.
    llm_provider: str = "auto"
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    # Model tiers:
    #   fast   - routing, metadata, OCR fallback, web summaries (cheap, low latency)
    #   main   - chat answers (streams quickly), review, targeted revisions
    #   draft  - full contract drafting (quality first)
    #   review - optional deep legal review (strongest model)
    openai_fast_model: str = "gpt-4.1-mini"
    openai_main_model: str = "gpt-4.1"
    openai_draft_model: str = "gpt-5.5"
    openai_review_model: str = "gpt-5.5"
    anthropic_fast_model: str = "claude-haiku-5-5"
    anthropic_main_model: str = "claude-sonnet-5-5"
    anthropic_draft_model: str = "claude-sonnet-5-5"
    anthropic_review_model: str = "claude-opus-5-5"

    # Embeddings (OpenAI). 1536 dims keeps the HNSW index fast and small.
    embedding_model: str = "text-embedding-3-large"
    embedding_dimensions: int = 1536

    # Web search: Tavily if a key is set, otherwise DuckDuckGo (free).
    tavily_api_key: str | None = None

    # OCR
    tesseract_cmd: str | None = None
    ocr_min_chars_per_page: int = 40
    ocr_min_confidence: float = 60.0  # tesseract mean word confidence (0-100)

    # Retrieval and token budget
    retrieval_candidates: int = 24
    retrieval_top_k: int = 6
    retrieval_min_similarity: float = 0.30  # best cosine similarity below this = "not found in the archive"
    max_chunk_tokens: int = 700
    history_turns: int = 3
    daily_token_budget: int = 2_000_000
    answer_cache_enabled: bool = True

    # Scheduler (in-process, optional; Render uses a Cron Job instead)
    enable_scheduler: bool = False
    sync_cron_hour: int = 2
    timezone: str = "Asia/Jerusalem"

    @property
    def provider(self) -> str:
        if self.llm_provider != "auto":
            return self.llm_provider
        return "anthropic" if self.anthropic_api_key else "openai"

    @property
    def sqlalchemy_url(self) -> str:
        """Render gives postgres:// URLs. SQLAlchemy needs the psycopg driver name."""
        url = self.database_url
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url.replace("postgresql+asyncpg://", "postgresql+psycopg://")

    def service_account_info(self) -> dict | None:
        import json

        raw = (self.google_drive_service_account_json or "").strip()
        if not raw:
            for candidate in (Path("/etc/secrets/service_account.json"), REPO_DIR / "service_account.json"):
                if candidate.exists():
                    return json.loads(candidate.read_text(encoding="utf-8"))
            return None
        if raw.startswith("{"):
            return json.loads(raw)
        path = Path(raw)
        if not path.is_absolute():
            path = REPO_DIR / path
        return json.loads(path.read_text(encoding="utf-8"))


@lru_cache
def get_settings() -> Settings:
    return Settings()
