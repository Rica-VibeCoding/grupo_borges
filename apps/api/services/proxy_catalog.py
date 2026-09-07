"""Catálogo de modelos do rail `codex` do `claude-code-proxy` (motor da Tara).

Por que ler do binário em vez de manter lista no código: é a mesma lição que o
catálogo do Codex CLI deixou em 10/08 — a allowlist escrita à mão tinha
divergido do que o binário entregava, oferecendo dois ids que ele não conhecia
mais e faltando um que ele passara a oferecer. Lista fixa sobre catálogo de
terceiro envelhece em silêncio, e a falha só aparece na hora em que o Rica
clica.

Duas regras que este módulo aplica, e o porquê de cada uma:

1. **Só a geração corrente entra.** O rail devolve 18 ids `gpt-*` de quatro
   gerações (5.2 a 5.6); menu de 18 linhas no celular não se lê. A régua é
   DERIVADA da saída (a maior versão presente), não escrita aqui — quando o
   provedor publicar a 5.7, o menu acompanha sozinho.
2. **Alias Anthropic fica de fora.** O mesmo rail aceita `opus`, `sonnet`,
   `claude-opus-5` e mapeia tudo pro backend Codex. Oferecer isso faria o painel
   dizer "Opus 5" sobre um motor GPT — mentira de UI, e a etiqueta que o
   cockpit inteiro usa (`shortModelName`) traduziria o nome errado.

O sufixo `[1m]` viaja junto do id porque é assim que ele chega no
`ANTHROPIC_MODEL` do boot. Ele não amplia a janela do provedor (o teto da
assinatura ChatGPT é o `CLAUDE_CODE_AUTO_COMPACT_WINDOW=272000`); impede o CC de
estreitar por conta própria em id que ele não reconhece. Medido em 06/09: o
proxy aceita o id COM sufixo e responde com o cru — `gpt-5.6-luna-fast[1m]`
devolveu `"model": "gpt-5.6-luna-fast"`.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

#: O rail é o provedor dentro do proxy; a Tara roda contra a assinatura ChatGPT.
_RAIL = "codex"
#: `shutil.which` primeiro porque o PATH da unit pode não ter o `~/.local/bin`;
#: o caminho absoluto é o fallback, não a fonte.
_BINARIO_FALLBACK = "/home/clawd/.local/bin/claude-code-proxy"
_TIMEOUT_SECONDS = 10
_CACHE_TTL_SECONDS = 300
#: Binário quebrado não pode virar subprocess a cada poll do painel — espera
#: menos que o sucesso, mas espera.
_FAILURE_TTL_SECONDS = 60

SUFIXO_JANELA = "[1m]"

_LINHA_RAIL_RE = re.compile(rf"^{_RAIL}:\s*(.+)$", re.MULTILINE)
_VERSAO_RE = re.compile(r"^gpt-(\d+)\.(\d+)")


@dataclass
class _Cache:
    modelos: tuple[str, ...] = field(default_factory=tuple)
    expira_em: float = 0.0


_cache = _Cache()


def listar_modelos(*, forcar: bool = False) -> tuple[str, ...]:
    """Ids oferecíveis, já com o sufixo de janela.

    Tupla vazia quando o binário não pôde ser lido: este módulo não inventa
    catálogo, porque uma lista chutada faz o painel oferecer modelo que a sessão
    não sobe. Quem consome decide o que fazer com o vazio — no painel, vazio
    significa não mostrar seletor.
    """
    agora = time.monotonic()
    if not forcar and agora < _cache.expira_em:
        return _cache.modelos

    modelos = _ler_do_binario()
    # Leitura falha PRESERVA o último catálogo bom: o menu não some porque o
    # binário engasgou num poll.
    _cache.modelos = modelos if modelos else _cache.modelos
    _cache.expira_em = agora + (_CACHE_TTL_SECONDS if modelos else _FAILURE_TTL_SECONDS)
    return _cache.modelos


def _ler_do_binario() -> tuple[str, ...]:
    binario = shutil.which("claude-code-proxy") or _BINARIO_FALLBACK
    try:
        saida = subprocess.run(  # noqa: S603 - binário fixo, sem entrada do usuário
            [binario, "models"],
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        log.warning("proxy_catalog: `%s models` não rodou: %s", binario, exc)
        return ()

    if saida.returncode != 0:
        log.warning("proxy_catalog: `%s models` saiu %s", binario, saida.returncode)
        return ()

    return geracao_corrente(_ids_do_rail(saida.stdout))


def _ids_do_rail(saida: str) -> list[str]:
    """Os ids `gpt-*` da linha do rail — o resto da saída é de outro provedor."""
    linha = _LINHA_RAIL_RE.search(saida)
    if not linha:
        log.warning("proxy_catalog: saída sem a linha do rail %r", _RAIL)
        return []
    # A linha do último provedor traz um `;` e uma dica de uso no fim.
    itens = linha.group(1).split(";")[0].split(",")
    return [item.strip() for item in itens if item.strip().startswith("gpt-")]


def geracao_corrente(ids: list[str]) -> tuple[str, ...]:
    """Os ids da maior versão presente, na ordem em que o binário os deu."""
    versoes = {_versao(i) for i in ids} - {None}
    if not versoes:
        return ()
    maior = max(v for v in versoes if v is not None)
    return tuple(f"{i}{SUFIXO_JANELA}" for i in ids if _versao(i) == maior)


def _versao(model_id: str) -> tuple[int, int] | None:
    achado = _VERSAO_RE.match(model_id)
    return (int(achado.group(1)), int(achado.group(2))) if achado else None


def e_do_rail(model_id: str | None) -> bool:
    """Se o id tem a cara do rail — usado onde o catálogo vivo não vale.

    O sync do `agents.yaml` precisa distinguir um id legítimo do resíduo que a
    Tara carregava do Codex CLI (`codex-gpt-5-6-sol`) sem depender de subprocess
    dentro de transação de banco.
    """
    return bool(model_id) and model_id.startswith("gpt-")  # type: ignore[union-attr]
