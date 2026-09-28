"""Tira do evento canônico o que nenhuma tela do feed lê, antes de virar bytes.

Medido em 28/09 no replay de 300 mensagens (`recentes=1`, `maxResultChars=32000`):
o `maestro` somava 802 KB e a `tara` 1,06 MB. Duas chaves, sozinhas, pesavam
21% e 22% disso — e nenhuma delas chega à tela:

- **`signature` do bloco `thinking`** — 102 KB no `maestro`, 193 KB na `tara`.
  É a assinatura criptográfica que o Claude Code guarda para devolver o
  raciocínio à API no turno seguinte. O cockpit não devolve nada à API: o feed
  lê só `thinking` (`lib/thinking.ts`, `feed/grupo-ferramentas.ts`,
  `spike/conteudo-visivel.ts`, `chat-payload-classifier.ts`). Nenhum código de
  `apps/cockpit` nem de `packages/cockpit-core` lê `signature` — o único
  encontro é um teste que a usa para montar a fixture.
- **`message.usage`** — 66 KB no `maestro`, 45 KB na `tara`. Tokens por
  mensagem. A pílula de contexto e o bloco de cota vêm do
  `GET /api/agents/{slug}/painel` (`PainelTokens`), nunca do stream; o tipo
  `MessagePayload` declara o campo, mas ninguém o lê.

O bloco `thinking` continua na lista, só sem a assinatura: quem decide se ele
aparece olha o texto, e a contagem de partes que o agrupador de ferramentas faz
não muda.

`tool_use_result` NÃO passa por aqui: os renderers ricos (shell, arquivo,
fetch, lista, agente, página publicada) leem a forma estruturada, e o texto do
`tool_result` alimenta o resumo do chip — são dois consumidores, não duplicata.

Opt-in (`enxuto=1`) pelo mesmo motivo do `maxResultChars`: o v1 (`apps/web`) e
o gravador de fixtures consomem este endpoint e recebem o evento inteiro.
"""
from __future__ import annotations

from typing import Any


def enxuga_para_feed(canonical: dict[str, Any]) -> None:
    """Remove `message.usage` e `signature` dos blocos `thinking`, NO LUGAR."""
    message = canonical.get("message")
    if not isinstance(message, dict):
        return
    message.pop("usage", None)
    partes = message.get("content")
    if not isinstance(partes, list):
        return
    for parte in partes:
        if isinstance(parte, dict) and parte.get("type") == "thinking":
            parte.pop("signature", None)
