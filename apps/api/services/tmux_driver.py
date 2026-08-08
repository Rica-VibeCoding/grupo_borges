"""Envio pontual de mensagens para sessões tmux da frota."""
from __future__ import annotations

import asyncio
import functools
import json
import logging
import os
import re
import shlex
import signal
import subprocess
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
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
_CLAUDE_PANE_COMMANDS = {"claude", "node"}


class TmuxSessionInventory(NamedTuple):
    """Sessões existentes e sessões com Claude Code no foreground."""

    sessions: set[str]
    claude_process_sessions: set[str]


class _DeliveryChannelRecord(NamedTuple):
    delivering: bool
    reason: str | None
    consecutive_refusals: int
    blocked_since: float | None
    last_attempt_at: float


_DELIVERY_CHANNEL_RECORDS: dict[str, _DeliveryChannelRecord] = {}
_DELIVERY_CHANNEL_RECORDS_GUARD = threading.Lock()
_DELIVERY_FAILURE_MESSAGES = {
    "sessao_ausente": "A sessão do agente não está disponível.",
    "pane_incompativel": "A tela ativa do agente não aceita mensagens.",
    "buffer_indisponivel": "O canal não conseguiu preparar a mensagem.",
    "input_ocupado_ou_travado": "O campo de mensagem do agente está ocupado ou travado.",
    "input_nao_observavel": "O canal não conseguiu verificar o campo de mensagem.",
    "paste_falhou": "O canal não conseguiu colocar a mensagem no campo do agente.",
    "paste_nao_confirmado": "O canal não confirmou a mensagem no campo do agente.",
    "envio_nao_confirmado": "O canal não confirmou o envio da mensagem ao agente.",
    "erro_tmux": "O canal perdeu acesso à sessão do agente.",
}
# Motivos que provam que o pane não foi tocado: a recusa aconteceu antes de
# qualquer paste. O que não está aqui aconteceu depois — a mensagem pode ter
# entrado no agente sem que o canal conseguisse confirmar.
_REFUSALS_BEFORE_PASTE = frozenset(
    {
        "sessao_ausente",
        "pane_incompativel",
        "buffer_indisponivel",
        "input_ocupado_ou_travado",
        "input_nao_observavel",
    }
)


@dataclass(frozen=True, slots=True)
class DeliveryResult:
    """Os três desfechos de um envio, onde antes havia um bool com dois.

    ``refused`` e ``uncertain`` eram ambos ``False``, e a diferença entre eles é
    prática: só ``refused`` prova que nada foi escrito no pane, e portanto só
    ele é seguro para reenviar sozinho. Reenviar um ``uncertain`` duplica a
    mensagem no agente.
    """

    outcome: Literal["delivered", "refused", "uncertain"]
    reason: str | None = None

    @property
    def delivered(self) -> bool:
        return self.outcome == "delivered"

    @property
    def safe_to_resend(self) -> bool:
        return self.outcome == "refused"

    @property
    def message(self) -> str | None:
        """O motivo em linguagem de operação, para log e para quem for exibir."""
        if self.reason is None:
            return None
        return _DELIVERY_FAILURE_MESSAGES.get(self.reason, "Falha desconhecida no canal.")


DELIVERED = DeliveryResult(outcome="delivered")


def _record_delivery_refusal(session_name: str, reason: str) -> DeliveryResult:
    """Memoriza, alarma e devolve a recusa com o motivo que já era calculado."""
    now = time.time()
    with _DELIVERY_CHANNEL_RECORDS_GUARD:
        previous = _DELIVERY_CHANNEL_RECORDS.get(session_name)
        if previous is not None and not previous.delivering:
            blocked_since = previous.blocked_since or now
            consecutive_refusals = previous.consecutive_refusals + 1
        else:
            blocked_since = now
            consecutive_refusals = 1
        _DELIVERY_CHANNEL_RECORDS[session_name] = _DeliveryChannelRecord(
            delivering=False,
            reason=reason,
            consecutive_refusals=consecutive_refusals,
            blocked_since=blocked_since,
            last_attempt_at=now,
        )
    blocked_for_seconds = max(0, int(now - blocked_since))
    outcome: Literal["refused", "uncertain"] = (
        "refused" if reason in _REFUSALS_BEFORE_PASTE else "uncertain"
    )
    log.error(
        "canal de entrega bloqueado: slug=%s desfecho=%s motivo=%s detalhe=%s "
        "recusas_consecutivas=%d bloqueado_ha_segundos=%d",
        session_name,
        outcome,
        reason,
        _DELIVERY_FAILURE_MESSAGES.get(reason, "Falha desconhecida no canal."),
        consecutive_refusals,
        blocked_for_seconds,
    )
    return DeliveryResult(outcome=outcome, reason=reason)


