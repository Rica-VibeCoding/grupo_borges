from pathlib import Path
import sys
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from routers import agents
from services.kimi_catalog import Modelo

MODELOS_KIMI = (
    Modelo("kimi-for-coding", "K2.7 Coding", 262144),
    Modelo("kimi-for-coding-highspeed", "K2.7 Coding Highspeed", 262144),
    Modelo("k3", "K3", 1048576),
    Modelo("k3-256k", "K3-256k", 262144),
)


def contexto(model):
    return agents.AgentPainelContexto(
        model=model, tokens=agents.AgentPainelTokens(), source="statusline",
        available=True,
    )


def test_opencode_nao_oferece_modelo():
    assert agents._build_painel_model({"motor_familia": "opencode"}, contexto("opus")) is None


def test_codex_nao_recicla_modelo_de_outra_familia(monkeypatch):
    monkeypatch.setattr(agents.proxy_catalog, "listar_modelos", lambda: ("gpt-6-astra[1m]",))
    painel = agents._build_painel_model(
        {"motor_familia": "codex-proxy", "state_model": "k3", "model_default": "opus"},
        contexto("opus"),
    )
    assert painel.allowed == ["gpt-6-astra[1m]"]
    assert painel.value is None
    assert painel.session_may_diverge


def test_kimi_esforco_de_sessao_gpt_nao_vaza():
    status = agents._CCStatus("teste", Path("/tmp/teste"), {
        "model": {"id": "gpt-6-astra[1m]"}, "effort": {"level": "xhigh"},
    })
    painel = agents._build_painel_effort_por_env_de_boot(
        {"motor_familia": "kimi", "kimi_reasoning_effort": "high"}, status,
        campo="kimi_reasoning_effort", allowed=["low", "high", "max"],
    )
    assert painel.value == "high"
    assert painel.session_may_diverge


@pytest.mark.asyncio
async def test_patch_esforco_obedece_override(monkeypatch):
    from types import SimpleNamespace
    db = SimpleNamespace(update_agent_runtime_state=AsyncMock())
    monkeypatch.setattr(agents, "_get_agent_or_404", AsyncMock(return_value={
        "motor_familia": "kimi", "model_family": "codex-proxy",
    }))
    resposta = await agents.patch_agent_effort(
        "teste", agents.AgentPainelEffortPatchRequest(effort="high"),
        SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db))),
    )
    assert resposta.source == "agent_state.kimi_reasoning_effort"
    db.update_agent_runtime_state.assert_awaited_once_with("teste", kimi_reasoning_effort="high")


@pytest.mark.parametrize("vivo,estado,esperado", [
    ("opus", "k3-256k", "k3-256k"),
    ("gpt-6-astra[1m]", "kimi-k3", None),
    ("k3", None, "k3"),
    ("K3-256k", None, "k3-256k"),
    ("k3[1m]", None, "k3"),
    (None, None, None),
])
def test_kimi_catalogo_e_escolha_comprovada(vivo, estado, esperado):
    painel = agents._build_painel_model(
        {"motor_familia": "kimi", "state_model": estado, "model_default": "opus"},
        contexto(vivo), MODELOS_KIMI,
    )
    assert painel.value == esperado
    assert painel.allowed == [m.id for m in MODELOS_KIMI]
    assert painel.labels == {m.id: m.display_name for m in MODELOS_KIMI}
    assert painel.context_length == next((m.context_length for m in MODELOS_KIMI if m.id == esperado), None)
    assert not painel.runtime_switch
    assert painel.session_may_diverge == (vivo in ("opus", "gpt-6-astra[1m]", None))


def test_kimi_leitura_velha_usa_pedido():
    ctx = contexto("k3")
    ctx.stale = True
    painel = agents._build_painel_model(
        {"motor_familia": "kimi", "state_model": "k3-256k"}, ctx, MODELOS_KIMI,
    )
    assert painel.value == "k3-256k"
    assert painel.session_may_diverge


@pytest.mark.parametrize("familia,modelo,esperado", [
    ("anthropic", "Opus 5", "opus"),
    ("codex-proxy", "gpt-6-astra[1m]", "gpt-6-astra[1m]"),
])
def test_familias_existentes_preservam_leitura(familia, modelo, esperado, monkeypatch):
    monkeypatch.setattr(agents.proxy_catalog, "listar_modelos", lambda: ("gpt-6-astra[1m]",))
    painel = agents._build_painel_model({"motor_familia": familia}, contexto(modelo))
    assert painel.value == esperado
    assert not painel.session_may_diverge


