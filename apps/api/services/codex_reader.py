"""Cota da assinatura ChatGPT — o único pedaço do Codex que sobreviveu à saída do CLI.

A Tara rodava no Codex CLI e este módulo lia o estado local dele
(`~/.codex/state_5.sqlite`, rollout JSONL, threads do TeleCodex). Em 06/09/2026
ela passou pro harness do Claude Code contra o `claude-code-proxy`, e esse
caminho inteiro saiu — o que ficou é a normalização de
`GET chatgpt.com/backend-api/wham/usage`, que virou a ÚNICA fonte de cota da
assinatura: o proxy recebe o frame `codex.rate_limits` e o descarta antes de
chegar ao cliente, e o Claude Code não conhece cota que não seja da Anthropic.

Quem faz o GET é `scripts/codex-cota` (cron); quem grava é
`POST /api/agents/{slug}/quota-snapshot`. A normalização mora aqui porque é
ela que tem teste, e porque o script não deve conhecer o schema do banco.
"""
from __future__ import annotations

from typing import Any


def _int_or_none(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return None


def _wham_window(raw: Any) -> dict[str, Any] | None:
    """Uma janela do `/wham/usage` no vocabulário que o painel já lê.

    Três nomes mudam entre as duas pontas e é só isso: `limit_window_seconds`
    (segundos) vira `window_minutes`, porque é por ele que o painel separa a
    janela de 5h da de 7 dias; e `reset_at` vira `resets_at`, no plural.
    """
    if not isinstance(raw, dict):
        return None
    # O percentual é o único campo que o painel exibe como número; sem janela
    # ele também não classifica 5h contra 7 dias. Faltando qualquer um dos dois,
    # a janela inteira não vale — devolver dicionário meio preenchido só empurra
    # a decisão pra frente e engorda o `token_usage_json` com o que veio.
    used_percent = raw.get("used_percent")
    if isinstance(used_percent, bool) or not isinstance(used_percent, (int, float)):
        return None
    window_seconds = _int_or_none(raw.get("limit_window_seconds"))
    if not window_seconds:
        return None
    return {
        "used_percent": used_percent,
        "window_minutes": window_seconds // 60,
        "resets_at": _int_or_none(raw.get("reset_at")),
    }


def normalize_wham_usage_payload(
    payload: dict[str, Any],
    *,
    observed_at: int | None = None,
) -> dict[str, Any] | None:
    """Converte o retorno de `GET chatgpt.com/backend-api/wham/usage`.

    É o endpoint que o binário oficial do Codex chama pra desenhar o `/status`
    da TUI. Não é documentado, mas é o que sobrou depois que a Tara saiu do CLI.

    `source` continua sendo `codex.event_msg.token_count` porque é o valor que o
    painel já sabia ler quando a origem era o rollout do CLI — o shape não mudou
    com a troca de origem, só o caminho até ele. `observed_at` é QUANDO a cota
    foi medida: sem ele o painel carimbava a hora da LEITURA e a cota da Tara
    nunca envelhecia, mostrando dado "de agora" com ela parada há horas.

    ⚠️ O corpo real traz `email` e `user_id` da conta. Nada aqui os copia, e
    nada deve: o que sai desta função vai parar no banco do cockpit.
    """
    rate_limit = payload.get("rate_limit")
    if not isinstance(rate_limit, dict):
        return None
    primary = _wham_window(rate_limit.get("primary_window"))
    secondary = _wham_window(rate_limit.get("secondary_window"))
    if primary is None and secondary is None:
        return None
    return {
        "source": "codex.event_msg.token_count",
        "rate_limits": {"primary": primary, "secondary": secondary},
        "observed_at": observed_at,
    }
