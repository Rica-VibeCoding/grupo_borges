"""Envio pontual de mensagens para sessões tmux da frota."""
from __future__ import annotations

import asyncio

import libtmux


def _send_message_sync(session_name: str, text: str) -> bool:
    server = libtmux.Server()
    if not server.has_session(session_name):
        return False

    session = server.sessions.get(session_name=session_name)
    pane = session.active_pane
    safe = text.replace("\r", "").replace("\n", " / ")[:800]
    pane.cmd("send-keys", "-l", safe)
    pane.cmd("send-keys", "Enter")
    return True


async def send_message(session_name: str, text: str) -> bool:
    """Digita `text` sanitizado no pane ativo e submete com Enter.

    Texto é sanitizado (CR/LF → ` / `, cap 800 chars); Enter é submetido cru —
    agente alvo em estado ativo pode ter o input atual submetido junto.

    Retorna False quando a sessão não existe; erros de tmux reais sobem para o
    caller logar sem desfazer a transação já persistida.
    """
    return await asyncio.to_thread(_send_message_sync, session_name, text)