def _record_delivery_success(session_name: str) -> DeliveryResult:
    now = time.time()
    with _DELIVERY_CHANNEL_RECORDS_GUARD:
        _DELIVERY_CHANNEL_RECORDS[session_name] = _DeliveryChannelRecord(
            delivering=True,
            reason=None,
            consecutive_refusals=0,
            blocked_since=None,
            last_attempt_at=now,
        )
    return DELIVERED


def get_delivery_channel_state(session_name: str) -> dict[str, bool | int | str | None]:
    """Expõe o último estado conhecido em linguagem de operação, sem tmuxês."""
    now = time.time()
    with _DELIVERY_CHANNEL_RECORDS_GUARD:
        record = _DELIVERY_CHANNEL_RECORDS.get(session_name)

    if record is None:
        return {
            "estado": "sem_dados",
            "entregando": None,
            "motivo": None,
            "mensagem": "Ainda não houve tentativa de entrega desde que a API iniciou.",
            "recusas_consecutivas": 0,
            "bloqueado_desde": None,
            "bloqueado_ha_segundos": 0,
            "ultima_tentativa_em": None,
            "acao_recomendada": "Envie uma mensagem para confirmar o canal.",
        }

    if record.delivering:
        return {
            "estado": "entregando",
            "entregando": True,
            "motivo": None,
            "mensagem": "A última entrega ao agente foi confirmada.",
            "recusas_consecutivas": 0,
            "bloqueado_desde": None,
            "bloqueado_ha_segundos": 0,
            "ultima_tentativa_em": int(record.last_attempt_at),
            "acao_recomendada": "Nenhuma ação necessária.",
        }

    blocked_since = record.blocked_since or record.last_attempt_at
    return {
        "estado": "bloqueado",
        "entregando": False,
        "motivo": record.reason,
        "mensagem": _DELIVERY_FAILURE_MESSAGES.get(
            record.reason or "", "Falha desconhecida no canal."
        ),
        "recusas_consecutivas": record.consecutive_refusals,
        "bloqueado_desde": int(blocked_since),
        "bloqueado_ha_segundos": max(0, int(now - blocked_since)),
        "ultima_tentativa_em": int(record.last_attempt_at),
        "acao_recomendada": "Use 'Destravar agente' antes de enviar novamente.",
    }


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


def _session_inventory_from_server(server: libtmux.Server) -> TmuxSessionInventory:
    """Lê presença da sessão e do CLI pelo snapshot de panes do tmux.

    ``pane_dead`` impede que um pane retido por ``remain-on-exit`` conte como
    processo vivo. ``pane_current_command`` distingue o shell inicial
    (``pane_pid``) do processo em foreground, que é o sinal útil aqui.
    """
    pane_format = "#{session_name}\t#{pane_dead}\t#{pane_current_command}"
    result = server.cmd("list-panes", "-a", f"-F{pane_format}")
    if result.returncode == 0:
        sessions: set[str] = set()
        claude_process_sessions: set[str] = set()
        for line in result.stdout:
            try:
                session_name, pane_dead, current_command = line.split("\t", 2)
            except ValueError as exc:
                raise libtmux_exc.LibTmuxException(
                    f"formato inesperado de list-panes: {line!r}"
                ) from exc
            if not session_name:
                continue
            sessions.add(session_name)
            if pane_dead == "0" and current_command in _CLAUDE_PANE_COMMANDS:
                claude_process_sessions.add(session_name)
        return TmuxSessionInventory(sessions, claude_process_sessions)

    error = "\n".join(result.stderr).strip()
    # Ausência do próprio servidor/socket confirma que não há sessões nele.
    if "no server running" in error.lower() or "no such file or directory" in error.lower():
        return TmuxSessionInventory(set(), set())
    raise libtmux_exc.LibTmuxException(error or "falha ao listar sessões tmux")


