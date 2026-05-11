"""Envio pontual de mensagens para sessões tmux da frota."""
from __future__ import annotations

import asyncio

import libtmux
from libtmux import exc as libtmux_exc


def _create_empty_session_sync(session_name: str) -> None:
    server = libtmux.Server()
    try:
        server.new_session(session_name=session_name, detached=True, kill_session=False)
    except libtmux_exc.LibTmuxException:
        raise


async def create_empty_session(session_name: str) -> None:
    """Cria uma sessão tmux vazia, sem bootar CLI dentro dela."""
    await asyncio.to_thread(_create_empty_session_sync, session_name)


def _kill_session_if_exists_sync(session_name: str) -> bool:
    server = libtmux.Server()
    if not server.has_session(session_name):
        return False
    try:
        server.kill_session(session_name)
    except libtmux_exc.LibTmuxException:
        return False
    return True


async def kill_session_if_exists(session_name: str) -> bool:
    """Mata a sessão tmux quando ela existe; False quando já não existe."""
    return await asyncio.to_thread(_kill_session_if_exists_sync, session_name)


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