@pytest.mark.asyncio
@pytest.mark.parametrize("familia,modelo,codigo", [
    ("kimi", "k3-256k", 200), ("codex-proxy", "gpt-6-astra[1m]", 200),
    ("opencode", "opus", 422), ("kimi", "opus", 422),
])
async def test_post_modelo_obedece_override_sem_tmux(monkeypatch, familia, modelo, codigo):
    from types import SimpleNamespace
    from fastapi import HTTPException
    db = SimpleNamespace(upsert_agent_state=AsyncMock(), insert_task_event=AsyncMock())
    monkeypatch.setattr(agents, "_get_agent_or_404", AsyncMock(return_value={
        "motor_familia": familia, "model_family": None, "tmux_session": "teste",
    }))
    monkeypatch.setattr(agents.kimi_catalog, "listar_modelos", lambda key: MODELOS_KIMI)
    monkeypatch.setattr(agents.proxy_catalog, "listar_modelos", lambda: ("gpt-6-astra[1m]",))
    send = AsyncMock()
    monkeypatch.setattr(agents, "_send_tmux_or_409", send)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))
    if codigo == 200:
        resposta = await agents.change_agent_model("teste", agents.ModelChangeRequest(model=modelo), request)
        assert not resposta.runtime_switch
        db.upsert_agent_state.assert_awaited_once_with("teste", model=modelo)
    else:
        with pytest.raises(HTTPException) as erro:
            await agents.change_agent_model("teste", agents.ModelChangeRequest(model=modelo), request)
        assert erro.value.status_code == codigo
        db.upsert_agent_state.assert_not_awaited()
    send.assert_not_awaited()


@pytest.mark.asyncio
async def test_post_kimi_sem_catalogo_indisponivel(monkeypatch):
    from types import SimpleNamespace
    from fastapi import HTTPException
    monkeypatch.setattr(agents, "_get_agent_or_404", AsyncMock(return_value={"motor_familia": "kimi"}))
    monkeypatch.setattr(agents.kimi_catalog, "listar_modelos", lambda key: ())
    db = SimpleNamespace(upsert_agent_state=AsyncMock())
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))
    with pytest.raises(HTTPException) as erro:
        await agents.change_agent_model("teste", agents.ModelChangeRequest(model="k3"), request)
    assert erro.value.status_code == 503
    db.upsert_agent_state.assert_not_awaited()


def test_opencode_preserva_esforco_da_sessao():
    import time
    status = agents._CCStatus("teste", Path("/tmp/teste"), {
        "model": {"id": "deepseek-v4-flash[1m]"}, "effort": {"level": "high"},
        "updated_at": int(time.time()),
    })
    painel = agents._build_claude_painel_effort({"motor_familia": "opencode"}, status)
    assert painel.value == "high"
    assert painel.allowed == agents._CLAUDE_PAINEL_ALLOWED_EFFORTS
    assert not painel.session_may_diverge


@pytest.mark.parametrize("model", MODELOS_KIMI)
def test_contexto_classifica_kimi_pelo_id_oficial(model):
    status = agents._CCStatus("teste", Path("/tmp/teste"), {
        "model": {"id": model.id, "display_name": model.display_name},
        "context_window": {"context_window_size": model.context_length},
    })
    ctx = agents._build_painel_contexto({"motor_familia": "kimi"}, status)
    assert ctx.model_family == "kimi"
    assert ctx.model == model.display_name


def status_com(modelo):
    return agents._CCStatus("teste", Path("/tmp/teste"), {"model": {"id": modelo}})


def test_aviso_de_boot_some_quando_a_sessao_ja_assumiu_a_familia():
    """O `Vale no próximo boot` da UI se apaga por este campo.

    Ele nascia com `True` fixo no modelo Pydantic e nenhum dos dois construtores
    o sobrescrevia: era sempre verdadeiro, para todo agente, e o aviso ficava na
    tela para sempre — inclusive depois de Desligar + Ligar ter aplicado.
    """
    agente = {"motor_familia": "codex-proxy"}
    assert agents._painel_motor(agente, status_com("gpt-5.6-terra[1m]")).session_may_diverge is False


def test_aviso_de_boot_fica_enquanto_a_sessao_roda_a_familia_ANTIGA():
    """A outra metade: matar o aviso passaria o teste de cima sozinho."""
    agente = {"motor_familia": "codex-proxy"}
    assert agents._painel_motor(agente, status_com("claude-opus-5")).session_may_diverge is True


def test_aviso_de_boot_fica_com_o_agente_desligado():
    """Sem statusline não há sessão viva — a escolha ainda não está em vigor."""
    agente = {"motor_familia": "kimi"}
    assert agents._painel_motor(agente, agents._CCStatus("teste", None, None)).session_may_diverge is True


def test_agente_sem_override_tambem_converge():
    """Quem herda o yaml não fica com ressalva eterna: o `agents.model_family`
    já está em vigor assim que a sessão roda um modelo da família."""
    motor = agents._painel_motor({"model_family": "kimi"}, status_com("k3"))
    assert motor.override is None
    assert motor.session_may_diverge is False
