"""Envio pontual de mensagens para sessões tmux da frota."""
from __future__ import annotations

import asyncio
import os
from collections import defaultdict
from pathlib import Path
import re
import shlex
import subprocess
import threading
import time
import uuid
from typing import Literal

import libtmux
from libtmux import exc as libtmux_exc

# Delay entre paste-buffer e Enter pra CC consolidar o paste. Default 150ms
# (Hermes-style validado em prod). Configurável via env pra ajustar sob carga
# sem deploy — VPS 8GB pode precisar de 300-500ms em pico.
_PASTE_SUBMIT_DELAY_S = float(os.getenv("COCKPIT_PASTE_DELAY_MS", "150")) / 1000.0
_LOAD_BUFFER_TIMEOUT_S = 5.0

# Lock por session_name pra evitar race em dispatches concorrentes no mesmo
# pane: sem isso, dispatch B pode injetar paste/Enter entre o paste e o Enter
# de A, e os 2 envelopes saem fundidos como um único prompt no CC.
_DISPATCH_LOCKS: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)

# Comandos esperados no pane ativo do agente. Se o user trocou de window (ex:
# abriu shell auxiliar), `active_pane` aponta pra outra coisa — paste no shell
# pode executar parte do envelope como comando. Guard aborta nesse caso.
_EXPECTED_PANE_COMMANDS = {"claude", "node", "codex"}

AgentCli = Literal["claude_code", "codex"]

_BOOTSTRAP_TIMEOUT_S = 15.0
_BOOTSTRAP_POLL_INTERVAL_S = 0.25
_PANE_EXCERPT_TIMEOUT_S = 0.5
_PANE_EXCERPT_LINES = 12
_PANE_EXCERPT_MAX_CHARS = 1200
_REPOS_ROOT = Path("/home/clawd/repos").resolve()
_UNSAFE_WORKSPACE_CHARS = re.compile(r"[;&|\n\r\0]")
_MODEL_PATTERN = re.compile(r"[a-z0-9.\-]{1,80}")
_ANSI_ESCAPE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_BANNER_PATTERNS: dict[AgentCli, re.Pattern[str]] = {
    "claude_code": re.compile(r"╭|Claude Code v\d"),
    "codex": re.compile("›"),
}

_CODEX_MODEL_MAP = {
    "codex-gpt-5-5": "gpt-5.5",
    "codex-gpt-5-4": "gpt-5.4",
    "codex-gpt-5-4-mini": "gpt-5.4-mini",
    "codex-gpt-5-3-codex": "gpt-5.3-codex",
    "codex-gpt-5-2": "gpt-5.2",
}


def _codex_command(model: str) -> str:
    raw_model = _CODEX_MODEL_MAP.get(model)
    if raw_model is None:
        raw_model = model.removeprefix("codex-").replace("-", ".")
    return f"codex -m {shlex.quote(raw_model)}"


