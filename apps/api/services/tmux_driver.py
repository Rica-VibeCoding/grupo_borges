"""Envio pontual de mensagens para sessões tmux da frota."""
from __future__ import annotations

import asyncio
import functools
import json
import logging
import os
import re
import shlex
import subprocess
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal, NamedTuple, TypeVar

import libtmux
from libtmux import exc as libtmux_exc

# Orçamentos independentes: pane ocupada pode ficar temporariamente ilegível
# antes do paste sem consumir o tempo reservado para provar a submissão.
_LOAD_BUFFER_TIMEOUT_S = 5.0
_PRE_PASTE_CONFIRM_TIMEOUT_S = 8.0
_SUBMIT_CONFIRM_TIMEOUT_S = 6.0
_SUBMIT_POLL_INTERVAL_S = 0.05
_SUBMIT_ENTER_RETRY_INTERVAL_S = 1.0
_SUBMIT_MAX_ENTER_ATTEMPTS = 3
_RECOVERY_STEP_TIMEOUT_S = 3.0
# Espera pelo lock da sessão antes de devolver 409 `tmux_busy`. O teto existe
# pra não enfileirar requisição indefinidamente, mas 0,25s (valor da primeira
# rodada) recusava toda concorrência: uma entrega normal com a pane ocupada
# gasta até ~19s (load 5 + pré-paste 8 + submissão 6), então a segunda mensagem
# do Rica batia em 409 enquanto a primeira ainda estava sendo entregue — e um
# 409 real apareceu no log em `POST /api/agents/pavan/input`. O motivo original
# de falhar rápido era não saturar as 6 threads do executor default; isso saiu
# de cena com o _TMUX_EXECUTOR dedicado abaixo, então esperar aqui não segura
# mais banco, SSE nem /fleet. 5s cobre o caso comum com folga e ainda falha bem
# antes do pior caso, que é quando o 409 honesto realmente ajuda.
_DISPATCH_LOCK_TIMEOUT_S = 5.0

log = logging.getLogger(__name__)

# Lock por session_name pra evitar race em dispatches concorrentes no mesmo
# pane: sem isso, dispatch B pode injetar paste/Enter entre o paste e o Enter
# de A, e os 2 envelopes saem fundidos como um único prompt no CC.
_DISPATCH_LOCKS: dict[str, threading.Lock] = {}
_DISPATCH_LOCKS_GUARD = threading.Lock()

# Operações de envio podem ficar dezenas de segundos observando a TUI. Elas não
# podem ocupar o executor default, compartilhado pelas leituras da API e do DB.
_TMUX_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="cockpit-tmux")

# Comandos esperados no pane ativo do agente. Se o user trocou de window (ex:
# abriu shell auxiliar), `active_pane` aponta pra outra coisa — paste no shell
# pode executar parte do envelope como comando. Guard aborta nesse caso.
_EXPECTED_PANE_COMMANDS = {"claude", "node", "codex"}


class TmuxSessionBusyError(RuntimeError):
    """Outra operação do cockpit já controla o mesmo pane tmux."""


def _dispatch_lock_for(session_name: str) -> threading.Lock:
    """Retorna um lock único por sessão, inclusive sob criação concorrente."""
    with _DISPATCH_LOCKS_GUARD:
        lock = _DISPATCH_LOCKS.get(session_name)
        if lock is None:
            lock = threading.Lock()
            _DISPATCH_LOCKS[session_name] = lock
        return lock


def _acquire_dispatch_lock(session_name: str) -> threading.Lock:
    lock = _dispatch_lock_for(session_name)
    if not lock.acquire(timeout=_DISPATCH_LOCK_TIMEOUT_S):
        raise TmuxSessionBusyError(f"sessão tmux ocupada: {session_name}")
    return lock


_T = TypeVar("_T")


async def _run_tmux_operation(func: Callable[..., _T], *args: object) -> _T:
    loop = asyncio.get_running_loop()
    call = functools.partial(func, *args)
    return await loop.run_in_executor(_TMUX_EXECUTOR, call)

AgentCli = Literal["claude_code", "codex"]

# Socket tmux por sessão. Na Hostinger a frota inteira vive no socket default.
# Na Oracle o boot systemd (borges-agent@%i) sobe UM server tmux por agente em
# `tmux -L borges-<sessão>` — o socket default nem existe lá. Env
# COCKPIT_TMUX_SOCKET="borges-{session}" ativa a busca no socket nomeado, com
# fallback pro default (subsessões criadas pelo próprio cockpit moram lá).
_TMUX_SOCKET_TEMPLATE = os.getenv("COCKPIT_TMUX_SOCKET", "").strip()


def _configured_named_socket_names() -> list[str]:
    """Descobre sockets configurados sem consultar uma vez por agente."""
    if not _TMUX_SOCKET_TEMPLATE:
        return []
    if "{session}" not in _TMUX_SOCKET_TEMPLATE:
        return [_TMUX_SOCKET_TEMPLATE]
    tmux_tmpdir = Path(os.getenv("TMUX_TMPDIR", "/tmp")) / f"tmux-{os.getuid()}"
    pattern = _TMUX_SOCKET_TEMPLATE.replace("{session}", "*")
    return sorted(path.name for path in tmux_tmpdir.glob(pattern) if path.is_socket())


def _session_names_from_server(server: libtmux.Server) -> set[str]:
    """Lista sessões preservando erro, ao contrário de ``Server.sessions``."""
    result = server.cmd("list-sessions", "-F#{session_name}")
    if result.returncode == 0:
        return {name for name in result.stdout if name}

    error = "\n".join(result.stderr).strip()
    # Ausência do próprio servidor/socket confirma que não há sessões nele.
    if "no server running" in error.lower() or "no such file or directory" in error.lower():
        return set()
    raise libtmux_exc.LibTmuxException(error or "falha ao listar sessões tmux")


def _list_session_names_sync() -> set[str]:
    """Inventaria sessões dos sockets configurados sem consulta por agente.

    Na Hostinger, lê somente o server default. Na Oracle, descobre de uma vez
    os sockets ``borges-*`` no diretório tmux e lê cada server encontrado; o
    default também entra porque hospeda subsessões criadas pelo cockpit.

    Erro de observação é propagado: falha de permissão/comando não pode virar
    conjunto vazio e marcar falsamente toda a frota como offline. Socket ou
    server comprovadamente ausente equivale corretamente a zero sessões.
    """
    session_names: set[str] = set()
    named_socket_names = _configured_named_socket_names()
    for socket_name in named_socket_names:
        server = libtmux.Server(socket_name=socket_name)
        session_names.update(_session_names_from_server(server))

    session_names.update(_session_names_from_server(libtmux.Server()))
    return session_names


