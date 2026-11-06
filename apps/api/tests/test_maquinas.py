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
    for entrada in maquinas.MAQUINAS.values():
        monkeypatch.setenv(entrada["chave_env"], "chave-de-teste")
        monkeypatch.delenv(entrada["url_env"], raising=False)
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
    assert resposta.json() == [
        {"id": "arsenal", "nome": "Arsenal"},
        {"id": "note", "nome": "Note"},
        {"id": "pc", "nome": "PC"},
        {"id": "vps", "nome": "VPS"},
    ]
    assert painel[2] == []


async def test_cache_expira_em_3_segundos_com_relogio_injetado(cliente, painel):
    _, agora, pedidos = painel
    primeira = await cliente.get("/api/maquinas/arsenal/resumo")
    agora[0] += 2.9
    segunda = await cliente.get("/api/maquinas/arsenal/resumo")
    assert primeira.status_code == segunda.status_code == 200
    assert primeira.json() == segunda.json() == {**RESUMO, "online": True}
    assert len(pedidos) == 1
    agora[0] = 103.0
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
@pytest.mark.parametrize("maquina", ["arsenal", "note", "pc", "vps"])
async def test_resumo_offline_tambem_tem_cache(cliente, painel, falha, maquina):
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
        resposta = await cliente.get(f"/api/maquinas/{maquina}/resumo")
        assert resposta.status_code == 200
        assert resposta.json()["online"] is False
        assert resposta.json()["motivo"]
    assert len(pedidos) == 1
    agora[0] += 30
    await cliente.get(f"/api/maquinas/{maquina}/resumo")
    assert len(pedidos) == 2


@pytest.mark.parametrize("maquina", ["arsenal", "note", "pc", "vps"])
async def test_sem_chave_nao_faz_pedido_e_env_e_lido_na_chamada(cliente, painel, monkeypatch, maquina):
    entrada = maquinas.MAQUINAS[maquina]
    monkeypatch.delenv(entrada["chave_env"])
    for _ in range(2):
        resposta = await cliente.get(f"/api/maquinas/{maquina}/resumo")
        assert resposta.status_code == 200
        assert resposta.json() == {"online": False, "motivo": "falta configurar a chave no cockpit"}
    assert painel[2] == []
    monkeypatch.setenv(entrada["chave_env"], "nova-chave")
    monkeypatch.setenv(entrada["url_env"], f"http://{maquina}.test:8787/")
    assert (await cliente.get(f"/api/maquinas/{maquina}/resumo")).json()["online"] is True
    assert painel[2][0].url.host == f"{maquina}.test"
    assert painel[2][0].headers["Authorization"] == "Bearer nova-chave"


@pytest.mark.parametrize("maquina,ip", [("note", "100.116.209.95"), ("pc", "100.118.54.91"), ("vps", "100.116.1.44")])
async def test_novas_maquinas_url_padrao_e_recuperacao_apos_desligar(cliente, painel, maquina, ip):
    online = [False]

    def responder(request):
        assert request.url == f"http://{ip}:8787/api/maquina/resumo"
        assert request.headers["Authorization"] == "Bearer chave-de-teste"
        if not online[0]:
            raise httpx.ConnectError("desligada", request=request)
        return httpx.Response(200, json=RESUMO)

    painel[0](responder)
    assert (await cliente.get(f"/api/maquinas/{maquina}/resumo")).json() == {
        "online": False, "motivo": "não responde"}
    online[0] = True
    painel[1][0] += 30
    assert (await cliente.get(f"/api/maquinas/{maquina}/resumo")).json() == {**RESUMO, "online": True}
    assert len(painel[2]) == 2


@pytest.mark.parametrize("maquina", ["arsenal", "vps"])
@pytest.mark.parametrize("rota,limite_s", [("resumo", 3), ("abertos", 6), ("fechar", 12)])
async def test_authorization_timeout_e_repasse_sem_cache(cliente, painel, rota, limite_s, maquina):
    instalar, _, pedidos = painel
    corpo = {"resumo": RESUMO, "abertos": ABERTOS, "fechar": {"liberou_mb": 31.5}}[rota]
    instalar(lambda _: httpx.Response(200, json=corpo))
    for _ in range(2):
        if rota == "fechar":
            resposta = await cliente.post(f"/api/maquinas/{maquina}/{rota}", json={"id": "Chrome_123-abc"})
        else:
            resposta = await cliente.get(f"/api/maquinas/{maquina}/{rota}")
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


@pytest.mark.parametrize("status", [403, 404, 409, 501])
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


async def test_reinicio_sem_cpu_continua_online_e_nova_amostra_chega_em_3s(cliente, painel):
    corpo = {**RESUMO, "cpu_pct": None, "parados_30min": None}
    painel[0](lambda _: httpx.Response(200, json=corpo))
    assert (await cliente.get('/api/maquinas/note/resumo')).json() == {**corpo, 'online': True}
    corpo['cpu_pct'] = 17.0
    corpo['parados_30min'] = 0
    painel[1][0] += 3
    assert (await cliente.get('/api/maquinas/note/resumo')).json() == {**corpo, 'online': True}


async def test_fechar_invalida_resumo_da_maquina(cliente, painel):
    corpo = dict(RESUMO)
    painel[0](lambda r: httpx.Response(200, json={'liberou_mb': 10} if r.method == 'POST' else corpo))
    await cliente.get('/api/maquinas/arsenal/resumo')
    corpo['parados_30min'] = 0
    await cliente.post('/api/maquinas/arsenal/fechar', json={'id': 'teste'})
    assert (await cliente.get('/api/maquinas/arsenal/resumo')).json()['parados_30min'] == 0
    assert len(painel[2]) == 3


async def test_pc_sem_listagem_preserva_explicacao(cliente, painel):
    corpo = {'mensagem': 'o PC ainda não lista o que está aberto'}
    painel[0](lambda _: httpx.Response(501, json=corpo))
    resposta = await cliente.get('/api/maquinas/pc/abertos')
    assert resposta.status_code == 501
    assert resposta.json() == corpo


async def test_ram_e_liberacao_desconhecidas_atravessam_ponte(cliente, painel):
    corpo = {**ABERTOS, 'itens': [{**ABERTOS['itens'][0], 'memoria_mb': None}]}
    painel[0](lambda r: httpx.Response(200, json={'liberou_mb': None} if r.method == 'POST' else corpo))
    assert (await cliente.get('/api/maquinas/note/abertos')).json() == corpo
    assert (await cliente.post('/api/maquinas/note/fechar', json={'id': 'teste'})).json() == {'liberou_mb': None}


async def test_residual_tem_grupo_proprio_e_nao_pode_fechar(cliente, painel):
    corpo = {**ABERTOS, 'itens': [{**ABERTOS['itens'][0], 'id': 'fora-da-lista', 'grupo': 'residual', 'acao_rotulo': None}]}
    painel[0](lambda _: httpx.Response(200, json=corpo))
    assert (await cliente.get('/api/maquinas/vps/abertos')).json() == corpo
