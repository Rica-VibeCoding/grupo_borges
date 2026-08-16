"""Guarda mínima: texto de `jsonl:user` que NÃO é turno de verdade.

Espelha, em Python, só a fatia de `chat-payload-classifier.ts` (TS) que
importa pro lifecycle — comando local (`/clear`, `/compact`, `/rename`...) e
system-reminder puro não são trabalho pedido ao modelo, e não podem acender
"trabalhando". A régua completa do classificador (chips, task-notification,
resumo de compact etc.) mora só no TS, que é quem monta o feed; aqui entra o
suficiente pra decidir presença de trabalho, sem duplicar o resto.

Simplificação consciente: o TS distingue `kind: 'suppress'` (só caveat/stdout/
reminder) de `kind: 'slash'` (tem `<command-name>`) porque o feed renderiza os
dois de formas diferentes. Pro lifecycle o efeito dos dois é o mesmo — nenhum
é trabalho — então aqui basta o texto inteiro ser composto por essas tags
conhecidas, com ou sem `<command-name>`.

Referência cruzada: `packages/cockpit-core/src/chat-payload-classifier.ts`
(`SYSTEM_REMINDER_RE`) e `packages/cockpit-core/src/slash-command-wrapper.ts`
(`WRAPPER_TAGS`). Paridade de casos com
`apps/cockpit/lib/spike/corrida-em-voo.test.ts` — ver
`apps/api/tests/test_lifecycle_ruido.py`.
"""
from __future__ import annotations

import re

# Mesma lista de `WRAPPER_TAGS` em `slash-command-wrapper.ts`.
_WRAPPER_TAGS = (
    "command-name",
    "command-message",
    "command-args",
    "local-command-stdout",
    "local-command-caveat",
    "system-reminder",
)
_WRAPPER_TAG_RE = re.compile(
    r"<(" + "|".join(_WRAPPER_TAGS) + r")\s*>(.*?)</\1\s*>",
    re.DOTALL,
)


def eh_ruido_de_lifecycle(texto: str) -> bool:
    """`True` quando o texto inteiro (tirando espaço em branco entre tags) é
    composto só por comando local e/ou system-reminder — não acende
    "trabalhando". Espera texto já sabido não-vazio; call site decide o caso
    vazio (hoje os dois call sites já filtram antes de chegar aqui).
    """
    posicao = 0
    tamanho = len(texto)
    encontrou_alguma = False
    while posicao < tamanho:
        espaco = re.match(r"\s*", texto[posicao:])
        posicao += espaco.end()
        if posicao >= tamanho:
            break
        casamento = _WRAPPER_TAG_RE.match(texto, posicao)
        if not casamento:
            return False
        encontrou_alguma = True
        posicao = casamento.end()
    return encontrou_alguma