async def list_session_names() -> set[str]:
    """Retorna o snapshot de sessões tmux sem bloquear o event loop."""
    return await asyncio.to_thread(_list_session_names_sync)


def _server_for(session_name: str) -> libtmux.Server:
    if _TMUX_SOCKET_TEMPLATE:
        named = libtmux.Server(
            socket_name=_TMUX_SOCKET_TEMPLATE.format(session=session_name)
        )
        try:
            if named.has_session(session_name):
                return named
        except libtmux_exc.LibTmuxException:
            pass
    return libtmux.Server()

_BOOTSTRAP_TIMEOUT_S = 15.0
_BOOTSTRAP_POLL_INTERVAL_S = 0.25
_RELAUNCH_PROCESS_EXIT_TIMEOUT_S = 5.0
_PANE_EXCERPT_TIMEOUT_S = 0.5
_PANE_EXCERPT_LINES = 12
_PANE_EXCERPT_MAX_CHARS = 1200
_REPOS_ROOT = Path("/home/clawd/repos").resolve()
_UNSAFE_WORKSPACE_CHARS = re.compile(r"[;&|\n\r\0]")
_MODEL_PATTERN = re.compile(r"[a-z0-9.\-]{1,80}")
_CLAUDE_ENCODED_CWD_CHARS = re.compile(r"[^a-zA-Z0-9]")
_ANSI_ESCAPE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_SGR_ESCAPE = re.compile(r"\x1b\[([0-9;:]*)m")
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# Variante que preserva ESC (0x1b) pra `preserve_ansi=True` — strippar o ESC
# anula as escape sequences ANSI (vira `[31m...` literal no front).
_CONTROL_CHARS_KEEP_ESC = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]")
_INPUT_PROMPT_MARKERS = ("❯", "›")
_PASTED_TEXT_MARKER = re.compile(r"\[Pasted text #[^]]+]")
_SESSION_ID_PATTERN = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
_BANNER_PATTERNS: dict[AgentCli, re.Pattern[str]] = {
    "claude_code": re.compile(r"╭|Claude Code v\d"),
    "codex": re.compile("›"),
}

