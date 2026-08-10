"""Catálogo de modelos que o harness da Tara realmente entrega.

Por que ler do CLI em vez de manter lista no código: a allowlist estática
(`agents.CodexModel`) tinha divergido do binário sem ninguém perceber. Em
0.146.0 ela ainda oferecia `gpt-5.3-codex` e `gpt-5.2`, que o CLI não conhece
mais, e não tinha `gpt-5.3-codex-spark`, que ele passou a oferecer. Lista escrita
à mão sobre catálogo de terceiro envelhece em silêncio — a troca só falha na
hora em que o Rica clica.

Duas coisas que só o catálogo sabe, e que a lista fixa não tinha como carregar:

1. **A escala de esforço é por MODELO, não por família.** `gpt-5.6-sol` aceita
   até `ultra`; `gpt-5.5` para em `xhigh`. O painel oferecia os mesmos 5 níveis
   pra todo modelo Codex — em `gpt-5.5` isso é oferecer degrau que não existe.
   A doc oficial confirma pelo outro lado: o exemplo do SDK escolhe o nível
   lendo `supported_reasoning_efforts` DO modelo escolhido, nunca de uma
   constante (Context7, `/openai/codex`).
2. **Nem todo modelo é pra aparecer.** `gpt-5.6-sol-wm` e `codex-auto-review`
   vêm com `visibility: "hide"` — são internos do harness. O mesmo exemplo do
   SDK filtra por `hidden` antes de escolher.

O `codex debug models` custa 0,12-0,31s medido; o cache existe pra não pagar
isso a cada poll do painel, não porque seja caro demais para uma chamada.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
import time
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

_CATALOG_COMMAND = ["codex", "debug", "models"]
_CATALOG_TIMEOUT_SECONDS = 10
_CATALOG_CACHE_TTL_SECONDS = 300
# Falha do CLI não pode virar poll de 1 em 1 segundo em cima de um binário que
# está quebrado: espera menos que o sucesso, mas espera.
_CATALOG_FAILURE_TTL_SECONDS = 60

_CANONICAL_PREFIX = "codex-"
# `gpt-5.6-sol` <-> `codex-gpt-5-6-sol`: o ÚNICO ponto do nome cru fica entre os
# dois números da versão. O sufixo (`-sol`, `-mini`, `-codex-spark`) já usa
# hífen dos dois lados, então a volta é determinística — testada contra o
# catálogo vivo, não deduzida.
_VERSION_DOT_RE = re.compile(r"^gpt-(\d+)-(\d+)")


@dataclass(frozen=True)
class CodexModelo:
    """Um modelo oferecível, já traduzido pro vocabulário do cockpit."""

    slug: str
    """Canônico, com prefixo — o que o cockpit persiste em `state_model`."""
    raw: str
    """O que o `-m` do CLI aceita."""
    display_name: str
    efforts: tuple[str, ...]
    default_effort: str | None
    priority: int


@dataclass
class _Cache:
    modelos: tuple[CodexModelo, ...] = field(default_factory=tuple)
    lido_em: float = 0.0
    expira_em: float = 0.0


_cache = _Cache()


def canonical_slug(raw: str) -> str:
    """`gpt-5.6-sol` -> `codex-gpt-5-6-sol`."""
    return f"{_CANONICAL_PREFIX}{raw.replace('.', '-')}"


def raw_slug(slug: str) -> str:
    """`codex-gpt-5-6-sol` -> `gpt-5.6-sol`.

    Consulta o catálogo primeiro: se o modelo está lá, a resposta é o nome que o
    próprio CLI publicou, não uma reconstrução. A regra do ponto só entra quando
    o catálogo não pôde ser lido — é fallback, não fonte.
    """
    for modelo in _modelos_em_cache():
        if modelo.slug == slug:
            return modelo.raw
    sem_prefixo = slug.removeprefix(_CANONICAL_PREFIX)
    return _VERSION_DOT_RE.sub(r"gpt-\1.\2", sem_prefixo)


def listar_modelos(*, forcar: bool = False) -> tuple[CodexModelo, ...]:
    """Modelos oferecíveis, do mais recomendado ao menos (ordem do `priority`).

    Devolve tupla vazia quando o CLI não pôde ser lido. Quem consome decide o
    que fazer com o vazio — este módulo não inventa catálogo, porque uma lista
    chutada faria o painel oferecer modelo que a Tara não roda.
    """
    agora = time.monotonic()
    if not forcar and agora < _cache.expira_em:
        return _cache.modelos

    modelos = _ler_do_cli()
    _cache.modelos = modelos if modelos else _cache.modelos
    _cache.lido_em = agora
    _cache.expira_em = agora + (
        _CATALOG_CACHE_TTL_SECONDS if modelos else _CATALOG_FAILURE_TTL_SECONDS
    )
    return _cache.modelos


def modelo_por_slug(slug: str) -> CodexModelo | None:
    return next((m for m in listar_modelos() if m.slug == slug), None)


def efforts_do_modelo(slug: str | None) -> tuple[str, ...]:
    """Escala do modelo indicado; tupla vazia quando ele não está no catálogo."""
    if not slug:
        return ()
    modelo = modelo_por_slug(slug)
    return modelo.efforts if modelo is not None else ()


def slugs_permitidos() -> frozenset[str]:
    return frozenset(m.slug for m in listar_modelos())


def _modelos_em_cache() -> tuple[CodexModelo, ...]:
    """O que já foi lido, sem disparar leitura nova.

    `raw_slug` é chamado no caminho de montar o comando; um subprocess ali
    transformaria uma tradução de string numa chamada de I/O.
    """
    return _cache.modelos


def _ler_do_cli() -> tuple[CodexModelo, ...]:
    try:
        proc = subprocess.run(
            _CATALOG_COMMAND,
            capture_output=True,
            text=True,
            timeout=_CATALOG_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        log.warning("codex_catalog: %s falhou (%s)", " ".join(_CATALOG_COMMAND), exc)
        return ()

    if proc.returncode != 0:
        log.warning("codex_catalog: saída %s do CLI", proc.returncode)
        return ()

    return _parse(proc.stdout)


def _parse(saida: str) -> tuple[CodexModelo, ...]:
    try:
        payload = json.loads(saida)
    except json.JSONDecodeError:
        log.warning("codex_catalog: catálogo não é JSON")
        return ()

    brutos = payload.get("models") if isinstance(payload, dict) else None
    if not isinstance(brutos, list):
        return ()

    modelos: list[CodexModelo] = []
    for bruto in brutos:
        modelo = _parse_modelo(bruto)
        if modelo is not None:
            modelos.append(modelo)

    # `priority` é a ordem que o próprio harness recomenda (1 = topo). Ordenar
    # pelo slug jogaria `gpt-5.4-mini` na frente do `gpt-5.6-sol`.
    modelos.sort(key=lambda m: (m.priority, m.slug))
    return tuple(modelos)


def _parse_modelo(bruto: object) -> CodexModelo | None:
    if not isinstance(bruto, dict):
        return None
    # `hide` é o harness dizendo que o modelo não é pra escolha humana
    # (`gpt-5.6-sol-wm`, `codex-auto-review`). Um campo ausente não é permissão:
    # sem `visibility` declarada, não oferecemos.
    if bruto.get("visibility") != "list":
        return None

    raw = bruto.get("slug")
    if not isinstance(raw, str) or not raw:
        return None

    efforts = tuple(
        nivel["effort"]
        for nivel in bruto.get("supported_reasoning_levels") or []
        if isinstance(nivel, dict) and isinstance(nivel.get("effort"), str)
    )

    display = bruto.get("display_name")
    default_effort = bruto.get("default_reasoning_level")
    priority = bruto.get("priority")

    return CodexModelo(
        slug=canonical_slug(raw),
        raw=raw,
        display_name=display if isinstance(display, str) and display else raw,
        efforts=efforts,
        default_effort=default_effort if isinstance(default_effort, str) else None,
        # Sem prioridade declarada, vai pro fim em vez de disputar o topo com 0.
        priority=priority if isinstance(priority, int) else 999,
    )


def limpar_cache() -> None:
    """Só para teste — o TTL cuida do resto."""
    global _cache
    _cache = _Cache()
