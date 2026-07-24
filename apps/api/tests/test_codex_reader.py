"""TK-25 — testes do leitor read-only do Codex (Tara).

Cobre:
- parser de rollout JSONL com fixture sanitizada (classificação + redação);
- garantia dura de que nenhum segredo (system/dev/reasoning/tool/base_instructions)
  vaza pro objeto retornado;
- `find_latest_thread` filtrando por cwd, ignorando arquivadas e pegando a mais
  recente, sobre um SQLite temporário com o schema relevante de `threads`.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import codex_reader as cr

FIXTURE = Path(__file__).parent / "fixtures" / "codex_rollout_sanitized.jsonl"

# Qualquer um destes no texto exposto é vazamento de conteúdo sensível.
SECRET_MARKERS = (
    "SEGREDO-SISTEMA",
    "SEGREDO-DEV",
    "SEGREDO-AGENTS",
    "SEGREDO-REASONING",
    "SEGREDO-OUTPUT",
    "base_instructions",
    "<permissions",
    "<INSTRUCTIONS>",
)


def test_parse_rollout_visible_messages_only_real_conversation() -> None:
    msgs = cr.parse_rollout(FIXTURE, thread_id="t1")
    visible = [m for m in msgs if m.visible]
    # Conversa real + function_call sanitizado para alimentar "rodando: <cmd>".
    assert [m.role for m in visible] == ["user", "internal", "assistant", "user"]
    assert visible[0].text == "tara, voce esta no cockpit?"
    assert visible[1].item_type == "function_call"
    assert visible[1].text == "ls /caminho/sensivel"
    assert visible[2].role == "assistant"
    assert "diretorio da Tara" in visible[2].text
    assert visible[3].text == "beleza, segue"


def test_parse_rollout_hides_injected_context_and_internals() -> None:
    msgs = cr.parse_rollout(FIXTURE, thread_id="t1")
    internal = [m for m in msgs if not m.visible]
    item_types = {m.item_type for m in internal}
    # developer + AGENTS.md(user) viram message/internal; reasoning + tool output também.
    assert "reasoning" in item_types
    assert "function_call_output" in item_types
    # Todo item interno sai SEM texto.
    assert all(m.text == "" for m in internal)


def test_parse_rollout_never_leaks_secrets() -> None:
    msgs = cr.parse_rollout(FIXTURE, thread_id="t1")
    blob = "\n".join(m.text for m in msgs)
    for marker in SECRET_MARKERS:
        assert marker not in blob, f"vazou conteúdo sensível: {marker!r}"


def test_parse_rollout_tolerates_corrupt_lines() -> None:
    # A fixture tem 1 linha sem `type` válido e 1 linha de JSON quebrado.
    # O parser não pode lançar e ainda deve render as 5 mensagens (3 vis + 2 inj/dev)
    # + reasoning + 2 tool = total previsível.
    msgs = cr.parse_rollout(FIXTURE, thread_id="t1")
    assert len(msgs) == 8  # 5 message + reasoning + function_call + function_call_output


def test_parse_rollout_strips_audio_skill_prefix(tmp_path: Path) -> None:
    rollout = tmp_path / "audio.jsonl"
    rollout.write_text(
        """
{"type":"response_item","timestamp":"2026-07-19T20:00:00Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Use $audio-telegram-resumo nesta sessão. A entrada veio por áudio do Rica; responda em áudios curtos por etapa até a demanda encerrar.\\n\\nMensagem transcrita do áudio do Rica:\\nTeste de áudio agora."}]}}
        """.strip(),
        encoding="utf-8",
    )

    msgs = cr.parse_rollout(rollout, thread_id="audio")

    assert len(msgs) == 1
    assert msgs[0].role == "user"
    assert msgs[0].text == "Teste de áudio agora."


def test_classify_message_rules() -> None:
    assert cr.classify_message("assistant", "oi") == ("assistant", True)
    assert cr.classify_message("user", "pergunta normal") == ("user", True)
    assert cr.classify_message("user", "# AGENTS.md instructions\n...") == ("internal", False)
    assert cr.classify_message("developer", "qualquer coisa") == ("internal", False)
    assert cr.classify_message("system", "x") == ("internal", False)


def test_parse_rollout_missing_file_returns_empty() -> None:
    assert cr.parse_rollout("/nao/existe/rollout.jsonl") == []


def _make_threads_db(tmp_path: Path) -> Path:
    db = tmp_path / "state.sqlite"
    conn = sqlite3.connect(db)
    conn.execute(
        """
        CREATE TABLE threads (
            id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL,
            title TEXT NOT NULL, model TEXT, reasoning_effort TEXT,
            tokens_used INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT 0, updated_at_ms INTEGER, created_at_ms INTEGER
        )
        """
    )
    rows = [
        # (id, rollout, cwd, title, model, effort, tokens, archived, upd, upd_ms, created_ms)
        ("old", "/r/old.jsonl", cr.TARA_CWD, "antiga", "gpt-5.5", None, 10, 0, 1, 1000, 500),
        ("new", "/r/new.jsonl", cr.TARA_CWD, "atual", "gpt-5.5", None, 99, 0, 2, 2000, 1500),
        ("arch", "/r/arch.jsonl", cr.TARA_CWD, "arquivada", "gpt-5.5", None, 0, 1, 3, 3000, 2500),
        ("other", "/r/other.jsonl", "/outro/cwd", "outro", "gpt-5.5", None, 5, 0, 4, 4000, 3500),
    ]
    conn.executemany(
        "INSERT INTO threads VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows
    )
    conn.commit()
    conn.close()
    return db


def test_find_latest_thread_filters_cwd_archived_and_recency(tmp_path: Path) -> None:
    db = _make_threads_db(tmp_path)
    thread = cr.find_latest_thread(cr.TARA_CWD, db, telecodex_context_path=None)
    assert thread is not None
    # Pega a mais recente NÃO arquivada do cwd da Tara — "new", não "arch"/"other".
    assert thread.thread_id == "new"
    assert thread.tokens_used == 99
    assert thread.source == "codex-local"


def test_find_latest_thread_prefers_telecodex_context(tmp_path: Path) -> None:
    db = _make_threads_db(tmp_path)
    contexts = tmp_path / "contexts.json"
    contexts.write_text(
        """
        [
          {
            "contextKey": "7262275215",
            "threadId": "old",
            "workspace": "/home/clawd/repos/ze_claude/tara",
            "updatedAt": 1784492021977
          }
        ]
        """,
        encoding="utf-8",
    )

    thread = cr.find_latest_thread(cr.TARA_CWD, db, telecodex_context_path=contexts)

    assert thread is not None
    assert thread.thread_id == "old"
    assert thread.tokens_used == 10


def test_find_latest_thread_falls_back_when_telecodex_context_is_stale(tmp_path: Path) -> None:
    db = _make_threads_db(tmp_path)
    contexts = tmp_path / "contexts.json"
    contexts.write_text(
        """
        [
          {
            "contextKey": "7262275215",
            "threadId": "missing",
            "workspace": "/home/clawd/repos/ze_claude/tara",
            "updatedAt": 1784492021977
          },
          {
            "contextKey": "outro",
            "threadId": "other",
            "workspace": "/outro/cwd",
            "updatedAt": 1784492021999
          }
        ]
        """,
        encoding="utf-8",
    )

    thread = cr.find_latest_thread(cr.TARA_CWD, db, telecodex_context_path=contexts)

    assert thread is not None
    assert thread.thread_id == "new"


def test_find_latest_thread_missing_db_returns_none(tmp_path: Path) -> None:
    assert cr.find_latest_thread(cr.TARA_CWD, tmp_path / "nope.sqlite") is None
