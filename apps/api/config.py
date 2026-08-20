"""
Settings via pydantic-settings 2.5+. Lê env vars com prefixo GB_*, .env e defaults.

Mantemos config flat (sem nested) pra casar com o `.env.example` já em uso.
Se vier necessidade de subgrupos, migramos pra nested via env_nested_delimiter.
"""
from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parent
REPO_ROOT = API_ROOT.parents[1]


def _default_agents_yaml() -> str:
    """agents.local.yaml (gitignored) vence se existir.

    Permite frota diferente por ambiente (ex: Oracle) sem editar o
    agents.yaml versionado — é a edição local nele que fazia o
    `git pull --rebase` abortar toda vez que o upstream também mexia
    no arquivo. GB_AGENTS_YAML no .env continua valendo por cima disto.
    """
    local = REPO_ROOT / "agents.local.yaml"
    if local.exists():
        return str(local)
    return str(REPO_ROOT / "agents.yaml")


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
    # Slug humano usado em dev local quando Tailscale-User-Login está ausente.
    # Cockpit hoje é single-tenant (Rica) e na prática o frontend é servido
    # pela porta Next dev direta (sem TS Serve no caminho), então o header
    # nunca chega. Default = rica resolve o aceite/rejeição via cockpit.
    # Quando entrar segundo humano, voltar a "" e forçar acesso via :3443.
    dev_default_reviewer: str = "rica"
    hook_bearer_token: str | None = None

    # paths
    agents_yaml: str = Field(default_factory=_default_agents_yaml)
    workspaces_root: str = ""  # raiz dos workspaces dos 6 agentes (opcional, info)
    db_path: str = str(API_ROOT / "data" / "grupo_borges.db")
    claude_projects_dir: str = str(Path.home() / ".claude" / "projects")

    # stream
    poll_interval_ms: int = 250
    keepalive_seconds: int = 15

    # dispatcher automatico (opt-in)
    auto_dispatch_enabled: bool = False
    auto_dispatch_interval_seconds: float = 5.0
    auto_dispatch_batch_size: int = 1

    # watchdog (timeout + capture-pane checkpoint detection)
    watchdog_enabled: bool = True
    watchdog_interval_seconds: float = 30.0

    # subsession sweeper (stall detection TTL 10min + worktree cleanup)
    subsession_sweeper_enabled: bool = True
    subsession_sweeper_interval_seconds: float = 300.0

    # uploads sweeper — retenção por idade em uploads/agents/<slug>/*. Canário
    # é benchmark sintético (não histórico do Rica), teto bem mais curto.
    uploads_sweeper_enabled: bool = True
    uploads_sweeper_interval_seconds: float = 3600.0
    uploads_retention_days: float = 30.0
    uploads_retention_days_canario: float = 2.0

    # Kimi (assinatura Kimi Code do Hiro) — chave sk-kimi-... pro endpoint
    # /coding/v1/usages que alimenta o bloco Quotas do painel (5h + semanal).
    kimi_api_key: str | None = None

    # OpenCode Go (assinatura do Canário) — chave sk-AZyN... pro endpoint
    # /zen/go/v1/usage, única fonte das 3 janelas do plano (5h, semanal,
    # mensal). É a MESMA chave que o boot exporta em ANTHROPIC_API_KEY.
    opencode_api_key: str | None = None

    # OpenAI — usada só pra CUNHAR o bilhete curto da fala ao vivo do composer
    # (POST /v1/realtime/client_secrets). Vazia por padrão de propósito: a
    # chave já mora em ~/.claude/secrets/openai-api-key.txt, que é de onde o
    # `stt-openai.sh` lê, e duplicar segredo é criar uma cópia pra alguém
    # esquecer de girar. Preencher GB_OPENAI_API_KEY só se o host não tiver o
    # arquivo do cofre.
    openai_api_key: str = ""

    # TTS — engine preferido Google Chirp3-HD (voz da frota), fallback edge-tts.
    # tts_voice é só o default edge usado quando não há voz da frota nem key.
    google_tts_api_key: str = ""
    tts_voice: str = "pt-BR-FranciscaNeural"
    tts_rate: str = "+0%"
    tts_pitch: str = "+0Hz"


def get_settings() -> Settings:
    return Settings()