_CLI_COMMANDS = {
    "claude_code": lambda m: f"claude --dangerously-skip-permissions --model {shlex.quote(m)}",
    "codex": _codex_command,
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


def _clean_pane_lines(
    lines: list[str],
    *,
    max_chars: int,
    preserve_ansi: bool = False,
) -> str | None:
    """Junta `lines` num excerpt, removendo control chars e linhas vazias.

    Default strippa ANSI — todos os parsers (`parse_model_from_pane`,
    `parse_session_elapsed_from_pane`) leem texto puro. Quando o consumer
    quer renderizar cores (stream pra UI), passa `preserve_ansi=True` e o
    front faz o parse via `lib/pane-chrome.ts:parseAnsi`.
    """
    cleaned: list[str] = []
    for line in lines:
        text = line if preserve_ansi else _ANSI_ESCAPE.sub("", line)
        text = _CONTROL_CHARS.sub("", text).rstrip()
        # `strip()` removendo ANSI pra detectar linha "vazia visualmente"
        if _ANSI_ESCAPE.sub("", text).strip():
            cleaned.append(text)
    if not cleaned:
        return None
    excerpt = "\n".join(cleaned)
    if len(excerpt) > max_chars:
        excerpt = "..." + excerpt[-(max_chars - 3):]
    return excerpt


def _capture_pane_excerpt_sync(
    session_name: str,
    *,
    line_limit: int,
    max_chars: int,
    preserve_ansi: bool = False,
) -> str | None:
    server = libtmux.Server()
    if not server.has_session(session_name):
        return None
    session = server.sessions.get(session_name=session_name)
    pane = session.active_pane
    lines = pane.capture_pane(
        start=-line_limit,
        end="-",
        escape_sequences=True,
        join_wrapped=True,
    )
    return _clean_pane_lines(lines, max_chars=max_chars, preserve_ansi=preserve_ansi)


# Statusline do Claude Code, variações observadas:
#   "Sonnet 4.6 - 40:26:47 - [████░] 32%"
#   "Opus 4.7 (1M context) - 20:14:19 - [...] 7%"  ← janela 1M insere parêntese
#   "Opus 4.7 (1M context) - 05:42 - [...] 9%"     ← sessão < 1h emite só MM:SS
_CC_SESSION_TIME = re.compile(
    r"\b(?:Opus|Sonnet|Haiku)\s+\d+\.\d+(?:\s+\([^)]*\))?\s+[-–]\s+"
    r"(?:(\d+):)?(\d+):(\d{2})\b",
)


def parse_session_elapsed_from_pane(excerpt: str | None) -> int | None:
    """Extrai tempo (segundos) da sessão CC a partir do statusline no excerpt.

    Pega o último match — statusline vive no fim do pane. Codex tem outro
    formato e retorna None (caller deve cair em outro fallback).
    """
    if not excerpt:
        return None
    matches = list(_CC_SESSION_TIME.finditer(excerpt))
    if not matches:
        return None
    h, m, s = matches[-1].groups()
    return (int(h) if h else 0) * 3600 + int(m) * 60 + int(s)


# Modelo curto no statusline do CC (último match — statusline fica no fim do pane).
_CC_MODEL_NAME = re.compile(r"\b(Opus|Sonnet|Haiku)\s+\d+\.\d+", re.IGNORECASE)


def parse_model_from_pane(excerpt: str | None) -> str | None:
    """Extrai slug curto (opus|sonnet|haiku) do statusline do pane.

    Server-side port do `parseModelFromPane` do agent-card.tsx. Usado pelo
    `POST /api/agents/{slug}/model` pra confirmar que a troca via `/model`
    propagou pra statusline. Retorna None pro Codex (formato diferente).
    """
    if not excerpt:
        return None
    matches = list(_CC_MODEL_NAME.finditer(excerpt))
    if not matches:
        return None
    return matches[-1].group(1).lower()


async def capture_pane_excerpt(
    session_name: str,
    *,
    line_limit: int = _PANE_EXCERPT_LINES,
    max_chars: int = _PANE_EXCERPT_MAX_CHARS,
    timeout_s: float = _PANE_EXCERPT_TIMEOUT_S,
    preserve_ansi: bool = False,
) -> str | None:
    """Retorna um excerpt curto do pane ativo sem deixar /api/fleet travar.

    Falhas comuns de tmux (sessão ausente, pane inválido, timeout) viram None:
    o cockpit deve mostrar fallback limpo em vez de quebrar o snapshot.

    `preserve_ansi=True` mantém escape sequences pro caller renderizar cores
    no client (SSE stream). Default False — todos os parsers leem texto puro.
    """
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(
                _capture_pane_excerpt_sync,
                session_name,
                line_limit=line_limit,
                max_chars=max_chars,
                preserve_ansi=preserve_ansi,
            ),
            timeout=timeout_s,
        )
    except (TimeoutError, libtmux_exc.LibTmuxException, AttributeError, IndexError):
        return None


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

    # \r solto vira ruído no buffer tmux; \r\n vira \n; \n é preservado pra
    # multilinha funcionar como paste real (envelope do Cockpit tem 30+ linhas).
    # Control chars (exceto \n e \t) removidos pra evitar sequência ANSI inesperada
    # consumida pelo terminal do pane.
    sanitized = _CONTROL_CHARS.sub("", text.replace("\r\n", "\n").replace("\r", ""))

    with _DISPATCH_LOCKS[session_name]:
        session = server.sessions.get(session_name=session_name)
        pane = session.active_pane

        # Guard: se o pane ativo não é o CLI esperado (ex: agente trocou window
        # pra rodar shell auxiliar), aborta — paste no shell executaria parte do
        # envelope como comando.
        current_cmd = (pane.pane_current_command or "").lower()
        if current_cmd not in _EXPECTED_PANE_COMMANDS:
            return False

        # ORDEM CRÍTICA do paste (Hermes-style, validado em prod):
        #   1. C-u           — limpa input pendente (antes do paste; depois apagaria)
        #   2. load-buffer   — escreve envelope em buffer nomeado por uuid (sem race)
        #   3. paste-buffer  — cola e descarta (-d)
        #   4. sleep 150ms   — CC consolida paste antes do Enter
        #   5. Enter         — submete
        pane.cmd("send-keys", "C-u")

        buf_name = f"cockpit-dispatch-{uuid.uuid4().hex[:12]}"
        paste_ok = False
        try:
            try:
                load_result = subprocess.run(
                    ["tmux", "load-buffer", "-b", buf_name, "-"],
                    input=sanitized,
                    text=True,
                    capture_output=True,
                    timeout=_LOAD_BUFFER_TIMEOUT_S,
                )
            except subprocess.TimeoutExpired:
                return False
            if load_result.returncode != 0:
                return False

            pane.cmd("paste-buffer", "-d", "-b", buf_name)
            paste_ok = True
            time.sleep(_PASTE_SUBMIT_DELAY_S)
            pane.cmd("send-keys", "Enter")
            return True
        except libtmux_exc.LibTmuxException:
            return False
        finally:
            # paste-buffer -d descarta no path feliz. Em qualquer falha (load
            # com returncode != 0, paste-buffer exception), buffer pode ter
            # ficado órfão — cleanup oportunista.
            if not paste_ok:
                try:
                    server.cmd("delete-buffer", "-b", buf_name)
                except libtmux_exc.LibTmuxException:
                    pass


