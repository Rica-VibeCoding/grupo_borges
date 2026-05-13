"""Success Criteria — parser + executor async.

Spec do plano v5 §3.5: tasks em `review_mode=agent_autonomous` precisam de um
bloco `## Success Criteria` no envelope (body) com comandos machine-checkable.

Formato esperado no body (markdown + yaml-like):

    ## Success Criteria
    - cmd: corepack pnpm --filter=@fluyt/com type-check
      expect: exit=0
    - cmd: corepack pnpm --filter=@fluyt/com build
      expect: exit=0
      timeout: 900

Regras:
- `cmd` é executado via shell em `<workspace_path>` (cd implícito).
- `expect`: `exit=<N>` (default `exit=0`).
- `timeout`: segundos, default 600.

Resultado: cada comando vira um event `task_events`:
- `review.criteria_passed` quando exit bate com expect (no fim, se todos passarem).
- `review.criteria_failed` no primeiro que falhar (curto-circuita).

Se todos passarem, task vai pra `done`. Se algum falhar, task volta pra `running`.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from db.store import GrupoBorgesDB

log = logging.getLogger(__name__)

_HEADING_RE = re.compile(r"^##\s+Success\s+Criteria\s*$", re.MULTILINE | re.IGNORECASE)
_NEXT_HEADING_RE = re.compile(r"^##\s+", re.MULTILINE)
_ENTRY_START_RE = re.compile(r"^\s*-\s+cmd:\s*(.*?)\s*$", re.MULTILINE)
_FIELD_RE = re.compile(r"^\s{2,}(\w+):\s*(.+?)\s*$")
_EXPECT_EXIT_RE = re.compile(r"^exit=(-?\d+)$", re.IGNORECASE)

DEFAULT_TIMEOUT_S = 600
HARD_MAX_TIMEOUT_S = 1800


@dataclass
class Criterion:
    cmd: str
    expect_exit: int = 0
    timeout_s: int = DEFAULT_TIMEOUT_S


def parse_success_criteria(body: str | None) -> list[Criterion]:
    """Extrai lista de comandos do bloco `## Success Criteria` do envelope.

    Retorna `[]` se o bloco não existir ou estiver vazio. Levanta `ValueError`
    em formato malformado (entrada com `cmd:` mas sem comando, expect/timeout
    inválidos).
    """
    if not body:
        return []
    m = _HEADING_RE.search(body)
    if not m:
        return []
    block_start = m.end()
    rest = body[block_start:]
    next_h = _NEXT_HEADING_RE.search(rest)
    block = rest[: next_h.start()] if next_h else rest

    criteria: list[Criterion] = []
    lines = block.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        em = _ENTRY_START_RE.match(line)
        if not em:
            i += 1
            continue
        cmd = em.group(1).strip()
        if not cmd:
            raise ValueError(f"Success Criteria: cmd vazio na linha {i + 1}")
        item = Criterion(cmd=cmd)
        i += 1
        # Lê campos indentados subsequentes até próxima entrada ou fim.
        while i < len(lines):
            sub = lines[i]
            if _ENTRY_START_RE.match(sub):
                break
            fm = _FIELD_RE.match(sub)
            if fm:
                key = fm.group(1).lower()
                val = fm.group(2).strip()
                if key == "expect":
                    em2 = _EXPECT_EXIT_RE.match(val)
                    if not em2:
                        raise ValueError(
                            f"Success Criteria: expect inválido {val!r} (use exit=<N>)"
                        )
                    item.expect_exit = int(em2.group(1))
                elif key == "timeout":
                    try:
                        n = int(val)
                    except ValueError as e:
                        raise ValueError(
                            f"Success Criteria: timeout inválido {val!r}"
                        ) from e
                    if n <= 0 or n > HARD_MAX_TIMEOUT_S:
                        raise ValueError(
                            f"Success Criteria: timeout {n}s fora do range "
                            f"(1..{HARD_MAX_TIMEOUT_S})"
                        )
                    item.timeout_s = n
            i += 1
        criteria.append(item)
    return criteria


async def _run_one(criterion: Criterion, workspace: str) -> dict[str, Any]:
    """Executa um critério. Retorna dict com `exit`, `passed`, `duration_s`, `stderr_tail`."""
    started = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_shell(
            criterion.cmd,
            cwd=workspace,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except (OSError, ValueError) as e:
        return {
            "cmd": criterion.cmd,
            "exit": -1,
            "passed": False,
            "duration_s": 0.0,
            "stderr_tail": f"spawn failed: {e}",
            "timed_out": False,
        }
    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(), timeout=criterion.timeout_s
        )
        timed_out = False
    except asyncio.TimeoutError:
        proc.kill()
        try:
            stdout_bytes, stderr_bytes = await proc.communicate()
        except Exception:
            stdout_bytes, stderr_bytes = b"", b""
        timed_out = True
    elapsed = round(time.monotonic() - started, 2)
    exit_code = proc.returncode if proc.returncode is not None else -1
    stderr_tail = (stderr_bytes or b"").decode("utf-8", errors="replace")[-800:]
    passed = (not timed_out) and (exit_code == criterion.expect_exit)
    return {
        "cmd": criterion.cmd,
        "exit": exit_code,
        "expect_exit": criterion.expect_exit,
        "passed": passed,
        "timed_out": timed_out,
        "duration_s": elapsed,
        "stderr_tail": stderr_tail,
        "timeout_s": criterion.timeout_s,
    }


async def run_success_criteria(
    *,
    task_id: str,
    assignee_slug: str,
    criteria: list[Criterion],
    workspace: str,
    db: GrupoBorgesDB,
    reviewer: str,
    event_id_origin: int | None,
) -> dict[str, Any]:
    """Roda todos os critérios sequencialmente. Curto-circuita em falha.

    Retorna `{passed: bool, results: list[dict], reason: str | None}` e emite:
    - `review.criteria_passed` quando todos passam (move task pra `done`)
    - `review.criteria_failed` na primeira falha (volta task pra `running`)
    """
    results: list[dict[str, Any]] = []
    summary: dict[str, Any] = {"passed": True, "results": results, "reason": None}
    for crit in criteria:
        result = await _run_one(crit, workspace)
        results.append(result)
        if not result["passed"]:
            summary["passed"] = False
            summary["reason"] = (
                f"timeout em {crit.cmd!r}"
                if result.get("timed_out")
                else f"exit={result['exit']} (esperado {crit.expect_exit}) em {crit.cmd!r}"
            )
            break

    final_kind = "review.criteria_passed" if summary["passed"] else "review.criteria_failed"
    payload = {
        "reviewer": reviewer,
        "criteria_results": results,
        "origin_event_id": event_id_origin,
        "reason": summary["reason"],
    }
    await db.insert_task_event(
        final_kind,
        task_id=task_id,
        agent_slug=None,
        payload=payload,
    )

    new_status = "done" if summary["passed"] else "running"
    try:
        await db.update_task(task_id, {"status": new_status})
    except Exception:
        log.exception("criteria_executor: falha ao mudar status da task %s", task_id)

    return summary