def _list_session_inventory_sync() -> TmuxSessionInventory:
    """Inventaria sessões e CLIs dos sockets sem consulta por agente.

    Na Hostinger, lê somente o server default. Na Oracle, descobre de uma vez
    os sockets ``borges-*`` no diretório tmux e lê cada server encontrado; o
    default também entra porque hospeda subsessões criadas pelo cockpit.

    Erro de observação é propagado: falha de permissão/comando não pode virar
    conjunto vazio e marcar falsamente toda a frota como offline. Socket ou
    server comprovadamente ausente equivale corretamente a zero sessões.
    """
    sessions: set[str] = set()
    claude_process_sessions: set[str] = set()
    named_socket_names = _configured_named_socket_names()
    for socket_name in named_socket_names:
        server = libtmux.Server(socket_name=socket_name)
        inventory = _session_inventory_from_server(server)
        sessions.update(inventory.sessions)
        claude_process_sessions.update(inventory.claude_process_sessions)

    inventory = _session_inventory_from_server(libtmux.Server())
    sessions.update(inventory.sessions)
    claude_process_sessions.update(inventory.claude_process_sessions)
    return TmuxSessionInventory(sessions, claude_process_sessions)


async def list_session_inventory() -> TmuxSessionInventory:
    """Retorna presença de sessões e CLIs sem bloquear o event loop."""
    return await asyncio.to_thread(_list_session_inventory_sync)


def _list_session_names_sync() -> set[str]:
    """Compatibilidade: retorna somente os nomes do inventário completo."""
    return _list_session_inventory_sync().sessions


async def list_session_names() -> set[str]:
    """Compatibilidade: retorna somente as sessões tmux existentes."""
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
# Retomar conversa NÃO é bootstrap. Subir uma TUI vazia leva segundos; subir
# `--resume` de uma conversa real leva o tempo de ler o JSONL inteiro e
# redesenhar a tela — o do Daniel tem 11 MB. Com os 15 s do bootstrap, o
# `restart_claude_with_resume` matava o pane, subia o processo certo e mesmo
# assim devolvia `confirmed=False` porque a âncora ainda não tinha aparecido;
# a UI dizia "não voltou de pé", o Rica clicava de novo e o segundo clique
# matava a retomada do primeiro. O teste que liberou o botão rodou no canário,
# de conversa curta, e por isso passou. Sessão real precisa de outra régua.
_RESUME_TIMEOUT_S = 90.0
# 0,25 s × 90 s = 360 rodadas de `capture-pane`+`refresh` competindo com a TUI
# justamente enquanto ela carrega. Espaçar não atrasa o recibo de forma
# perceptível e devolve CPU pra quem está desenhando a tela.
_RESUME_POLL_INTERVAL_S = 0.75
_RELAUNCH_PROCESS_EXIT_TIMEOUT_S = 5.0
_PANE_EXCERPT_TIMEOUT_S = 0.5
_PANE_EXCERPT_LINES = 12
_PANE_EXCERPT_MAX_CHARS = 1200
_REPOS_ROOT = Path("/home/clawd/repos").resolve()
_UNSAFE_WORKSPACE_CHARS = re.compile(r"[;&|\n\r\0]")
_MODEL_PATTERN = re.compile(r"[a-z0-9.\-]{1,80}")
#: Valor de `--channels`: `plugin:<nome>@<origem>`. Estreito de propósito — o
#: valor vem do `/proc/<pid>/cmdline` e vai parar num comando de shell.
_CHANNEL_VALUE_PATTERN = re.compile(r"[A-Za-z0-9_.:@\-]{1,120}")
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

