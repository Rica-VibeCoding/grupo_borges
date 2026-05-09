"""
TmuxDriver — wrapper async sobre libtmux 0.40+.

libtmux é 100% sync. Toda chamada vai via asyncio.to_thread pra não bloquear
o event loop.

API nova (libtmux 0.40+): server.sessions.filter(session_name=...) substitui o
removido find_where(). Usamos filter ao invés de get() pra evitar dependência
de exception interna; tratamos missing como TmuxSessionNotFound.
"""
from __future__ import annotations

import asyncio

import libtmux


class TmuxSessionNotFound(Exception):
    """Sessão tmux com esse nome não existe."""


class TmuxDriver:
    def __init__(self) -> None:
        self._server = libtmux.Server()

    async def list_sessions(self) -> list[str]:
        return await asyncio.to_thread(self._list_sessions)

    def _list_sessions(self) -> list[str]:
        return [s.session_name for s in self._server.sessions]

    async def session_exists(self, session_name: str) -> bool:
        return await asyncio.to_thread(self._session_exists, session_name)

    def _session_exists(self, session_name: str) -> bool:
        return bool(self._server.sessions.filter(session_name=session_name))

    async def capture_pane(self, session_name: str) -> list[str]:
        """Captura output do pane ativo (preserva ANSI + linhas rejuntadas)."""
        return await asyncio.to_thread(self._capture_pane, session_name)

    def _capture_pane(self, session_name: str) -> list[str]:
        session = self._get_session(session_name)
        return session.active_pane.capture_pane(
            escape_sequences=True, join_wrapped=True
        )

    async def send_keys(
        self,
        session_name: str,
        keys: str,
        *,
        enter: bool = True,
        literal: bool = False,
    ) -> None:
        """Envia teclas pra sessão. enter=False digita sem submeter."""
        await asyncio.to_thread(
            self._send_keys, session_name, keys, enter, literal
        )

    def _send_keys(
        self, session_name: str, keys: str, enter: bool, literal: bool
    ) -> None:
        session = self._get_session(session_name)
        session.active_pane.send_keys(keys, enter=enter, literal=literal)

    def _get_session(self, session_name: str):
        matches = self._server.sessions.filter(session_name=session_name)
        if not matches:
            raise TmuxSessionNotFound(session_name)
        return matches[0]