def _press_enter_sync(session_name: str) -> bool:
    server = libtmux.Server()
    if not server.has_session(session_name):
        return False
    with _DISPATCH_LOCKS[session_name]:
        session = server.sessions.get(session_name=session_name)
        pane = session.active_pane
        try:
            pane.cmd("send-keys", "Enter")
            return True
        except libtmux_exc.LibTmuxException:
            return False


async def press_enter(session_name: str) -> bool:
    """Envia só `Enter` no pane ativo. Idempotente: sem prompt aberto, vira
    no-op no CC. Usado pelo `/model` pra confirmar picker quando ele aparece —
    sem picker, o Enter cai em prompt vazio e o CC ignora.

    Retorna False quando a sessão não existe ou libtmux falha — caller decide.
    """
    return await asyncio.to_thread(_press_enter_sync, session_name)


async def send_message(session_name: str, text: str) -> bool:
    """Cola `text` no pane ativo via tmux paste-buffer e submete com Enter.

    Sequência (Hermes-style, validada em produção):
        send-keys C-u → load-buffer → paste-buffer -d → sleep 150ms → send-keys Enter

    Preserva multilinha (envelope do Cockpit tem 30+ linhas); só sanitiza CR
    isolados. Buffer nomeado por uuid evita race entre dispatches concorrentes.

    Retorna False quando a sessão não existe ou o load-buffer falha. Erros do
    paste-buffer tentam cleanup do buffer e retornam False sem propagar — o
    caller loga sem desfazer a transação já persistida.
    """
    return await asyncio.to_thread(_send_message_sync, session_name, text)