#: Cerca de memória por sessão, espelhando `ze-shared/scripts/subir-frota.sh`.
#: O slice é o teto do conjunto (`MemoryHigh=5G`/`MemoryMax=6G`); sem teto por
#: sessão, uma só consome tudo e estrangula as outras. `MemoryHigh` é throttle,
#: não kill — de propósito: `MemoryMax` faria o OOM killer escolher o maior
#: processo do cgroup, que numa sessão com contexto grande é o próprio `claude`.
#:
#: Sem este prefixo a sessão relançada pelo painel nascia em `app.slice`, fora da
#: cerca, e ficava assim até o próximo boot da VPS — foi o que deixou o `pavan`
#: sem freio nenhum em 07/08/2026 e trocou throttle por OOM kill no meio de um
#: fan-out. O boot da frota sempre embrulhou; o relaunch, não.
_MEMORY_FENCE_SLICE = "borges-frota.slice"
_MEMORY_HIGH_DEFAULT = "1500M"
#: O pavan orquestra — faz fan-out de subagente, e subagente dele abre neto.
#: Pior pico medido nos de execução: 701 MiB; num fan-out de 5 dele: 2410 MiB.
_MEMORY_HIGH_POR_SESSAO = {"pavan": "3G"}


def _memory_fence_prefix(session_name: str) -> str:
    """Embrulho que prende o processo (e tudo que ele spawna) na cerca.

    `session_name` só indexa um dicionário de literais — nada dele entra na
    string do shell, então não há superfície de injeção aqui.
    """
    memory_high = _MEMORY_HIGH_POR_SESSAO.get(session_name, _MEMORY_HIGH_DEFAULT)
    return (
        f"systemd-run --user --scope --slice={_MEMORY_FENCE_SLICE} "
        f"-p MemoryHigh={memory_high} -- "
    )


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
        session_name,
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
    session_name: str,
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
    return resolved_workspace, _memory_fence_prefix(session_name) + command


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


#: Flags que ligam os canais de mensagem do Claude Code. Cada uma recebe um
#: valor no argumento seguinte.
_CHANNEL_FLAGS = ("--channels", "--dangerously-load-development-channels")

#: Canal que TODO agente da frota sobe no boot — `ze-shared/scripts/subir-frota.sh`
#: usa este literal nas duas linhas de lançamento (Claude e Kimi). Serve de piso
#: quando o processo vivo não tem nada pra copiar; sem ele, mudez vira estado
#: absorvente (ver `_pane_channel_flags`).
_CANAL_PADRAO = "--channels plugin:telegram@claude-plugins-official"


def _pane_channel_flags(pane_pid: int) -> str:
    """Lê do processo vivo as flags de canal, pra o relaunch não emudecer o agente.

    `_CLI_COMMANDS` monta o comando do zero e não conhece canal nenhum. Sem
    isto, relançar deixava o agente SURDO no Telegram: o outbound continuava
    funcionando (o plugin responde de dentro do turno), mas o poller de
    entrada nunca subia — mensagem do Rica sumia sem deixar rastro, e o
    `getWebhookInfo` mostrava `pending=0` porque ninguém estava buscando.
    Foi o que aconteceu com o Daniel em 02/08: dois cliques no botão de
    relançar e ele parou de receber áudio, sem nenhum sinal na tela.

    Ler do processo em vez de fixar no `agents.yaml` é de propósito — o Pavan
    carrega um canal de desenvolvimento a mais, e o que precisa voltar de pé
    é exatamente o que estava rodando, não o que a config imagina.
    """
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
            raw = Path(f"/proc/{candidate_pid}/cmdline").read_bytes()
        except OSError:
            continue
        argv = [arg for arg in raw.decode(errors="replace").split("\0") if arg]
        if not any("claude" in arg for arg in argv):
            continue
        recovered: list[str] = []
        for index, arg in enumerate(argv):
            if arg not in _CHANNEL_FLAGS or index + 1 >= len(argv):
                continue
            value = argv[index + 1]
            # O valor é um identificador de plugin (`plugin:telegram@...`), não
            # caminho nem texto livre. Recusar o resto fecha a porta pra um
            # cmdline adulterado virar comando no shell do relaunch.
            if not _CHANNEL_VALUE_PATTERN.fullmatch(value):
                continue
            recovered.append(f"{arg} {shlex.quote(value)}")
        if recovered:
            return " " + " ".join(recovered)
    # Nada pra copiar — processo já estava mudo, ou o `/proc` não abriu. Devolver
    # vazio aqui fazia o relaunch nascer mudo e a próxima leitura achar o mesmo
    # vazio: quem caía nunca voltava sozinho, e relançar (o conserto) virava o
    # que mantinha a falta. O piso canônico quebra o ciclo. Continua valendo a
    # regra do docstring — o processo vivo manda; isto é último recurso, e por
    # isso não conhece canal de desenvolvimento, só o que os 7 sobem no boot.
    return " " + _CANAL_PADRAO