_CODEX_MODEL_MAP = {
    "codex-gpt-5-6-sol": "gpt-5.6-sol",
    "codex-gpt-5-6-terra": "gpt-5.6-terra",
    "codex-gpt-5-6-luna": "gpt-5.6-luna",
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


class _PaneInputSnapshot(NamedTuple):
    state: Literal["empty", "armed", "unknown"]
    content: str


def _is_input_border(line: str) -> bool:
    stripped = line.strip()
    return len(stripped) >= 10 and set(stripped) <= {"─", "━", "-"}


def _sgr_dim_state(sequence: str, dim: bool) -> bool:
    """Aplica ao estado dim somente parâmetros SGR relevantes."""
    raw_params = sequence[2:-1]
    params = raw_params.split(";") if raw_params else ["0"]
    index = 0
    while index < len(params):
        raw_param = params[index]
        # Forma com dois-pontos mantém subparâmetros no mesmo item. Nenhuma
        # variante de dim usa subparâmetro, então não a confunda com SGR 2.
        if ":" in raw_param:
            index += 1
            continue
        try:
            param = int(raw_param or "0")
        except ValueError:
            index += 1
            continue

        # 38/48/58 introduzem cor estendida. Em ``38;2;r;g;b``, o 2 é modo
        # RGB, não dim; consuma a sequência inteira antes de continuar.
        if param in {38, 48, 58} and index + 1 < len(params):
            try:
                color_mode = int(params[index + 1])
            except ValueError:
                index += 1
                continue
            if color_mode == 5:
                index += 3
                continue
            if color_mode == 2:
                index += 5
                continue
        if param == 0:
            dim = False
        elif param == 2:
            dim = True
        elif param == 22:
            dim = False
        index += 1
    return dim


def _styled_input_content(lines: list[str]) -> tuple[str, bool]:
    """Remove ANSI e informa se todo glifo do input estava sob SGR dim."""
    output: list[str] = []
    dim_by_char: list[bool] = []
    dim = False
    saw_sgr = False
    content_started = False
    separator_pending = False

    for line_number, line in enumerate(lines):
        if line_number and content_started:
            output.append("\n")
            dim_by_char.append(dim)
        position = 0
        while position < len(line):
            escape = _ANSI_ESCAPE.match(line, position)
            if escape is not None:
                sequence = escape.group(0)
                if _SGR_ESCAPE.fullmatch(sequence):
                    saw_sgr = True
                    dim = _sgr_dim_state(sequence, dim)
                position = escape.end()
                continue

            char = line[position]
            position += 1
            if not content_started:
                if char.isspace():
                    continue
                if char in _INPUT_PROMPT_MARKERS:
                    content_started = True
                    separator_pending = True
                continue
            if separator_pending:
                separator_pending = False
                if char in {" ", "\u00a0"}:
                    continue
            output.append(char)
            dim_by_char.append(dim)

    content = "".join(output).rstrip()
    visible_styles = [
        char_dim
        for char, char_dim in zip(
            output[: len(content)], dim_by_char[: len(content)], strict=True
        )
        if not char.isspace()
    ]
    entirely_dim = saw_sgr and bool(visible_styles) and all(visible_styles)
    return content, entirely_dim


def _capture_pane_with_sgr_fallback(
    pane: libtmux.Pane,
    *,
    start: int,
    end: int,
    join_wrapped: bool,
) -> tuple[list[str], bool]:
    """Prefere ``capture-pane -e`` e degrada para a captura antiga."""
    try:
        lines = pane.capture_pane(
            start=start,
            end=end,
            escape_sequences=True,
            join_wrapped=join_wrapped,
        )
        return lines, any(_SGR_ESCAPE.search(line) for line in lines)
    except (libtmux_exc.LibTmuxException, AttributeError, IndexError):
        return (
            pane.capture_pane(
                start=start,
                end=end,
                escape_sequences=False,
                join_wrapped=join_wrapped,
            ),
            False,
        )


def _capture_input_snapshot(pane: libtmux.Pane) -> _PaneInputSnapshot:
    """Lê somente a caixa de input que contém o cursor atual.

    ``unknown`` é uma falha transitória de observação: durante renderização,
    spinner ou resize o contorno pode desaparecer por alguns frames. Callers
    devem repetir até o próprio teto, nunca converter um frame em diagnóstico.
    """
    try:
        position = pane.cmd("display-message", "-p", "#{cursor_x}\t#{cursor_y}")
    except (libtmux_exc.LibTmuxException, AttributeError, IndexError):
        return _PaneInputSnapshot("unknown", "")
    if position.returncode != 0 or not position.stdout:
        return _PaneInputSnapshot("unknown", "")
    try:
        cursor_x, cursor_y = map(int, position.stdout[0].split("\t", 1))
        pane_height = int(pane.pane_height)
    except (TypeError, ValueError):
        return _PaneInputSnapshot("unknown", "")

    try:
        styled_lines, sgr_available = _capture_pane_with_sgr_fallback(
            pane,
            start=0,
            end=max(0, pane_height - 1),
            join_wrapped=False,
        )
    except (libtmux_exc.LibTmuxException, AttributeError, IndexError):
        return _PaneInputSnapshot("unknown", "")
    if not styled_lines or cursor_y >= len(styled_lines):
        return _PaneInputSnapshot("unknown", "")
    lines = [_ANSI_ESCAPE.sub("", line) for line in styled_lines]

    bottom_border = next(
        (row for row in range(cursor_y + 1, len(lines)) if _is_input_border(lines[row])),
        None,
    )
    if bottom_border is None:
        return _PaneInputSnapshot("unknown", "")

    top_border = next(
        (row for row in range(cursor_y - 1, -1, -1) if _is_input_border(lines[row])),
        None,
    )
    search_start = top_border + 1 if top_border is not None else 0
    prompt_row = next(
        (
            row
            for row in range(cursor_y, search_start - 1, -1)
            if lines[row].lstrip().startswith(_INPUT_PROMPT_MARKERS)
        ),
        None,
    )
    if prompt_row is None:
        return _PaneInputSnapshot("unknown", "")

    try:
        # Segunda captura une somente soft-wraps do terminal. Assim o degrau 4
        # pode recolar o mesmo texto sem inserir quebras visuais artificiais.
        if sgr_available:
            styled_content_lines, content_has_sgr = _capture_pane_with_sgr_fallback(
                pane,
                start=prompt_row,
                end=bottom_border - 1,
                join_wrapped=True,
            )
        else:
            styled_content_lines = pane.capture_pane(
                start=prompt_row,
                end=bottom_border - 1,
                escape_sequences=False,
                join_wrapped=True,
            )
            content_has_sgr = False
    except (libtmux_exc.LibTmuxException, AttributeError, IndexError):
        return _PaneInputSnapshot("unknown", "")
    if not styled_content_lines:
        return _PaneInputSnapshot("unknown", "")
    content_lines = [_ANSI_ESCAPE.sub("", line) for line in styled_content_lines]
    first = content_lines[0].lstrip()
    if not first.startswith(_INPUT_PROMPT_MARKERS):
        return _PaneInputSnapshot("unknown", "")
    after_prompt = first[1:]
    if after_prompt.startswith((" ", "\u00a0")):
        after_prompt = after_prompt[1:]
    content_lines[0] = after_prompt
    # Ink/Claude preenche o resto da última linha com espaços (em pane 220 col,
    # um texto curto volta com ~190 espaços). Eles são células de layout, não
    # input; soft-wraps já foram unidos acima, então retire só a cauda final.
    content = "\n".join(content_lines).rstrip()
    styled_content, entirely_dim = _styled_input_content(styled_content_lines)
    if content_has_sgr and styled_content == content and entirely_dim:
        return _PaneInputSnapshot("empty", content)
    # Cursor em x=2 não basta: no incidente real o CC deixou texto visível
    # armado enquanto reportava o cursor no começo da caixa. Conteúdo vence a
    # posição para não declarar submissão falsa.
    if cursor_y == prompt_row and cursor_x <= 2 and not _normalize_visible_text(content):
        return _PaneInputSnapshot("empty", content)
    return _PaneInputSnapshot("armed", content)


def _input_is_fully_visible_single_line(pane: libtmux.Pane, expected: str) -> bool:
    """Prova conservadora antes de C-u: uma única linha física, inteira visível.

    Texto multilinha, soft-wrapped ou com o início rolado para fora da caixa
    falha fechado. O degrau 4 é um último recurso; é preferível deixar o input
    intacto a reconstruí-lo a partir de uma captura parcial.
    """
    # ASCII permite relacionar bytes visíveis a células do terminal sem
    # adivinhar largura de emoji/combining chars. Nos demais casos, falha
    # fechado: o degrau 4 é opcional e destrutivo.
    if not expected or "\n" in expected or not expected.isascii():
        return False
    try:
        position = pane.cmd("display-message", "-p", "#{cursor_x}\t#{cursor_y}")
        if position.returncode != 0 or not position.stdout:
            return False
        cursor_x, cursor_y = map(int, position.stdout[0].split("\t", 1))
        pane_height = int(pane.pane_height)
        pane_width = int(pane.pane_width)
        styled_lines, _ = _capture_pane_with_sgr_fallback(
            pane,
            start=0,
            end=max(0, pane_height - 1),
            join_wrapped=False,
        )
    except (
        libtmux_exc.LibTmuxException,
        AttributeError,
        IndexError,
        TypeError,
        ValueError,
    ):
        return False

    lines = [_ANSI_ESCAPE.sub("", line) for line in styled_lines]
    if cursor_y >= len(lines):
        return False
    bottom_border = next(
        (row for row in range(cursor_y + 1, len(lines)) if _is_input_border(lines[row])),
        None,
    )
    prompt_row = next(
        (
            row
            for row in range(cursor_y, -1, -1)
            if lines[row].lstrip().startswith(_INPUT_PROMPT_MARKERS)
        ),
        None,
    )
    if prompt_row is None or bottom_border != prompt_row + 1 or cursor_y != prompt_row:
        return False
    visible, _ = _styled_input_content([styled_lines[prompt_row]])
    expected_cursor_x = len(visible) + 2
    return (
        visible == expected
        and cursor_x == expected_cursor_x
        and cursor_x < pane_width - 1
    )


def _normalize_visible_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\u00a0", " ")).strip()


def _snapshot_contains_payload(snapshot: _PaneInputSnapshot, text: str) -> bool:
    if snapshot.state != "armed":
        return False
    visible = _normalize_visible_text(snapshot.content)
    expected = _normalize_visible_text(text)
    if _PASTED_TEXT_MARKER.search(snapshot.content):
        return True
    if not expected:
        return False
    needle = expected if len(expected) <= 160 else expected[-80:]
    return needle in visible


def _snapshot_proves_owned_payload(snapshot: _PaneInputSnapshot, text: str) -> bool:
    """Versão estrita para C-u: marcador genérico não prova propriedade."""
    return (
        snapshot.state == "armed"
        and not _PASTED_TEXT_MARKER.search(snapshot.content)
        and snapshot.content == text
    )


def _count_payload_prompt_lines(pane: libtmux.Pane, text: str) -> int | None:
    """Conta ocorrências visíveis do payload em prompts já transcritos."""
    expected = _normalize_visible_text(text)
    if not expected or "\n" in text:
        return None
    needle = expected if len(expected) <= 160 else expected[-80:]
    try:
        position = pane.cmd("display-message", "-p", "#{cursor_x}\t#{cursor_y}")
        cursor_y = (
            int(position.stdout[0].split("\t", 1)[1])
            if position.returncode == 0 and position.stdout
            else None
        )
        lines = pane.capture_pane(
            start=0,
            end=max(0, int(pane.pane_height) - 1),
            escape_sequences=False,
            join_wrapped=False,
        )
    except (
        libtmux_exc.LibTmuxException,
        AttributeError,
        IndexError,
        TypeError,
        ValueError,
    ):
        return None
    count = 0
    for row, line in enumerate(lines):
        stripped = line.lstrip()
        if not stripped.startswith(_INPUT_PROMPT_MARKERS):
            continue
        # A caixa editável atual também começa com ❯/›. Ela não é recibo de
        # submissão e fica delimitada por bordas horizontais; não a conte.
        if cursor_y is not None and row <= cursor_y:
            bottom_border = next(
                (
                    index
                    for index in range(cursor_y + 1, len(lines))
                    if _is_input_border(lines[index])
                ),
                None,
            )
            nearer_prompt = any(
                candidate.lstrip().startswith(_INPUT_PROMPT_MARKERS)
                for candidate in lines[row + 1 : cursor_y + 1]
            )
            if bottom_border is not None and not nearer_prompt:
                continue
        block = [stripped[1:].lstrip(" \u00a0")]
        for continuation in lines[row + 1 :]:
            if _is_input_border(continuation):
                break
            if continuation.lstrip().startswith(_INPUT_PROMPT_MARKERS):
                break
            block.append(continuation.rstrip())
        if needle in _normalize_visible_text("\n".join(block)):
            count += 1
    return count


def _wait_for_input(
    pane: libtmux.Pane,
    predicate: Callable[[_PaneInputSnapshot], bool],
    deadline: float,
    *,
    incompatible: Callable[[_PaneInputSnapshot], bool] | None = None,
) -> _PaneInputSnapshot | None:
    """Espera um snapshot útil; ``unknown`` sempre permanece transitório."""
    while time.monotonic() < deadline:
        snapshot = _capture_input_snapshot(pane)
        if predicate(snapshot):
            return snapshot
        if snapshot.state != "unknown" and incompatible and incompatible(snapshot):
            return None
        time.sleep(_SUBMIT_POLL_INTERVAL_S)
    return None


def _create_empty_session_sync(session_name: str) -> None:
    # Criação deliberada no socket default: sessão nova é sempre do cockpit
    # (subsessão); os sockets nomeados pertencem ao borges-agent@ do systemd.
    server = libtmux.Server()
    try:
        server.new_session(session_name=session_name, detached=True, kill_session=False)
    except libtmux_exc.LibTmuxException:
        raise


async def create_empty_session(session_name: str) -> None:
    """Cria uma sessão tmux vazia, sem bootar CLI dentro dela."""
    await asyncio.to_thread(_create_empty_session_sync, session_name)


def _bootstrap_cli_in_session_sync(
    session_name: str,
    workspace_path: str,
    cli: AgentCli,
    model: str,
    *,
    resume_session_id: str | None = None,
) -> dict[str, bool]:
    resolved_workspace, command = _prepare_cli_launch(
        workspace_path,
        cli,
        model,
        resume_session_id=resume_session_id,
    )

    server = _server_for(session_name)
    if not server.has_session(session_name):
        return {"attempted": False, "confirmed": False}

    session = server.sessions.get(session_name=session_name)
    pane = session.active_pane
    # defense-in-depth pre-shlex
    pane.send_keys(f"cd {shlex.quote(str(resolved_workspace))}")
    pane.send_keys(command)
    return _wait_for_cli_banner(pane, cli)


def _wait_for_cli_banner(pane: libtmux.Pane, cli: AgentCli) -> dict[str, bool]:
    pattern = _BANNER_PATTERNS[cli]
    deadline = time.monotonic() + _BOOTSTRAP_TIMEOUT_S
    while time.monotonic() < deadline:
        output = "\n".join(pane.capture_pane(escape_sequences=True, join_wrapped=True))
        if pattern.search(_ANSI_ESCAPE.sub("", output)):
            return {"attempted": True, "confirmed": True}
        time.sleep(_BOOTSTRAP_POLL_INTERVAL_S)

    return {"attempted": True, "confirmed": False}


def _prepare_cli_launch(
    workspace_path: str,
    cli: AgentCli,
    model: str,
    *,
    resume_session_id: str | None = None,
) -> tuple[Path, str]:
    """Valida tudo e monta o comando antes de qualquer ação destrutiva."""
    if not _MODEL_PATTERN.fullmatch(model):
        raise ValueError(f"model inválido: {model}")
    if _UNSAFE_WORKSPACE_CHARS.search(workspace_path):
        raise libtmux_exc.LibTmuxException("workspace_path contém caracteres inseguros")
    resolved_workspace = Path(workspace_path).resolve()
    if not resolved_workspace.is_relative_to(_REPOS_ROOT):
        raise ValueError(f"workspace_path fora de {_REPOS_ROOT}: {workspace_path}")

    try:
        command = _CLI_COMMANDS[cli](model)
    except KeyError as e:
        raise libtmux_exc.LibTmuxException(f"cli inválido: {cli}") from e
    if resume_session_id is not None:
        if cli != "claude_code" or not _SESSION_ID_PATTERN.fullmatch(resume_session_id):
            raise ValueError("session_id inválido para claude --resume")
        command += f" --resume {shlex.quote(resume_session_id)}"
    return resolved_workspace, command


def _claude_resume_jsonl_path(workspace: Path, session_id: str) -> Path:
    """Resolve o JSONL que o Claude Code indexa para este cwd exato."""
    encoded_cwd = _CLAUDE_ENCODED_CWD_CHARS.sub("-", str(workspace))
    return Path.home() / ".claude" / "projects" / encoded_cwd / f"{session_id}.jsonl"


def _conversation_resume_anchors(jsonl_path: Path) -> list[str]:
    """Extrai textos recentes que precisam reaparecer na TUI retomada.

    O JSONL do Claude Code não tem schema público estável. O parser portanto
    ignora linhas/campos desconhecidos e aceita conteúdo textual direto ou em
    blocos ``{"type": "text", "text": ...}``.
    """
    anchors: list[str] = []
    try:
        lines = jsonl_path.read_text(errors="replace").splitlines()
    except OSError:
        return anchors

    for raw_line in reversed(lines):
        try:
            entry = json.loads(raw_line)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(entry, dict):
            continue
        if entry.get("type") not in {"user", "assistant"}:
            continue
        message = entry.get("message")
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        texts: list[str] = []
        if isinstance(content, str):
            texts.append(content)
        elif isinstance(content, list):
            texts.extend(
                block["text"]
                for block in content
                if isinstance(block, dict)
                and block.get("type") == "text"
                and isinstance(block.get("text"), str)
            )
        for text in reversed(texts):
            normalized = _normalize_visible_text(text)
            if len(normalized) >= 24 and normalized not in anchors:
                anchors.append(normalized)
        if len(anchors) >= 8:
            break
    return anchors


def _pane_owner_pids(pane_pid: int) -> set[int]:
    """Lê os PIDs do shell do pane e do processo foreground no Linux."""
    try:
        stat = Path(f"/proc/{pane_pid}/stat").read_text()
        fields = stat[stat.rfind(")") + 2 :].split()
        foreground_group = int(fields[5])
    except (IndexError, OSError, ValueError):
        return {pane_pid}
    return {pid for pid in (pane_pid, foreground_group) if pid > 0}


def _pane_launch_path(pane_pid: int) -> str:
    """Preserva o PATH efetivo do processo foreground, inclusive exports locais."""
    candidate_pids = [pane_pid]
    try:
        stat = Path(f"/proc/{pane_pid}/stat").read_text()
        fields = stat[stat.rfind(")") + 2 :].split()
        foreground_group = int(fields[5])
        if foreground_group > 0:
            candidate_pids.insert(0, foreground_group)
    except (IndexError, OSError, ValueError):
        pass

    for candidate_pid in candidate_pids:
        try:
            environment = Path(f"/proc/{candidate_pid}/environ").read_bytes()
        except OSError:
            continue
        for item in environment.split(b"\0"):
            if item.startswith(b"PATH="):
                value = item.removeprefix(b"PATH=").decode(errors="replace")
                if value:
                    return value
    return os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")


def _wait_for_processes_exit(process_ids: set[int]) -> bool:
    """Espera shell e Claude antigos encerrarem antes do resume."""
    deadline = time.monotonic() + _RELAUNCH_PROCESS_EXIT_TIMEOUT_S
    remaining = set(process_ids)
    while remaining and time.monotonic() < deadline:
        for process_id in tuple(remaining):
            try:
                os.kill(process_id, 0)
            except ProcessLookupError:
                remaining.remove(process_id)
            except PermissionError:
                pass
        if remaining:
            time.sleep(_BOOTSTRAP_POLL_INTERVAL_S)
    return not remaining


def _anchor_is_visible(output: str, anchor: str) -> bool:
    """Tolera wrapping/cortes da TUI sem aceitar só um banner de sessão nova."""
    if len(anchor) < 24:
        return False
    if anchor in output:
        return True
    return anchor[:80] in output or anchor[-80:] in output


def _pane_contains_resume_anchor(pane: libtmux.Pane, anchors: list[str]) -> bool:
    """Vincula conservadoramente o JSONL escolhido à conversa da pane atual."""
    try:
        lines = pane.capture_pane(escape_sequences=False, join_wrapped=True)
    except (libtmux_exc.LibTmuxException, AttributeError, IndexError):
        return False
    output = _normalize_visible_text("\n".join(lines))
    return any(_anchor_is_visible(output, anchor) for anchor in anchors)


def _remove_replacement_if_old_window_survives(
    server: libtmux.Server,
    session_name: str,
    old_window_id: str,
    replacement_window_id: str,
) -> None:
    """Evita window órfã sem jamais remover a única window sobrevivente."""
    observed = server.cmd(
        "list-windows",
        "-t",
        session_name,
        "-F",
        "#{window_id}",
    )
    if observed.returncode != 0:
        return
    window_ids = set(observed.stdout)
    if {old_window_id, replacement_window_id} <= window_ids:
        server.cmd("kill-window", "-t", replacement_window_id)


def _wait_for_resumed_claude_tui(
    pane: libtmux.Pane,
    anchors: list[str],
) -> dict[str, bool]:
    """Confirma banner, caixa de input e conteúdo da conversa retomada."""
    deadline = time.monotonic() + _BOOTSTRAP_TIMEOUT_S
    while time.monotonic() < deadline:
        try:
            lines = pane.capture_pane(escape_sequences=False, join_wrapped=True)
            output = _normalize_visible_text("\n".join(lines))
            snapshot = _capture_input_snapshot(pane)
            pane.refresh()
        except (libtmux_exc.LibTmuxException, AttributeError, IndexError):
            time.sleep(_BOOTSTRAP_POLL_INTERVAL_S)
            continue
        current_cmd = (pane.pane_current_command or "").lower()
        context_visible = bool(anchors) and any(
            _anchor_is_visible(output, anchor) for anchor in anchors
        )
        if (
            current_cmd in {"claude", "node"}
            and snapshot.state == "empty"
            and context_visible
        ):
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


def _restart_claude_with_resume_sync(
    session_name: str,
    workspace_path: str,
    model: str,
    resume_session_id: str,
) -> dict[str, bool]:
    """Troca a window do agente sem deixar a sessão tmux ficar sem window."""
    resolved_workspace, resume_command = _prepare_cli_launch(
        workspace_path,
        "claude_code",
        model,
        resume_session_id=resume_session_id,
    )
    resume_jsonl = _claude_resume_jsonl_path(resolved_workspace, resume_session_id)
    if not resume_jsonl.is_file():
        raise ValueError("session_id não pertence ao workspace atual")
    anchors = _conversation_resume_anchors(resume_jsonl)
    if not anchors:
        raise ValueError("conversa sem texto observável para confirmar o resume")

    # O shell final continua sendo a rede de segurança caso o Claude saia. Não
    # há fallback para uma conversa fresh: uma TUI nova jamais pode confirmar
    # este endpoint como se o contexto antigo tivesse voltado.
    server = _server_for(session_name)
    if not server.has_session(session_name):
        return {"attempted": False, "confirmed": False}

    lock = _acquire_dispatch_lock(session_name)
    try:
        session = server.sessions.get(session_name=session_name)
        old_pane = session.active_pane
        current_cmd = (old_pane.pane_current_command or "").lower()
        if current_cmd not in _EXPECTED_PANE_COMMANDS:
            return {"attempted": False, "confirmed": False}
        if not _pane_contains_resume_anchor(old_pane, anchors):
            raise ValueError("session_id não corresponde à conversa visível no pane")

        old_window_id = old_pane.window.window_id
        old_process_ids = _pane_owner_pids(int(old_pane.pane_pid))
        launch_path = _pane_launch_path(int(old_pane.pane_pid))
        launch_command = (
            f"PATH={shlex.quote(launch_path)} {resume_command}; "
            'exec "${SHELL:-/bin/sh}"'
        )
        created = server.cmd(
            "new-window",
            "-d",
            "-P",
            "-F",
            "#{window_id}\t#{pane_id}",
            "-t",
            f"{session_name}:",
            "-c",
            str(resolved_workspace),
        )
        if created.returncode != 0 or not created.stdout:
            return {"attempted": False, "confirmed": False}
        try:
            replacement_window_id, _ = created.stdout[0].split("\t", 1)
        except ValueError:
            return {"attempted": False, "confirmed": False}

        killed = server.cmd("kill-window", "-t", old_window_id)
        if killed.returncode != 0:
            _remove_replacement_if_old_window_survives(
                server,
                session_name,
                old_window_id,
                replacement_window_id,
            )
            return {"attempted": False, "confirmed": False}
        if not _wait_for_processes_exit(old_process_ids):
            return {"attempted": True, "confirmed": False}

        session = server.sessions.get(session_name=session_name)
        replacement_pane = session.windows.get(
            window_id=replacement_window_id
        ).active_pane
        replacement_pane.send_keys(launch_command, enter=False)
        replacement_pane.enter()
        return _wait_for_resumed_claude_tui(replacement_pane, anchors)
    finally:
        lock.release()


async def restart_claude_with_resume(
    session_name: str,
    workspace_path: str,
    model: str,
    resume_session_id: str,
) -> dict[str, bool]:
    """Relança e só confirma quando TUI e conversa retomada estão visíveis."""
    return await _run_tmux_operation(
        _restart_claude_with_resume_sync,
        session_name,
        workspace_path,
        model,
        resume_session_id,
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
    control_re = _CONTROL_CHARS_KEEP_ESC if preserve_ansi else _CONTROL_CHARS
    for line in lines:
        text = line if preserve_ansi else _ANSI_ESCAPE.sub("", line)
        text = control_re.sub("", text).rstrip()
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
    server = _server_for(session_name)
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
#   "Opus 4.8 (1M context) - 20:14:19 - [...] 7%"  ← janela 1M insere parêntese
#   "Fable 5 - 03:54 - [...] 27%"                  ← Fable não tem decimal na versão
#   "Opus 4.7 (1M context) - 05:42 - [...] 9%"     ← sessão < 1h emite só MM:SS
_CC_SESSION_TIME = re.compile(
    r"\b(?:Fable|Opus|Sonnet|Haiku)\s+\d+(?:\.\d+)?(?:\s+\([^)]*\))?\s+[-–]\s+"
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
_CC_MODEL_NAME = re.compile(r"\b(Fable|Opus|Sonnet|Haiku)\s+\d+(?:\.\d+)?", re.IGNORECASE)


def parse_model_from_pane(excerpt: str | None) -> str | None:
    """Extrai slug curto (fable|opus|sonnet|haiku) do statusline do pane.

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
    server = _server_for(session_name)
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


def _load_tmux_buffer(server: libtmux.Server, text: str) -> str | None:
    buf_name = f"cockpit-dispatch-{uuid.uuid4().hex[:12]}"
    tmux_argv = ["tmux"]
    if server.socket_name:
        tmux_argv += ["-L", server.socket_name]
    try:
        result = subprocess.run(
            tmux_argv + ["load-buffer", "-b", buf_name, "-"],
            input=text,
            text=True,
            capture_output=True,
            timeout=_LOAD_BUFFER_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        _delete_tmux_buffer(server, buf_name)
        return None
    if result.returncode != 0:
        _delete_tmux_buffer(server, buf_name)
        return None
    return buf_name


def _delete_tmux_buffer(server: libtmux.Server, buf_name: str) -> None:
    try:
        server.cmd("delete-buffer", "-b", buf_name)
    except libtmux_exc.LibTmuxException:
        pass


def _paste_loaded_buffer(
    pane: libtmux.Pane, buf_name: str, *, delete_after: bool = True
) -> bool:
    try:
        # -p ativa bracketed paste (multilinha). No envio comum, -d remove o
        # buffer; na recuperação ele fica nomeado até haver sucesso comprovado.
        args = ["paste-buffer"]
        if delete_after:
            args.append("-d")
        result = pane.cmd(*args, "-p", "-b", buf_name)
        return result.returncode == 0
    except libtmux_exc.LibTmuxException:
        return False


def _send_key(pane: libtmux.Pane, key: str) -> bool:
    try:
        return pane.cmd("send-keys", key).returncode == 0
    except libtmux_exc.LibTmuxException:
        return False


def _confirm_armed_submission(
    pane: libtmux.Pane,
    text: str,
    *,
    prior_prompt_count: int | None,
    deadline: float,
    max_enter_attempts: int,
) -> tuple[bool, int]:
    """Pressiona Enter e só confirma por input vazio ou prompt transcrito."""
    enter_attempts = 0
    while enter_attempts < max_enter_attempts and time.monotonic() < deadline:
        if not _send_key(pane, "Enter"):
            return False, enter_attempts
        enter_attempts += 1
        retry_at = min(deadline, time.monotonic() + _SUBMIT_ENTER_RETRY_INTERVAL_S)

        while time.monotonic() < deadline:
            time.sleep(_SUBMIT_POLL_INTERVAL_S)
            snapshot = _capture_input_snapshot(pane)
            current_prompt_count = _count_payload_prompt_lines(pane, text)
            if (
                prior_prompt_count is not None
                and current_prompt_count is not None
                and current_prompt_count > prior_prompt_count
            ):
                return True, enter_attempts
            if snapshot.state == "unknown":
                continue
            if snapshot.state == "empty":
                return True, enter_attempts
            if not _snapshot_contains_payload(snapshot, text):
                # Texto diferente apareceu: pode ser humano. Nunca toque nele.
                return False, enter_attempts
            # Só repete Enter depois de uma janela real e enquanto o snapshot
            # atual ainda prova que o mesmo payload continua armado. unknown
            # nunca autoriza um Enter extra.
            if time.monotonic() >= retry_at:
                break

    return False, enter_attempts


def _send_message_sync(session_name: str, text: str) -> bool:
    server = _server_for(session_name)
    if not server.has_session(session_name):
        return False

    # \r solto vira ruído no buffer tmux; \r\n vira \n; \n é preservado pra
    # multilinha funcionar como paste real (envelope do Cockpit tem 30+ linhas).
    # Control chars (exceto \n e \t) removidos pra evitar sequência ANSI inesperada
    # consumida pelo terminal do pane.
    sanitized = _CONTROL_CHARS.sub("", text.replace("\r\n", "\n").replace("\r", ""))

    lock = _acquire_dispatch_lock(session_name)
    try:
        session = server.sessions.get(session_name=session_name)
        pane = session.active_pane

        # Guard: se o pane ativo não é o CLI esperado (ex: agente trocou window
        # pra rodar shell auxiliar), aborta — paste no shell executaria parte do
        # envelope como comando.
        current_cmd = (pane.pane_current_command or "").lower()
        if current_cmd not in _EXPECTED_PANE_COMMANDS:
            return False

        try:
            # load-buffer não toca o pane e pode levar até 5s. Faça-o antes de
            # provar vazio para não abrir uma janela de concatenação humana.
            buf_name = _load_tmux_buffer(server, sanitized)
            if buf_name is None:
                return False

            paste_ok = False
            try:
                pre_paste_deadline = time.monotonic() + _PRE_PASTE_CONFIRM_TIMEOUT_S
                empty_snapshot = _wait_for_input(
                    pane,
                    lambda snapshot: snapshot.state == "empty",
                    pre_paste_deadline,
                    incompatible=lambda snapshot: snapshot.state == "armed",
                )
                if empty_snapshot is None:
                    log.warning(
                        "tmux input indisponível ou armado antes do paste: session=%s",
                        session_name,
                    )
                    return False

                prior_prompt_count = _count_payload_prompt_lines(pane, sanitized)
                # Segunda leitura imediatamente antes do paste fecha a corrida
                # entre a observação anterior e uma digitação humana.
                if _capture_input_snapshot(pane).state != "empty":
                    log.warning("tmux input mudou antes do paste: session=%s", session_name)
                    return False
                if not _paste_loaded_buffer(pane, buf_name):
                    return False
                paste_ok = True
                paste_deadline = time.monotonic() + _SUBMIT_CONFIRM_TIMEOUT_S
                pasted = _wait_for_input(
                    pane,
                    lambda snapshot: _snapshot_contains_payload(snapshot, sanitized),
                    paste_deadline,
                )
                if pasted is None:
                    final_snapshot = _capture_input_snapshot(pane)
                    if _snapshot_proves_owned_payload(final_snapshot, sanitized):
                        _send_key(pane, "C-u")
                    log.warning("tmux paste não observado no input: session=%s", session_name)
                    return False

                submit_deadline = time.monotonic() + _SUBMIT_CONFIRM_TIMEOUT_S
                confirmed, enter_attempts = _confirm_armed_submission(
                    pane,
                    sanitized,
                    prior_prompt_count=prior_prompt_count,
                    deadline=submit_deadline,
                    max_enter_attempts=_SUBMIT_MAX_ENTER_ATTEMPTS,
                )
                if confirmed:
                    return True

                # Só limpa quando a pane ainda prova que o texto é o nosso.
                final_snapshot = _capture_input_snapshot(pane)
                if _snapshot_proves_owned_payload(final_snapshot, sanitized):
                    _send_key(pane, "C-u")
                log.warning(
                    "tmux Enter sem confirmação: session=%s attempts=%d",
                    session_name,
                    enter_attempts,
                )
                return False
            finally:
                # paste-buffer -d descarta no caminho feliz. Em falha anterior
                # ao paste, o buffer ainda existe e precisa de cleanup.
                if not paste_ok:
                    _delete_tmux_buffer(server, buf_name)
        except libtmux_exc.LibTmuxException:
            return False
    finally:
        lock.release()


def _recover_input_sync(session_name: str) -> dict[str, bool | int | str]:
    """Executa a escada determinística do endpoint ``destrava``."""
    server = _server_for(session_name)
    if not server.has_session(session_name):
        return {"tmux_delivered": False, "degrau": 5, "acao": "sessao_ausente"}

    try:
        lock = _acquire_dispatch_lock(session_name)
    except TmuxSessionBusyError:
        return {"tmux_delivered": False, "degrau": 5, "acao": "sessao_ocupada"}

    try:
        session = server.sessions.get(session_name=session_name)
        pane = session.active_pane
        current_cmd = (pane.pane_current_command or "").lower()
        if current_cmd not in _EXPECTED_PANE_COMMANDS:
            return {"tmux_delivered": False, "degrau": 5, "acao": "pane_incompativel"}

        try:
            # Degrau 1: fecha modal, se houver.
            if not _send_key(pane, "Escape"):
                return {"tmux_delivered": False, "degrau": 5, "acao": "escape_falhou"}
            read_deadline = time.monotonic() + _PRE_PASTE_CONFIRM_TIMEOUT_S
            snapshot = _wait_for_input(
                pane,
                lambda candidate: candidate.state != "unknown",
                read_deadline,
            )
            if snapshot is None:
                return {
                    "tmux_delivered": False,
                    "degrau": 5,
                    "acao": "input_nao_observavel",
                }
            # Degrau 2: Escape deixou um input vazio; não existe texto a enviar.
            if snapshot.state == "empty":
                return {"tmux_delivered": True, "degrau": 2, "acao": "input_vazio"}

            armed_text = snapshot.content
            prior_prompt_count = _count_payload_prompt_lines(pane, armed_text)

            # Degrau 3: um Enter, com comprovação observável.
            confirmed, _ = _confirm_armed_submission(
                pane,
                armed_text,
                prior_prompt_count=prior_prompt_count,
                deadline=time.monotonic() + _RECOVERY_STEP_TIMEOUT_S,
                max_enter_attempts=1,
            )
            if confirmed:
                return {"tmux_delivered": True, "degrau": 3, "acao": "enter"}

            current = _wait_for_input(
                pane,
                lambda candidate: candidate.state != "unknown",
                time.monotonic() + _RECOVERY_STEP_TIMEOUT_S,
            )
            if current is not None and current.state == "empty":
                return {
                    "tmux_delivered": False,
                    "degrau": 5,
                    "acao": "submissao_nao_confirmada",
                }
            if (
                current is None
                or current.state != "armed"
                or current.content != armed_text
                or not armed_text
                or _PASTED_TEXT_MARKER.search(armed_text)
            ):
                return {
                    "tmux_delivered": False,
                    "degrau": 5,
                    "acao": "texto_armado_nao_recuperavel",
                }
            if not _input_is_fully_visible_single_line(pane, armed_text):
                return {
                    "tmux_delivered": False,
                    "degrau": 5,
                    "acao": "texto_armado_nao_totalmente_visivel",
                }

            # Degrau 4: guarda o texto antes de limpar. Revalida imediatamente
            # antes do C-u para nunca apagar texto novo digitado por uma pessoa.
            buf_name = _load_tmux_buffer(server, armed_text)
            if buf_name is None:
                return {"tmux_delivered": False, "degrau": 5, "acao": "buffer_falhou"}
            preserve_buffer = False
            try:
                latest = _capture_input_snapshot(pane)
                if (
                    latest.state != "armed"
                    or latest.content != armed_text
                    or not _input_is_fully_visible_single_line(pane, armed_text)
                ):
                    return {
                        "tmux_delivered": False,
                        "degrau": 5,
                        "acao": "texto_armado_mudou",
                    }
                if not _send_key(pane, "C-u"):
                    return {
                        "tmux_delivered": False,
                        "degrau": 5,
                        "acao": "limpeza_falhou",
                    }
                preserve_buffer = True
                cleared_snapshot = _wait_for_input(
                    pane,
                    lambda candidate: candidate.state == "empty",
                    time.monotonic() + _RECOVERY_STEP_TIMEOUT_S,
                    incompatible=lambda candidate: candidate.state == "armed",
                )
                if cleared_snapshot is None:
                    return {
                        "tmux_delivered": False,
                        "degrau": 5,
                        "acao": "limpeza_nao_confirmada_buffer_preservado",
                        "buffer_name": buf_name,
                    }
                if not _paste_loaded_buffer(pane, buf_name, delete_after=False):
                    return {
                        "tmux_delivered": False,
                        "degrau": 5,
                        "acao": "recolagem_falhou_buffer_preservado",
                        "buffer_name": buf_name,
                    }
                paste_deadline = time.monotonic() + _SUBMIT_CONFIRM_TIMEOUT_S
                pasted = _wait_for_input(
                    pane,
                    lambda candidate: _snapshot_contains_payload(candidate, armed_text),
                    paste_deadline,
                )
                if pasted is None:
                    return {
                        "tmux_delivered": False,
                        "degrau": 5,
                        "acao": "recolagem_nao_confirmada_buffer_preservado",
                        "buffer_name": buf_name,
                    }
                submit_deadline = time.monotonic() + _SUBMIT_CONFIRM_TIMEOUT_S
                confirmed, _ = _confirm_armed_submission(
                    pane,
                    armed_text,
                    prior_prompt_count=prior_prompt_count,
                    deadline=submit_deadline,
                    max_enter_attempts=1,
                )
                if confirmed:
                    preserve_buffer = False
                    return {"tmux_delivered": True, "degrau": 4, "acao": "recolar_enter"}
                return {
                    "tmux_delivered": False,
                    "degrau": 5,
                    "acao": "submissao_nao_confirmada_buffer_preservado",
                    "buffer_name": buf_name,
                }
            except libtmux_exc.LibTmuxException:
                if preserve_buffer:
                    return {
                        "tmux_delivered": False,
                        "degrau": 5,
                        "acao": "erro_tmux_buffer_preservado",
                        "buffer_name": buf_name,
                    }
                raise
            finally:
                # Antes do C-u, o texto original continua no input e o buffer é
                # descartável. Depois dele, qualquer falha mantém uma cópia
                # nomeada e devolve esse nome ao usuário.
                if not preserve_buffer:
                    _delete_tmux_buffer(server, buf_name)
        except libtmux_exc.LibTmuxException:
            return {"tmux_delivered": False, "degrau": 5, "acao": "erro_tmux"}
    finally:
        lock.release()


async def recover_input(session_name: str) -> dict[str, bool | int | str]:
    """Executa Escape → inspeção → Enter → recolagem segura, fora do event loop."""
    return await _run_tmux_operation(_recover_input_sync, session_name)


def _press_enter_sync(session_name: str) -> bool:
    server = _server_for(session_name)
    if not server.has_session(session_name):
        return False
    try:
        lock = _acquire_dispatch_lock(session_name)
    except TmuxSessionBusyError:
        return False
    try:
        session = server.sessions.get(session_name=session_name)
        pane = session.active_pane
        return _send_key(pane, "Enter")
    finally:
        lock.release()


async def press_enter(session_name: str) -> bool:
    """Envia só `Enter` no pane ativo. Idempotente: sem prompt aberto, vira
    no-op no CC. Usado pelo `/model` pra confirmar picker quando ele aparece —
    sem picker, o Enter cai em prompt vazio e o CC ignora.

    Retorna False quando a sessão não existe ou libtmux falha — caller decide.
    """
    return await asyncio.to_thread(_press_enter_sync, session_name)


async def send_message(session_name: str, text: str) -> bool:
    """Cola `text` no pane ativo via tmux paste-buffer e submete com Enter.

    Sequência observável:
        confirma input vazio → paste-buffer -d -p → confirma payload armado →
        Enter (até 3 tentativas enquanto o mesmo payload permanece armado) →
        confirma input vazio ou nova linha transcrita.

    Preserva multilinha (envelope do Cockpit tem 30+ linhas); só sanitiza CR
    isolados. Buffer nomeado por uuid evita race entre dispatches concorrentes.
    `-p` ativa bracketed paste — CC consolida o bloco em mensagem única em vez
    de submeter linha-a-linha.

    ``unknown`` é transitório até os tetos independentes de pré-paste (8s) e
    submissão (6s). Retorna True somente com prova observável. C-u só limpa um
    payload ainda reconhecido como o nosso; texto humano diferente nunca é
    apagado nem substituído.
    """
    return await _run_tmux_operation(_send_message_sync, session_name, text)
