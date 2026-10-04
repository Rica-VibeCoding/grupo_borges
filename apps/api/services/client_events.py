"""Sinal local para o SSE de estado do único agente cliente."""
from __future__ import annotations

import asyncio


class ClientEvents:
    def __init__(self) -> None:
        self._condition = asyncio.Condition()
        self.revision = 0

    async def publish(self) -> None:
        async with self._condition:
            self.revision += 1
            self._condition.notify_all()

    async def wait(self, previous: int, timeout: float) -> int:
        async with self._condition:
            try:
                await asyncio.wait_for(
                    self._condition.wait_for(lambda: self.revision != previous), timeout
                )
            except TimeoutError:
                pass
            return self.revision
