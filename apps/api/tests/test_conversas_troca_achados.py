# ruff: noqa: F811 — fixtures compartilhadas da bancada de conversas
"""Regressões da troca Nova/Retomar: identidade e publicação após troca real."""
import asyncio
from uuid import UUID, uuid4

import pytest
from test_conversas_lista import ID_CUSTOM, ID_PROMPT, bancada  # noqa: F401
from test_conversas_nova import ID_NOVA, palco  # noqa: F401
from test_conversas_retomar import linha  # noqa: F401

from routers import conversas as router
from services import operacao_conversa as operacao
from services import tmux_driver


async def test_operacao_tem_uuid_estavel_sem_inicio_no_contrato(palco, monkeypatch):
    monkeypatch.setattr(operacao, "_agora_ms", lambda: 100)
    primeira = operacao.comecar("pavan")
    inicial = (await palco.cliente.get("/api/agents/pavan/conversas/operacao")).json()
    assert inicial.get("id") is not None, "a operação precisa de identidade"
    assert UUID(inicial["id"]).version == 4
    assert "inicio" not in inicial
    monkeypatch.setattr(operacao, "_agora_ms", lambda: 200)
    operacao.avancar(primeira, "pronta")
    fim = (await palco.cliente.get("/api/agents/pavan/conversas/operacao")).json()
    assert (fim["id"], fim["desde"]) == (inicial["id"], 200)
    operacao.comecar("pavan")
    segunda = (await palco.cliente.get("/api/agents/pavan/conversas/operacao")).json()
    assert segunda["id"] != inicial["id"]


@pytest.mark.parametrize("acao", ["nova", f"{ID_PROMPT}/retomar"])
@pytest.mark.parametrize("antecipada", [False, True])
async def test_post_e_get_identificam_a_mesma_operacao(linha, monkeypatch, acao, antecipada):
    operacao_id = str(uuid4())
    liberar = asyncio.Event()
    conduzir = router._conduzir_nova if acao == "nova" else router._conduzir_retomar

    async def atrasar(*args, **kwargs):
        await liberar.wait()
        await conduzir(*args, **kwargs)

    if antecipada:
        monkeypatch.setattr(router, "_conduzir_nova" if acao == "nova" else "_conduzir_retomar", atrasar)
        monkeypatch.setattr(operacao, "TETO_RESPOSTA_S", 0.001)
    try:
        r = await linha.cliente.post(f"/api/agents/pavan/conversas/{acao}", json={"operacao_id": operacao_id})
        assert r.status_code == (202 if antecipada else 200), r.text
        assert r.json().get("id"), "o POST precisa identificar a operação aceita"
        get = (await linha.cliente.get("/api/agents/pavan/conversas/operacao")).json()
        assert r.json()["id"] == get["id"] == operacao_id
        assert "inicio" not in r.json()
    finally:
        liberar.set()
        await asyncio.gather(*list(router._tarefas))


@pytest.mark.parametrize("local", [False, True])
@pytest.mark.parametrize("outcome", ["refused", "uncertain"])
async def test_rename_falha_mas_troca_real_chega_ao_stream(palco, monkeypatch, local, outcome):
    monkeypatch.setattr(tmux_driver, "local_launcher_enabled", lambda: local)
    enviar = palco.agente.send_message

    async def abrir(_):
        (palco.bancada.pasta / f"{ID_NOVA}.jsonl").write_text("")
        return {"confirmed": True}

    async def rename_falha(sessao, texto):
        if texto.startswith("/rename"):
            return tmux_driver.DeliveryResult(outcome=outcome, reason="pane_incompativel")
        return await enviar(sessao, texto)

    monkeypatch.setattr(tmux_driver, "new_local_conversation", abrir)
    monkeypatch.setattr(tmux_driver, "send_message", rename_falha)
    r = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={})
    eventos, _ = operacao.trocas_desde("pavan", 0)
    if local and outcome == "refused":
        assert r.status_code == 502
        assert "/rename" in r.json()["detalhe"]
        assert eventos == []
        assert operacao.corrigir_atual("pavan", ID_CUSTOM) == ID_CUSTOM
        assert await palco.bancada.db.anterior_do_agente("pavan") is None
        return
    assert len(eventos) == 1, "a troca real precisa chegar ao chat mesmo sem rename"
    assert eventos[0]["session_id"] == ID_NOVA
    assert operacao.corrigir_atual("pavan", ID_CUSTOM) == ID_NOVA
    assert await palco.bancada.db.anterior_do_agente("pavan") == ID_CUSTOM
    if local and outcome == "uncertain":
        # No lançador local, entrega incerta do /rename segue como antes: o rename costuma ter chegado.
        assert r.status_code == 200
        return
    assert r.status_code == 502
    assert "/rename" in r.json()["detalhe"]


async def test_nova_ambigua_termina_em_erro_sem_marcar_conversa_velha_como_nova(palco, monkeypatch):
    enviar = palco.agente.send_message

    async def clear_duplo(sessao, texto):
        entrega = await enviar(sessao, texto)
        if texto == "/clear":
            (palco.bancada.pasta / "88888888-8888-4888-8888-888888888888.jsonl").write_text("")
        return entrega

    monkeypatch.setattr(tmux_driver, "send_message", clear_duplo)
    r = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={})
    assert r.status_code == 502, "duas conversas novas não provam qual entrou"
    assert r.json()["fase"] == "erro"
    assert "mais de uma conversa" in r.json()["detalhe"]
    assert operacao.trocas_desde("pavan", 0)[0] == []
    assert await palco.bancada.db.anterior_do_agente("pavan") is None


@pytest.mark.parametrize("acao", ["nova", f"{ID_PROMPT}/retomar"])
async def test_r3_evento_identifica_operacao_que_trocou(linha, acao):
    operacao_id = str(uuid4())
    r = await linha.cliente.post(f"/api/agents/pavan/conversas/{acao}", json={"operacao_id": operacao_id})
    assert r.status_code == 200, r.text
    eventos, _ = operacao.trocas_desde("pavan", 0)
    assert eventos[-1]["operacao_id"] == operacao_id
