import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from db.store import GrupoBorgesDB
from orchestrator.jsonl_watcher import JsonlWatcher, encoded_cwd
from services.claude_runtime import ClaudeRuntime

SID = "11111111-1111-4111-8111-111111111111"
OLD = "22222222-2222-4222-8222-222222222222"


def line(uuid, sid=SID, timestamp="2026-10-10T00:00:00Z"):
    return json.dumps(dict(type="user", uuid=uuid, sessionId=sid, timestamp=timestamp,
                           message=dict(role="user", content=uuid)))


def setup(tmp_path, enabled=True):
    agent = dict(slug="teste", name="Teste", tmux_session="teste", workspace_path=str(tmp_path / "workspace"),
                 cli_default="claude_code", model_default="haiku")
    db = GrupoBorgesDB(str(tmp_path / "db.sqlite"), jsonl_backfill_current=enabled)
    db._apply_schema()
    db._sync_agents([agent])
    root = tmp_path / "projects"
    folder = root / encoded_cwd(agent["workspace_path"])
    folder.mkdir(parents=True)
    watcher = JsonlWatcher(claude_projects_dir=str(root), agents=[agent], db=db, backfill_current=enabled)
    return db, watcher, folder


def count(db):
    with db._connect() as conn:
        return conn.execute("SELECT count(*) FROM task_events").fetchone()[0]


async def test_importa_so_atual_duas_vezes_e_nao_duplica_ao_vivo(tmp_path):
    db, watcher, folder = setup(tmp_path)
    (folder / (OLD + ".jsonl")).write_text(line("antiga", OLD) + "\n")
    path = folder / (SID + ".jsonl")
    path.write_text(line("primeira") + "\n" + line("segunda") + "\n")
    # Um evento já foi recebido pelo watcher anterior, sem ledger de importação.
    db._insert_task_event("jsonl:user", None, "teste", None, json.loads(line("segunda")), line("segunda"))
    with patch("services.claude_runtime.read_runtime", AsyncMock(return_value=ClaudeRuntime(SID, "idle"))):
        await watcher.backfill_current_conversations()
        assert count(db) == 2
        await watcher.backfill_current_conversations()
        assert count(db) == 2
    with path.open("a") as out:
        out.write(line("terceira") + "\n")
    await watcher._process_jsonl(path)
    assert count(db) == 3
    watcher._offsets[str(path)] = 0  # replay de arquivo após restart/truncamento
    await watcher._process_jsonl(path)
    assert count(db) == 3
    assert db._latest_jsonl_session_id("teste") == SID


async def test_nao_executa_tasks_ou_lifecycle_do_historico(tmp_path):
    db, watcher, folder = setup(tmp_path)
    (folder / (SID + ".jsonl")).write_text(line("primeira") + "\n")
    with (patch("services.claude_runtime.read_runtime", AsyncMock(return_value=ClaudeRuntime(SID, "idle"))),
          patch.object(db, "advance_task_from_lifecycle", AsyncMock()) as advance,
          patch.object(db, "update_agent_lifecycle", AsyncMock()) as lifecycle):
        await watcher.backfill_current_conversations()
    advance.assert_not_called()
    lifecycle.assert_not_called()


async def test_sem_processo_atual_nao_escolhe_arquivo_mais_recente(tmp_path):
    db, watcher, folder = setup(tmp_path)
    (folder / (OLD + ".jsonl")).write_text(line("antiga", OLD) + "\n")
    with patch("services.claude_runtime.read_runtime", AsyncMock(return_value=None)):
        await watcher.backfill_current_conversations()
    assert count(db) == 0


async def test_linha_parcial_e_append_entre_backfill_e_watch(tmp_path):
    db, watcher, folder = setup(tmp_path)
    path = folder / (SID + ".jsonl")
    partial = line("segunda")
    path.write_text(line("primeira") + "\n" + partial[:15])
    with patch("services.claude_runtime.read_runtime", AsyncMock(return_value=ClaudeRuntime(SID, "idle"))):
        await watcher.backfill_current_conversations()
    assert count(db) == 1
    with path.open("a") as out:
        out.write(partial[15:] + "\n")
    assert path in watcher._catchup_paths
    await watcher._process_jsonl(path)
    assert count(db) == 2


async def test_replay_cronologico_mesmo_quando_evento_recente_ja_existia(tmp_path):
    db, watcher, folder = setup(tmp_path)
    recent = line("recente", timestamp="2026-10-10T02:00:00Z")
    old = line("anterior", timestamp="2026-10-10T01:00:00Z")
    db._insert_task_event("jsonl:user", None, "teste", None, json.loads(recent), recent)
    (folder / (SID + ".jsonl")).write_text(old + "\n" + recent + "\n")
    with patch("services.claude_runtime.read_runtime", AsyncMock(return_value=ClaudeRuntime(SID, "idle"))):
        await watcher.backfill_current_conversations()
    events = await db.list_jsonl_message_events("teste", session_id=SID, since_id=0, limit=100, newest_first=True)
    assert [event["payload"]["uuid"] for event in events] == ["anterior", "recente"]


async def test_default_marca_eof_sem_backfill_nem_nova_tabela(tmp_path):
    db, watcher, folder = setup(tmp_path, enabled=False)
    path = folder / (SID + ".jsonl")
    path.write_text(line("primeira") + "\n")
    watcher._prepopulate_offsets()
    assert watcher._offsets[str(path)] == path.stat().st_size and count(db) == 0
    with db._connect() as conn:
        assert conn.execute("SELECT name FROM sqlite_master WHERE name='jsonl_imports'").fetchone() is None
