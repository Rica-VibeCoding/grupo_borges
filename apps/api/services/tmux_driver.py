"""Envio pontual de mensagens para sessões tmux da frota."""
from __future__ import annotations

import asyncio
from pathlib import Path
import re
import shlex
import time
from typing import Literal

import libtmux
from libtmux import exc as libtmux_exc

AgentCli = Literal["claude_code", "codex"]

_BOOTSTRAP_TIMEOUT_S = 15.0
_BOOTSTRAP_POLL_INTERVAL_S = 0.25
_REPOS_ROOT = Path("/home/clawd/repos").resolve()
_UNSAFE_WORKSPACE_CHARS = re.compile(r"[;&|\n\r\0]")
_MODEL_PATTERN = re.compile(r"[a-z0-9.\-]{1,80}")
_ANSI_ESCAPE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_BANNER_PATTERNS: dict[AgentCli, re.Pattern[str]] = {
    "claude_code": re.compile(r"╭|Claude Code v\d"),
    "codex": re.compile("›"),
}
_CLI_COMMANDS = {
    "claude_code": lambda m: f"claude --dangerously-skip-permissions --model {shlex.quote(m)}",
    "codex": lambda _: "codex",
}


def _create_empty_session_sync(session_name: str) -> None:
    server = libtmux.Server()
    try:
        server.new_session(session_name=session_name, detached=True, kill_session=False)
    except libtmux_exc.LibTmuxException:
        raise


async def create_empty_session(session_name: str) -> None:
    """Cria uma sessão tmux vazia, sem bootar CLI dentro dela."""
    await asyncio.to_thread(_create_empty_session_sync, session_name)


def _bootstrap_cli_in_session_sync(
    session_name: str, workspace_path: str, cli: AgentCli, model: str
) -> dict[str, bool]:
    if not _MODEL_PATTERN.fullmatch(model):
        raise ValueError(f"model inválido: {model}")
    if _UNSAFE_WORKSPACE_CHARS.search(workspace_path):
        raise libtmux_exc.LibTmuxException("workspace_path contém caracteres inseguros")
    resolved_workspace = Path(workspace_path).resolve()
    if not resolved_workspace.is_relative_to(_REPOS_ROOT):
        raise ValueError(f"workspace_path fora de {_REPOS_ROOT}: {workspace_path}")

    server = libtmux.Server()
    if not server.has_session(session_name):
        return {"attempted": False, "confirmed": False}

    session = server.sessions.get(session_name=session_name)
    pane = session.active_pane
    # defense-in-depth pre-shlex
    pane.send_keys(f"cd {shlex.quote(str(resolved_workspace))}")

    try:
        command = _CLI_COMMANDS[cli](model)
    except KeyError as e:
        raise libtmux_exc.LibTmuxException(f"cli inválido: {cli}") from e

    pane.send_keys(command)
    pattern = _BANNER_PATTERNS[cli]
    deadline = time.monotonic() + _BOOTSTRAP_TIMEOUT_S
    while time.monotonic() < deadline:
        output = "\n".join(
            pane.capture_pane(escape_sequences=True, join_wrapped=True)
        )
        if pattern.search(_ANSI_ESCAPE.sub("", output)):
            return {"attempted": True, "confirmed": True}
        time.sleep(_BOOTSTRAP_POLL_INTERVAL_S)

    return {"attempted": True, "confirmed": False}


async def bootstrap_cli_in_session(
    session: str, workspace_path: str, cli: AgentCli, model: str
) -> dict[str, bool]:
    """Booteia Claude Code/Codex no pane ativo e confirma readiness por banner."""
    return await asyncio.to_thread(
        _bootstrap_cli_in_session_sync, session, workspace_path, cli, model
    )


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
