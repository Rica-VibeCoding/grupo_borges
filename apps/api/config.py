"""
Settings via pydantic-settings 2.5+. Lê env vars com prefixo GB_*, .env e defaults.

Mantemos config flat (sem nested) pra casar com o `.env.example` já em uso.
Se vier necessidade de subgrupos, migramos pra nested via env_nested_delimiter.
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parent
REPO_ROOT = API_ROOT.parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="GB_",
        env_file=API_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # auth / dev
    dev_bypass_auth: bool = False
    hook_bearer_token: str | None = None

    # paths
    agents_yaml: str = str(REPO_ROOT / "agents.yaml")
    workspaces_root: str = ""  # raiz dos workspaces dos 6 agentes (opcional, info)
    db_path: str = str(API_ROOT / "data" / "grupo_borges.db")
    claude_projects_dir: str = str(Path.home() / ".claude" / "projects")

    # stream
    poll_interval_ms: int = 250
    keepalive_seconds: int = 15


def get_settings() -> Settings:
    return Settings()
