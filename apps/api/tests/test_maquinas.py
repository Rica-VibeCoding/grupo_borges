"""Contrato da ponte, com painel falso e relógio sem espera real."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI

from routers import maquinas as maquinas_router
from services import maquinas

RESUMO = {
    "cpu_pct": 12.5,
    "ram": {"usado_mb": 4000, "livre_mb": 12000, "total_mb": 16000, "pct": 25.0},
    "disco": {"usado_mb": 10000, "livre_mb": 90000, "total_mb": 100000, "pct": 10.0},
    "temperatura_c": None,
    "parados_30min": 2,
    "tela": {"em_uso": None, "ultimo_uso_s": None},
    "medido_em": 1793876400,
}
ABERTOS = {
    "observado_desde": 1793876000,
    "itens": [{
        "id": "Chrome_123-abc",
        "grupo": "agente",
        "rotulo": "Chrome do agente",
        "dono": "Fluyt Com",
        "memoria_mb": 31.5,
        "cpu_pct": None,
        "parado_s": None,
        "abas": ["Página de teste"],
        "pede_confirmacao": False,
        "acao_rotulo": "Fechar Chrome do agente",
    }, {
        "id": "Terminal_123-abc",
        "grupo": "terminal",
        "rotulo": "Fluyt Com",
        "dono": "Fluyt Com",
        "memoria_mb": 452.0,
        "cpu_pct": 12.3,
        "parado_s": 600,
        "abas": [],
        "pede_confirmacao": True,
        "acao_rotulo": "Fechar Fluyt Com",
    }, {
        "id": "Cadeira_123-abc",
        "grupo": "terminal",
        "rotulo": "Fluyt Com · cadeira",
        "dono": "Fluyt Com",
        "memoria_mb": 45.0,
        "cpu_pct": 2.1,
        "parado_s": 60,
        "abas": [],
        "pede_confirmacao": True,
        "acao_rotulo": "Fechar cadeira",
    }],
}


@pytest.fixture
def painel(monkeypatch):
    monkeypatch.setenv("MAQUINA_ARSENAL_CHAVE", "chave-de-teste")
    monkeypatch.delenv("MAQUINA_ARSENAL_URL", raising=False)
    agora = [100.0]
    pedidos = []

    def instalar(handler):
        async def responder(request):
            pedidos.append(request)
            # Dá oportunidade para outro cliente pedir o mesmo resumo em paralelo.
            await asyncio.sleep(0)
            return handler(request)

        servico = maquinas.ServicoMaquinas(
            relogio=lambda: agora[0],
            fabrica_cliente=lambda **kwargs: httpx.AsyncClient(
                transport=httpx.MockTransport(responder), **kwargs
            ),
        )
        monkeypatch.setattr(maquinas, "servico", servico)
        return servico

    instalar(lambda _: httpx.Response(200, json=RESUMO))
    return instalar, agora, pedidos


@pytest.fixture
async def cliente(painel):
    app = FastAPI()
    app.include_router(maquinas_router.router, prefix="/api/maquinas")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://cockpit.test"
    ) as client:
        yield client


async def test_lista_nao_consulta_o_painel(cliente, painel):
    resposta = await cliente.get("/api/maquinas")
    assert resposta.status_code == 200
    assert resposta.json() == [{"id": "arsenal", "nome": "Arsenal"}]
    assert painel[2] == []


async def test_cache_expira_em_30_segundos_com_relogio_injetado(cliente, painel):
    _, agora, pedidos = painel
    primeira = await cliente.get("/api/maquinas/arsenal/resumo")
    agora[0] += 29.9
    segunda = await cliente.get("/api/maquinas/arsenal/resumo")
    assert primeira.status_code == segunda.status_code == 200
    assert primeira.json() == segunda.json() == {**RESUMO, "online": True}
    assert len(pedidos) == 1
    agora[0] = 130.0
    assert (await cliente.get("/api/maquinas/arsenal/resumo")).status_code == 200
    assert len(pedidos) == 2


async def test_clientes_simultaneos_compartilham_uma_leitura(cliente, painel):
    respostas = await asyncio.gather(*[
        cliente.get("/api/maquinas/arsenal/resumo") for _ in range(8)
    ])
    assert all(r.status_code == 200 and r.json()["online"] for r in respostas)
    assert len(painel[2]) == 1


async def test_cache_e_trava_sao_por_maquina(cliente, painel, monkeypatch):
    monkeypatch.setitem(maquinas.MAQUINAS, "outra", {
        **maquinas.MAQUINAS["arsenal"], "nome": "Outra", "url_env": "MAQUINA_TESTE_URL",
        "url_padrao": "http://outra.test", "chave_env": "MAQUINA_TESTE_CHAVE",
    })
    monkeypatch.delenv("MAQUINA_TESTE_URL", raising=False)
    monkeypatch.setenv("MAQUINA_TESTE_CHAVE", "outra-chave")
    await asyncio.gather(*[
        cliente.get(f"/api/maquinas/{id}/resumo") for id in ("arsenal", "outra", "arsenal", "outra")
    ])
    assert len(painel[2]) == 2
    assert {r.url.host for r in painel[2]} == {"100.91.105.22", "outra.test"}


@pytest.mark.parametrize("falha", ["conexao", "timeout", "http", "json", "contrato", "nan"])
async def test_resumo_offline_tambem_tem_cache(cliente, painel, falha):
    instalar, agora, pedidos = painel

    def responder(request):
        if falha == "conexao":
            raise httpx.ConnectError("fora", request=request)
        if falha == "timeout":
            raise httpx.ReadTimeout("lento", request=request)
        if falha == "http":
            return httpx.Response(500, text="falhou")
        if falha == "json":
            return httpx.Response(200, text="não é json")
        if falha == "nan":
            return httpx.Response(200, text=json.dumps({**RESUMO, "cpu_pct": float("nan")}))
        return httpx.Response(200, json={"cpu_pct": 1})

    instalar(responder)
    for _ in range(2):
        resposta = await cliente.get("/api/maquinas/arsenal/resumo")
        assert resposta.status_code == 200
        assert resposta.json()["online"] is False
        assert resposta.json()["motivo"]
    assert len(pedidos) == 1
    agora[0] += 30
    await cliente.get("/api/maquinas/arsenal/resumo")
    assert len(pedidos) == 2


async def test_sem_chave_nao_faz_pedido_e_env_e_lido_na_chamada(cliente, painel, monkeypatch):
    monkeypatch.delenv("MAQUINA_ARSENAL_CHAVE")
    for _ in range(2):
        resposta = await cliente.get("/api/maquinas/arsenal/resumo")
        assert resposta.status_code == 200
        assert resposta.json() == {"online": False, "motivo": "falta configurar a chave no cockpit"}
    assert painel[2] == []
    monkeypatch.setenv("MAQUINA_ARSENAL_CHAVE", "nova-chave")
    monkeypatch.setenv("MAQUINA_ARSENAL_URL", "http://arsenal.test:8787/")
    assert (await cliente.get("/api/maquinas/arsenal/resumo")).json()["online"] is True
    assert painel[2][0].url.host == "arsenal.test"
    assert painel[2][0].headers["Authorization"] == "Bearer nova-chave"


@pytest.mark.parametrize("rota,limite_s", [("resumo", 3), ("abertos", 6), ("fechar", 12)])
async def test_authorization_timeout_e_repasse_sem_cache(cliente, painel, rota, limite_s):
    instalar, _, pedidos = painel
    corpo = {"resumo": RESUMO, "abertos": ABERTOS, "fechar": {"liberou_mb": 31.5}}[rota]
    instalar(lambda _: httpx.Response(200, json=corpo))
    for _ in range(2):
        if rota == "fechar":
            resposta = await cliente.post(f"/api/maquinas/arsenal/{rota}", json={"id": "Chrome_123-abc"})
        else:
            resposta = await cliente.get(f"/api/maquinas/arsenal/{rota}")
        assert resposta.status_code == 200
        assert resposta.json() == ({**corpo, "online": True} if rota == "resumo" else corpo)
    assert len(pedidos) == (1 if rota == "resumo" else 2)
    for pedido in pedidos:
        assert pedido.headers["Authorization"] == "Bearer chave-de-teste"
        assert pedido.url.path == f"/api/maquina/{rota}"
        assert pedido.extensions["timeout"] == dict.fromkeys(("connect", "read", "write", "pool"), limite_s)
        assert pedido.method == ("POST" if rota == "fechar" else "GET")
        if rota == "fechar":
            assert json.loads(pedido.content) == {"id": "Chrome_123-abc"}


@pytest.mark.parametrize("cpu", [None, 0.0, 17.3, float("inf"), float("nan")])
async def test_abertos_cpu_pct_aceita_nulo_e_numero_finito(cliente, painel, cpu):
    corpo = {**ABERTOS, "itens": [{**ABERTOS["itens"][0], "cpu_pct": cpu}]}
    painel[0](lambda _: httpx.Response(200, text=json.dumps(corpo)))
    resposta = await cliente.get("/api/maquinas/arsenal/abertos")
    if cpu is None or cpu in (0.0, 17.3):
        assert resposta.status_code == 200 and resposta.json() == corpo
    else:
        assert resposta.status_code == 502


@pytest.mark.parametrize("status", [403, 404, 409])
@pytest.mark.parametrize("rota", ["abertos", "fechar"])
async def test_repassa_status_e_mensagem_do_painel(cliente, painel, status, rota):
    corpo = {"mensagem": "protegido ou já encerrou"}
    painel[0](lambda _: httpx.Response(status, json=corpo))
    if rota == "fechar":
        resposta = await cliente.post("/api/maquinas/arsenal/fechar", json={"id": "valido"})
    else:
        resposta = await cliente.get("/api/maquinas/arsenal/abertos")
    assert resposta.status_code == status
    assert resposta.json() == corpo


@pytest.mark.parametrize("rota", ["abertos", "fechar"])
@pytest.mark.parametrize("falha", ["conexao", "timeout", "http", "contrato"])
async def test_painel_fora_no_repasse_devolve_502(cliente, painel, rota, falha):
    def responder(request):
        if falha == "conexao":
            raise httpx.ConnectError("fora", request=request)
        if falha == "timeout":
            raise httpx.ReadTimeout("lento", request=request)
        if falha == "http":
            return httpx.Response(500)
        return httpx.Response(200, json={})

    painel[0](responder)
    if rota == "fechar":
        resposta = await cliente.post("/api/maquinas/arsenal/fechar", json={"id": "valido"})
    else:
        resposta = await cliente.get("/api/maquinas/arsenal/abertos")
    assert resposta.status_code == 502
    assert resposta.json()["mensagem"]


@pytest.mark.parametrize("id", ["", "a" * 129, "a/b", "a b", "ç", "a\n", ";rm", 1, None])
async def test_id_invalido_nao_chega_ao_painel(cliente, painel, id):
    resposta = await cliente.post("/api/maquinas/arsenal/fechar", json={"id": id})
    assert resposta.status_code == 422
    assert painel[2] == []


@pytest.mark.parametrize("rota", ["resumo", "abertos", "fechar"])
async def test_maquina_desconhecida(cliente, painel, rota):
    if rota == "fechar":
        resposta = await cliente.post("/api/maquinas/desconhecida/fechar", json={"id": "valido"})
    else:
        resposta = await cliente.get(f"/api/maquinas/desconhecida/{rota}")
    assert resposta.status_code == 404
    assert painel[2] == []
