import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from routers import agents, fleet
from services import claude_runtime as runtime

SID = "11111111-1111-4111-8111-111111111111"


@pytest.mark.parametrize("cwd,pid,expected", [("/workspace", 321, True), ("/other", 321, False), ("/workspace", 322, False)])
def test_registro_precisa_pertencer_ao_pid_e_workspace(monkeypatch, tmp_path, cwd, pid, expected):
    sessions = tmp_path / ".claude/sessions"
    sessions.mkdir(parents=True)
    (sessions / "321.json").write_text(json.dumps(dict(pid=pid, cwd=cwd, sessionId=SID, status="idle")))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(Path, "read_bytes", lambda _: b"/usr/bin/claude\0--model\0haiku\0")
    session = SimpleNamespace(windows=[SimpleNamespace(panes=[SimpleNamespace(pane_pid="321")])])
    server = SimpleNamespace(has_session=lambda _: True, sessions=SimpleNamespace(get=lambda **_: session))
    with (patch.object(runtime.tmux_driver, "_server_for", return_value=server),
          patch.object(runtime.tmux_driver, "_pane_owner_pids", return_value={321})):
        found = runtime._read_runtime("teste", "/workspace")
    assert (found is not None) == expected


async def test_gaveta_usa_sessao_viva_sem_evento_no_banco(monkeypatch):
    monkeypatch.setattr(agents, "get_settings", lambda: SimpleNamespace(local_claude_telemetry=True))
    db = SimpleNamespace(get_agent=AsyncMock(return_value=dict(tmux_session="teste", workspace_path="/workspace")))
    with (patch.object(runtime, "read_runtime", AsyncMock(return_value=runtime.ClaudeRuntime(SID, "idle"))),
          patch.object(runtime, "read_status", return_value=dict(session_id=SID))):
        status = await agents._load_cc_status(db, "teste")
    assert status.session_id == SID and not status.fell_back


async def test_sidebar_usa_modelo_contexto_e_estado_da_sessao_viva(monkeypatch):
    monkeypatch.setattr(fleet, "get_settings", lambda: SimpleNamespace(local_claude_telemetry=True))
    agent = dict(slug="teste", tmux_session="teste", workspace_path="/workspace", context_pct=99)
    with (patch.object(runtime, "read_runtime", AsyncMock(return_value=runtime.ClaudeRuntime(SID, "busy"))),
          patch.object(runtime, "read_status", return_value=dict(model=dict(id="claude-haiku-5-5"))),
          patch.object(fleet, "_read_cc_context", return_value=(18, 36000, 123))):
        await fleet._hydrate_cc_context_pct(SimpleNamespace(), [agent])
    assert agent["state_model"] == "claude-haiku-5-5"
    assert agent["context_pct"] == 18 and agent["context_tokens"] == 36000
    assert agent["status"] == agent["lifecycle_status"] == "trabalhando"


async def test_sem_processo_nao_usa_contexto_anterior(monkeypatch):
    monkeypatch.setattr(fleet, "get_settings", lambda: SimpleNamespace(local_claude_telemetry=True))
    agent = dict(slug="teste", tmux_session="teste", workspace_path="/workspace", context_pct=99)
    with patch.object(runtime, "read_runtime", AsyncMock(return_value=None)):
        await fleet._hydrate_cc_context_pct(SimpleNamespace(), [agent])
    assert agent["context_pct"] is None and agent["context_tokens"] is None