#: Env vars do processo antigo que precisam sobreviver ao relaunch. Diferente
#: de `_CHANNEL_FLAGS` (argumento de CLI, não env var — continua lido do
#: `cmdline`), estas viajam pelo mecanismo nativo do tmux (`set-environment`/
#: `show-environment`, testado empiricamente: tmux 3.4 injeta a env da sessão
#: em qualquer window nova) em vez de virarem prefixo `VAR=valor` costurado
#: na string do comando — um lugar só pra crescer a lista, sem função nova
#: por variável nem `shlex.quote` acumulando por cada entrada.
#:
#: As 7 `ANTHROPIC_*` são o roteamento inteiro do Hiro pro Kimi (sem elas o
#: `claude` relançado bate na API da Anthropic de verdade, não no `k3`).
#: Agente sem essas vars simplesmente não as tem no `/proc/<pid>/environ` —
#: `_pane_environment_snapshot` não força vazio, e o loop chamador faz
#: `unset_environment` (no-op se a sessão nunca teve a var).
_PRESERVED_ENV_VARS = (
    "PATH",
    "TELEGRAM_STATE_DIR",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
)


def _pane_environment_snapshot(
    pane_pid: int, names: tuple[str, ...]
) -> dict[str, str]:
    """Lê do `/proc/<pid>/environ` do processo foreground os `names` pedidos.

    Uma passada só resolve todas as vars de uma vez — mesma lógica de
    candidatos (pane vs. grupo foreground) que `_pane_channel_flags` usa pra
    args de CLI, aqui aplicada a env vars. Nome ausente no processo antigo
    simplesmente não entra no dict (sem forçar vazio) — quem chama decide se
    isso vira `unset` ou um default.
    """
    candidate_pids = [pane_pid]
    try:
        stat = Path(f"/proc/{pane_pid}/stat").read_text()
        fields = stat[stat.rfind(")") + 2 :].split()
        foreground_group = int(fields[5])
        if foreground_group > 0:
            candidate_pids.insert(0, foreground_group)
    except (IndexError, OSError, ValueError):
        pass

    prefixes = {name: f"{name}=".encode() for name in names}
    found: dict[str, str] = {}
    for candidate_pid in candidate_pids:
        if len(found) == len(names):
            break
        try:
            environment = Path(f"/proc/{candidate_pid}/environ").read_bytes()
        except OSError:
            continue
        for item in environment.split(b"\0"):
            for name, prefix in prefixes.items():
                if name in found or not item.startswith(prefix):
                    continue
                value = item.removeprefix(prefix).decode(errors="replace")
                if value:
                    found[name] = value
    return found


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


