"""Voo único: chamadas simultâneas esperam a MESMA execução, sem cache depois dela.

Feito para o `/api/fleet` (28/09). Cada leitura custava ~150 ms e o custo era
linear na concorrência — 3 simultâneas 0,33 s, 6 simultâneas 0,80 s —, e o
cockpit gera simultaneidade sozinho: o layout e a home pedem o fleet juntos no
servidor, e cada aba relê depois do mesmo evento do SSE.

Por que não um cache curto (1–2 s) por cima: a tropa é o que diz ao Rica quem
está trabalhando, e a releitura que o front faz depois de um evento chega
~250 ms depois dele. Um snapshot de um segundo atrás seria o estado ANTERIOR ao
evento — o card acenderia pelo evento e voltaria pro estado velho quando o
realce vencesse, até o poll seguinte. Aqui a resposta nunca é de uma execução
que já terminou quando a chamada chegou, e só se pega carona numa execução que
começou há menos de `idade_maxima_s` — menos que o atraso da releitura do
front, então a leitura em voo já enxerga o que disparou o evento.
"""
from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable, Hashable
from typing import Generic, TypeVar

_T = TypeVar("_T")


class VooUnico(Generic[_T]):
    def __init__(self, *, idade_maxima_s: float) -> None:
        self._idade_maxima_s = idade_maxima_s
        self._em_voo: dict[Hashable, tuple[float, asyncio.Future[_T]]] = {}

    async def executa(self, chave: Hashable, fabrica: Callable[[], Awaitable[_T]]) -> _T:
        agora = time.monotonic()
        atual = self._em_voo.get(chave)
        if atual is not None:
            iniciou, voo = atual
            if not voo.done() and agora - iniciou < self._idade_maxima_s:
                # `shield`: quem desiste (aba fechada) não cancela a execução dos
                # outros que estão esperando por ela.
                return await asyncio.shield(voo)

        voo = asyncio.ensure_future(fabrica())
        self._em_voo[chave] = (agora, voo)

        def _pousa(terminado: asyncio.Future[_T]) -> None:
            if self._em_voo.get(chave, (0.0, None))[1] is terminado:
                del self._em_voo[chave]
            # Marca a exceção como lida: se todos os que esperavam desistiram,
            # o asyncio reclamaria de "exception was never retrieved".
            if not terminado.cancelled():
                terminado.exception()

        voo.add_done_callback(_pousa)
        return await asyncio.shield(voo)