def _force_kill_processes(process_ids: set[int]) -> None:
    """Escala pra SIGKILL o que sobreviveu ao SIGHUP do `kill-window`.

    `kill-window` já pediu a saída; se o processo continuar de pé depois do
    timeout de `_wait_for_processes_exit`, é um cleanup handler lento — não
    motivo pra deixar a window nova sem `send-keys` pra sempre. Não resolve
    processo em D-state (SIGKILL não interrompe I/O bloqueado), mas esse caso
    já é diagnosticado à parte, não pelo relaunch.
    """
    for process_id in process_ids:
        try:
            os.kill(process_id, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass


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
    timeout_s: float = _RESUME_TIMEOUT_S,
    poll_interval_s: float = _RESUME_POLL_INTERVAL_S,
) -> dict[str, bool]:
    """Confirma banner, caixa de input e conteúdo da conversa retomada."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            lines = pane.capture_pane(escape_sequences=False, join_wrapped=True)
            output = _normalize_visible_text("\n".join(lines))
            snapshot = _capture_input_snapshot(pane)
            pane.refresh()
        except (libtmux_exc.LibTmuxException, AttributeError, IndexError):
            time.sleep(poll_interval_s)
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
        time.sleep(poll_interval_s)
    return {"attempted": True, "confirmed": False}


async def bootstrap_cli_in_session(
    session: str, workspace_path: str, cli: AgentCli, model: str
) -> dict[str, bool]:
    """Booteia Claude Code/Codex no pane ativo e confirma readiness por banner."""
    return await asyncio.to_thread(
        _bootstrap_cli_in_session_sync, session, workspace_path, cli, model
    )


def _swap_window_and_launch(
    server: libtmux.Server,
    session_name: str,
    session: libtmux.Session,
    old_pane: libtmux.Pane,
    resolved_workspace: Path,
    launch_command: str,
) -> libtmux.Pane | None:
    """Mecânica de troca de window compartilhada entre resume e boot limpo.

    Preserva env/canais do processo antigo, cria a window nova, mata a antiga
    (escalando pra SIGKILL se o processo resistir ao timeout — bug 7d1efe86) e
    manda o `launch_command`. `None` cobre qualquer falha anterior ao envio do
    comando — todas viram o mesmo `{"attempted": False, "confirmed": False}"`
    em quem chama, então não há necessidade de distinguir o motivo aqui.
    """
    old_window_id = old_pane.window.window_id
    old_process_ids = _pane_owner_pids(int(old_pane.pane_pid))
    # Lido ANTES do kill: depois que o processo morre o `/proc` some junto,
    # e com ele a única prova de quais canais/env o agente tinha ligado.
    channel_flags = _pane_channel_flags(int(old_pane.pane_pid))
    env_snapshot = _pane_environment_snapshot(
        int(old_pane.pane_pid), _PRESERVED_ENV_VARS
    )
    env_snapshot.setdefault(
        "PATH", os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")
    )
    # Sessão (não window) é o escopo nativo do tmux pra env: o tmux aplica
    # sozinho na window nova criada a seguir, sem passar pelo shell —
    # dispensa `shlex.quote` por variável e cresce só adicionando nome em
    # `_PRESERVED_ENV_VARS`, sem função nova.
    for name in _PRESERVED_ENV_VARS:
        value = env_snapshot.get(name)
        if value is not None:
            session.set_environment(name, value)
        else:
            session.unset_environment(name)
    full_launch_command = (
        f"{launch_command}{channel_flags}; "
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
        return None
    try:
        replacement_window_id, _ = created.stdout[0].split("\t", 1)
    except ValueError:
        return None

    killed = server.cmd("kill-window", "-t", old_window_id)
    if killed.returncode != 0:
        _remove_replacement_if_old_window_survives(
            server,
            session_name,
            old_window_id,
            replacement_window_id,
        )
        return None
    if not _wait_for_processes_exit(old_process_ids):
        # Timeout: o antigo já foi morto pelo `kill-window` (SIGHUP), só
        # não confirmou saída em 5s. Escalar pra SIGKILL em vez de
        # devolver aqui — do contrário a window nova fica com um shell
        # vazio pra sempre, sem ninguém mandar o `send-keys` que abre o
        # Claude (bug 7d1efe86).
        log.warning(
            "relaunch: processo antigo não saiu em %ss, escalando pra "
            "SIGKILL: session=%s pids=%s",
            _RELAUNCH_PROCESS_EXIT_TIMEOUT_S,
            session_name,
            old_process_ids,
        )
        _force_kill_processes(old_process_ids)
        _wait_for_processes_exit(old_process_ids)

    session = server.sessions.get(session_name=session_name)
    replacement_pane = session.windows.get(
        window_id=replacement_window_id
    ).active_pane
    replacement_pane.send_keys(full_launch_command, enter=False)
    replacement_pane.enter()
    return replacement_pane


def _restart_claude_with_resume_sync(
    session_name: str,
    workspace_path: str,
    model: str,
    resume_session_id: str,
) -> dict[str, bool]:
    """Troca a window do agente sem deixar a sessão tmux ficar sem window."""
    resolved_workspace, resume_command = _prepare_cli_launch(
        session_name,
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

        replacement_pane = _swap_window_and_launch(
            server, session_name, session, old_pane, resolved_workspace, resume_command,
        )
        if replacement_pane is None:
            return {"attempted": False, "confirmed": False}
        return _wait_for_resumed_claude_tui(replacement_pane, anchors)
    finally:
        lock.release()


def _restart_claude_fresh_sync(
    session_name: str,
    workspace_path: str,
    model: str,
) -> dict[str, bool]:
    """Troca a window do agente com boot limpo — sem `--resume`, sem checar
    conversa antiga. Aqui perder o contexto é o ponto, não um risco a evitar,
    então não há JSONL/âncora pra validar antes de agir."""
    resolved_workspace, fresh_command = _prepare_cli_launch(
        session_name, workspace_path, "claude_code", model,
    )

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

        replacement_pane = _swap_window_and_launch(
            server, session_name, session, old_pane, resolved_workspace, fresh_command,
        )
        if replacement_pane is None:
            return {"attempted": False, "confirmed": False}
        return _wait_for_cli_banner(replacement_pane, "claude_code")
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


async def restart_claude_fresh(
    session_name: str,
    workspace_path: str,
    model: str,
) -> dict[str, bool]:
    """Relança sem `--resume` — reseta o pane de propósito, perde o contexto."""
    return await _run_tmux_operation(
        _restart_claude_fresh_sync,
        session_name,
        workspace_path,
        model,
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
        #
        # -r é o cinto do -p: `-p` é CONDICIONAL — o tmux só emite os marcadores
        # de bracketed paste se o modo 2004 estiver ligado no pane NAQUELE
        # instante, e sem eles ele converte cada \n em \r, que num CLI
        # interativo é Enter. Um envelope de 30 linhas viraria 30 mensagens.
        #
        # Matriz medida no CC real (v2.1.226), duas linhas de payload:
        #   -p sem -r, CC ocioso ................ duas linhas no input, íntegro
        #   -p com -r, CC ocioso ................ idêntico, byte a byte
        #   sem -p sem -r (o degradado de hoje) . PARTIDO: cada linha submetida
        #                                         sozinha, duas mensagens
        #   sem -p com -r (degradado + conserto)  íntegro no input, sem submeter
        # No último caso o `send-keys Enter` que vem depois submete tudo de uma
        # vez — o -r conserta, não só adia. Estritamente melhor nos quatro.
        args = ["paste-buffer"]
        if delete_after:
            args.append("-d")
        result = pane.cmd(*args, "-p", "-r", "-b", buf_name)
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


def _send_message_sync(session_name: str, text: str) -> DeliveryResult:
    server = _server_for(session_name)
    if not server.has_session(session_name):
        return _record_delivery_refusal(session_name, "sessao_ausente")

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
            return _record_delivery_refusal(session_name, "pane_incompativel")

        try:
            # load-buffer não toca o pane e pode levar até 5s. Faça-o antes de
            # provar vazio para não abrir uma janela de concatenação humana.
            buf_name = _load_tmux_buffer(server, sanitized)
            if buf_name is None:
                return _record_delivery_refusal(session_name, "buffer_indisponivel")

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
                    final_snapshot = _capture_input_snapshot(pane)
                    reason = (
                        "input_ocupado_ou_travado"
                        if final_snapshot.state == "armed"
                        else "input_nao_observavel"
                    )
                    log.warning(
                        "tmux input indisponível ou armado antes do paste: session=%s",
                        session_name,
                    )
                    return _record_delivery_refusal(session_name, reason)

                prior_prompt_count = _count_payload_prompt_lines(pane, sanitized)
                # Segunda leitura imediatamente antes do paste fecha a corrida
                # entre a observação anterior e uma digitação humana.
                latest_snapshot = _capture_input_snapshot(pane)
                if latest_snapshot.state != "empty":
                    log.warning("tmux input mudou antes do paste: session=%s", session_name)
                    reason = (
                        "input_ocupado_ou_travado"
                        if latest_snapshot.state == "armed"
                        else "input_nao_observavel"
                    )
                    return _record_delivery_refusal(session_name, reason)
                if not _paste_loaded_buffer(pane, buf_name):
                    return _record_delivery_refusal(session_name, "paste_falhou")
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
                    return _record_delivery_refusal(session_name, "paste_nao_confirmado")

                submit_deadline = time.monotonic() + _SUBMIT_CONFIRM_TIMEOUT_S
                confirmed, enter_attempts = _confirm_armed_submission(
                    pane,
                    sanitized,
                    prior_prompt_count=prior_prompt_count,
                    deadline=submit_deadline,
                    max_enter_attempts=_SUBMIT_MAX_ENTER_ATTEMPTS,
                )
                if confirmed:
                    return _record_delivery_success(session_name)

                # Só limpa quando a pane ainda prova que o texto é o nosso.
                final_snapshot = _capture_input_snapshot(pane)
                if _snapshot_proves_owned_payload(final_snapshot, sanitized):
                    _send_key(pane, "C-u")
                log.warning(
                    "tmux Enter sem confirmação: session=%s attempts=%d",
                    session_name,
                    enter_attempts,
                )
                return _record_delivery_refusal(session_name, "envio_nao_confirmado")
            finally:
                # paste-buffer -d descarta no caminho feliz. Em falha anterior
                # ao paste, o buffer ainda existe e precisa de cleanup.
                if not paste_ok:
                    _delete_tmux_buffer(server, buf_name)
        except libtmux_exc.LibTmuxException:
            return _record_delivery_refusal(session_name, "erro_tmux")
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
            # Degrau 1: fecha modal, se houver. Até 3x de propósito — no
            # terminal, um Escape sozinho na maioria esmagadora não resolve
            # nada (overlay em camada, menu de autocomplete). Mas o estado é
            # checado ENTRE cada tecla, e o loop para assim que confirmar
            # "empty": dois Escapes seguidos com o prompt JÁ vazio é o atalho
            # nativo do próprio Claude Code pra abrir o menu de rewind
            # (Esc+Esc, documentado em code.claude.com/docs/en/interactive-mode)
            # — trocaria um destravamento inofensivo por uma tela de navegação
            # que este endpoint não reconhece nem sabe fechar (não bate no
            # formato de caixa de input que `_capture_input_snapshot` espera).
            snapshot = _capture_input_snapshot(pane)
            for _ in range(3):
                if snapshot.state == "empty":
                    break
                if not _send_key(pane, "Escape"):
                    return {"tmux_delivered": False, "degrau": 5, "acao": "escape_falhou"}
                read_deadline = time.monotonic() + _PRE_PASTE_CONFIRM_TIMEOUT_S
                observed = _wait_for_input(
                    pane,
                    lambda candidate: candidate.state != "unknown",
                    read_deadline,
                )
                if observed is None:
                    return {
                        "tmux_delivered": False,
                        "degrau": 5,
                        "acao": "input_nao_observavel",
                    }
                snapshot = observed
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


async def send_message(session_name: str, text: str) -> DeliveryResult:
    """Cola `text` no pane ativo via tmux paste-buffer e submete com Enter.

    Sequência observável:
        confirma input vazio → paste-buffer -d -p -r → confirma payload armado →
        Enter (até 3 tentativas enquanto o mesmo payload permanece armado) →
        confirma input vazio ou nova linha transcrita.

    Preserva multilinha (envelope do Cockpit tem 30+ linhas); só sanitiza CR
    isolados. Buffer nomeado por uuid evita race entre dispatches concorrentes.
    `-p` ativa bracketed paste — CC consolida o bloco em mensagem única em vez
    de submeter linha-a-linha; `-r` garante que o \\n continue \\n mesmo quando
    o `-p` não tem efeito (ver `_paste_loaded_buffer`).

    ``unknown`` é transitório até os tetos independentes de pré-paste (8s) e
    submissão (6s). ``delivered`` só com prova observável. C-u só limpa um
    payload ainda reconhecido como o nosso; texto humano diferente nunca é
    apagado nem substituído.

    O retorno distingue os três desfechos (ver ``DeliveryResult``): quem quiser
    reenviar sozinho precisa checar ``safe_to_resend``, não só ``delivered`` —
    reenviar um desfecho incerto duplica a mensagem no agente.
    """
    return await _run_tmux_operation(_send_message_sync, session_name, text)
