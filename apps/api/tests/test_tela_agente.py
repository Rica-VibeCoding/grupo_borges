"""CDP dublado; locks em processos reais, sem navegar na frota."""

import asyncio
import base64
import io
import json
import time
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from PIL import Image

from routers import tela_agente as router
from services import tela_agente as tela


@pytest.fixture
async def bancada(monkeypatch):
    cdp = AsyncMock()
    cdp.alvo = "aba-1"
    cdp.eventos = asyncio.Queue(maxsize=1)
    cdp.reader = asyncio.create_task(asyncio.sleep(999))
    cdp.cmd.return_value = {"cssVisualViewport": {"clientWidth": 1920, "clientHeight": 1080}}
    cdp.abas.return_value = [{"id": "aba-1", "titulo": "Prova", "url": "https://example.org"}]
    monkeypatch.setattr(tela.CDP, "abrir", AsyncMock(return_value=cdp))
    pedidos = tela.PedidosHumanos()
    monkeypatch.setattr(tela, "pedidos", pedidos)
    monkeypatch.setattr(tela, "avisar", AsyncMock(return_value=True))
    servico = tela.ServicoTela()
    monkeypatch.setattr(tela, "servico", servico)
    app = FastAPI()
    app.include_router(router.router, prefix="/api/tela-agente")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c, servico, cdp
    await servico.shutdown()
    await pedidos.shutdown()
    cdp.reader.cancel()


async def nova(bancada):
    c, svc, cdp = bancada
    r = await c.post("/api/tela-agente/chromes/campanha-arsenal/sessoes")
    assert r.status_code == 201
    return svc.sessoes[r.json()["id"]]


async def test_ver_sem_assumir_e_exclusao(bancada):
    c, svc, cdp = bancada
    s = await nova(bancada)
    r = await c.post("/api/tela-agente/chromes/campanha-arsenal/sessoes")
    assert r.status_code == 409
    assert (
        await c.post(
            f"/api/tela-agente/sessoes/{s.id}/entrada", json={"tipo": "texto", "texto": "x"}
        )
    ).status_code == 403
    assert (await c.post(f"/api/tela-agente/sessoes/{s.id}/assumir")).status_code == 409
    with pytest.raises(HTTPException) as exc:
        svc.obter(s.id, "outra-pessoa")
    assert exc.value.status_code == 403
    await c.delete(f"/api/tela-agente/sessoes/{s.id}")
    assert (await c.get(f"/api/tela-agente/sessoes/{s.id}/abas")).status_code == 410


async def test_posse_espera_e_libera_sem_frota(monkeypatch, tmp_path):
    # A fronteira shell é dublada: pytest não faz SSH nem trava Chrome da frota.
    lock = tmp_path / "harness.lock"
    bh = tmp_path / "bh.sh"
    bh.write_text(f"exec flock -w 0 '{lock}' sh -c 'echo locked; read -r release'\n")
    monkeypatch.setattr(tela, "BH", bh)
    posse = await tela.Posse.abrir("teste")
    try:
        p = await asyncio.create_subprocess_exec("flock", "-w", "3", str(lock), "true")
        await asyncio.sleep(0.1)
        assert p.returncode is None
    finally:
        await posse.fechar()
    assert await p.wait() == 0


async def assumir_fake(s, monkeypatch):
    posse = AsyncMock()
    posse.p.returncode = None
    monkeypatch.setattr(tela.Posse, "abrir", AsyncMock(return_value=posse))
    s.fluxo = True
    token = await tela.servico.assumir(s)
    return posse, {"X-Tela-Controle": token}


async def test_entrada_escala_teclas_scroll_e_aba(bancada, monkeypatch):
    c, svc, cdp = bancada
    s = await nova(bancada)
    posse, headers = await assumir_fake(s, monkeypatch)
    s.quadros["7"] = (time.monotonic(), "aba-1", 1920, 1080)
    base = f"/api/tela-agente/sessoes/{s.id}"
    for body in [
        {"tipo": "clique", "quadro": "7", "x": 0.25, "y": 0.5},
        {"tipo": "rolagem", "quadro": "7", "x": 0.25, "y": 0.5, "delta_y": 300},
        {"tipo": "texto", "texto": "olá"},
        *[{"tipo": "tecla", "tecla": t} for t in ("Enter", "Tab", "Backspace")],
        {"tipo": "aba", "aba": "aba-2"},
    ]:
        r = await c.post(base + "/entrada", json=body, headers=headers)
        assert r.status_code == 200, r.text
    cdp.cmd.assert_any_await(
        "Input.dispatchMouseEvent",
        {
            "type": "mousePressed",
            "x": 480,
            "y": 540,
            "button": "left",
            "buttons": 1,
            "clickCount": 1,
        },
    )
    cdp.cmd.assert_any_await("Input.insertText", {"text": "olá"})
    cdp.selecionar.assert_any_await("aba-2", assumir=True)
    assert not s.quadros
    assert (await c.post(base + "/devolver", headers=headers)).status_code == 200
    posse.fechar.assert_awaited_once()
    assert (
        await c.post(base + "/entrada", json={"tipo": "texto", "texto": "x"}, headers=headers)
    ).status_code == 403


@pytest.mark.parametrize(
    "body",
    [
        {"tipo": "clique", "quadro": "x", "x": 1.1, "y": 0},
        {"tipo": "texto", "texto": ""},
        {"tipo": "texto", "texto": "x", "script": "alert(1)"},
        {"tipo": "tecla", "tecla": "Delete"},
        {"tipo": "rolagem", "quadro": "x", "x": 0, "y": 0, "delta_y": "inf"},
    ],
)
async def test_entrada_invalida(bancada, body):
    c, _, _ = bancada
    s = await nova(bancada)
    r = await c.post(
        f"/api/tela-agente/sessoes/{s.id}/entrada",
        content=json.dumps(body),
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 422


async def test_quadro_velho_recusa_sem_cdp(bancada, monkeypatch):
    c, svc, cdp = bancada
    s = await nova(bancada)
    _, headers = await assumir_fake(s, monkeypatch)
    s.quadros["1"] = (time.monotonic() - 11, s.cdp.alvo, 100, 100)
    cdp.cmd.reset_mock()
    r = await c.post(
        f"/api/tela-agente/sessoes/{s.id}/entrada",
        headers=headers,
        json={"tipo": "clique", "quadro": "1", "x": 0.1, "y": 0.2},
    )
    assert r.status_code == 409
    cdp.cmd.assert_not_awaited()


async def test_quadro_e_desconexao_soltam_trava(bancada, monkeypatch):
    _, svc, cdp = bancada
    s = await nova(bancada)
    posse, _ = await assumir_fake(s, monkeypatch)
    out = io.BytesIO()
    Image.new("RGB", (960, 540)).save(out, format="JPEG")
    await cdp.eventos.put({"data": base64.b64encode(out.getvalue()).decode()})
    gen = svc.eventos(s)
    e = await anext(gen)
    if e["event"] == "estado":
        e = await anext(gen)
    q = json.loads(e["data"])
    assert q["largura"] == 960 and q["viewport"]["largura"] == 1920
    await gen.aclose()
    posse.fechar.assert_awaited_once()
    assert s.id not in svc.sessoes


@pytest.mark.parametrize("motivo", ["inatividade", "sem-fluxo", "cdp"])
async def test_vigia_libera_sem_depender_do_fluxo(bancada, monkeypatch, motivo):
    _, svc, cdp = bancada
    s = await nova(bancada)
    posse, _ = await assumir_fake(s, monkeypatch)
    if motivo == "inatividade":
        s.atividade -= tela.INATIVIDADE + 1
    if motivo == "sem-fluxo":
        s.fluxo_em -= tela.SEM_FLUXO + 1
    if motivo == "cdp":
        cdp.reader.cancel()
        await asyncio.sleep(0)
    await asyncio.wait_for(s.vigia, 2)
    assert s.fechada
    posse.fechar.assert_awaited_once()


async def test_quadro_estatico_continua_clicavel(bancada, monkeypatch):
    c, svc, cdp = bancada
    s = await nova(bancada)
    _, headers = await assumir_fake(s, monkeypatch)
    s.sequencia = 1
    s.quadros["1"] = (time.monotonic() - 30, s.cdp.alvo, 1920, 1080)
    r = await c.post(
        f"/api/tela-agente/sessoes/{s.id}/entrada",
        headers=headers,
        json={"tipo": "clique", "quadro": "1", "x": 0.1, "y": 0.2},
    )
    assert r.status_code == 200


class Wire:
    def __init__(self):
        self.queue = asyncio.Queue()
        self.sent = []

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self.queue.get()
        if item is None:
            raise StopAsyncIteration
        return json.dumps(item)

    async def send(self, raw):
        msg = json.loads(raw)
        self.sent.append(msg)
        result = {}
        if msg["method"] == "Target.getTargets":
            result = {
                "targetInfos": [
                    {
                        "type": "page",
                        "targetId": "t1",
                        "title": "Teste",
                        "url": "https://example.org",
                    }
                ]
            }
        if msg["method"] == "Target.attachToTarget":
            result = {"sessionId": "sid1"}
        if msg["method"] == "Runtime.evaluate":
            result = {"result": {"value": "visible"}}
        await self.queue.put({"id": msg["id"], "result": result})

    async def close(self):
        pass


async def test_cdp_ack_descarta_sem_acumular_e_ver_nao_ativa():
    wire = Wire()
    cdp = tela.CDP(wire)
    try:
        await cdp.selecionar()
        assert not any(x["method"] == "Page.bringToFront" for x in wire.sent)
        assert any(x["method"] == "Page.startScreencast" for x in wire.sent)
        for i in range(20):
            await wire.queue.put(
                {
                    "method": "Page.screencastFrame",
                    "sessionId": "sid1",
                    "params": {"sessionId": i, "data": str(i)},
                }
            )
        await asyncio.sleep(0.05)
        assert cdp.eventos.qsize() == 1
        assert (await cdp.eventos.get())["data"] == "19"
        assert len([x for x in wire.sent if x["method"] == "Page.screencastFrameAck"]) == 20
    finally:
        await cdp.fechar()


async def criar_pedido(bancada, prazo=60):
    c, _, _ = bancada
    r = await c.post(
        "/api/tela-agente/pedidos",
        json={
            "chrome": "campanha-arsenal",
            "motivo": "TESTE captcha público",
            "agente": "teste",
            "prazo_s": prazo,
        },
    )
    assert r.status_code == 201, r.text
    return tela.pedidos.obter(r.json()["id"])


async def test_humano_aguarda_so_devolver_conclui(bancada, monkeypatch):
    c, svc, cdp = bancada
    p = await criar_pedido(bancada)
    tela.avisar.assert_awaited_once()
    assert p.corpo()["url"].endswith("/maquinas/arsenal/chrome/campanha-arsenal?pedido=" + p.id)
    s = await nova(bancada)
    assert s.pedido_id == p.id
    _, headers = await assumir_fake(s, monkeypatch)
    assert p.status == "em_atendimento"
    gen = tela.pedidos.esperar(p)
    assert (await anext(gen))["event"] == "estado"
    r = await c.post(f"/api/tela-agente/sessoes/{s.id}/devolver", headers=headers)
    assert r.status_code == 200
    fim = await anext(gen)
    assert fim["event"] == "terminado" and json.loads(fim["data"])["status"] == "devolvido"
    assert s.posse is None
    await gen.aclose()


async def test_expira_libera_trava_antes_de_acordar_agente(bancada, monkeypatch):
    p = await criar_pedido(bancada, 2)
    s = await nova(bancada)
    posse, _ = await assumir_fake(s, monkeypatch)
    await asyncio.wait_for(p.terminado.wait(), 3)
    assert p.status == "expirado" and s.fechada
    posse.fechar.assert_awaited_once()


async def test_queda_da_tela_nao_finge_devolucao(bancada, monkeypatch):
    _, svc, _ = bancada
    p = await criar_pedido(bancada)
    s = await nova(bancada)
    await assumir_fake(s, monkeypatch)
    await svc.fechar(s)
    assert not p.terminado.is_set() and p.status == "aguardando"
    s2 = await nova(bancada)
    assert s2.pedido_id == p.id


async def test_duplicado_e_pedido_de_outro_chrome(bancada):
    c, _, _ = bancada
    p = await criar_pedido(bancada)
    r = await c.post(
        "/api/tela-agente/pedidos", json={"chrome": p.chrome, "motivo": "x", "agente": "teste"}
    )
    assert r.status_code == 409
    r = await c.post("/api/tela-agente/chromes/fluytcom-arsenal/sessoes?pedido=" + p.id)
    assert r.status_code == 409


async def test_aviso_falhou_mas_pedido_esta_registrado(bancada, monkeypatch):
    monkeypatch.setattr(tela, "avisar", AsyncMock(return_value=False))
    p = await criar_pedido(bancada)
    assert not p.aviso_enviado
    await tela.pedidos.shutdown()
    assert p.status == "interrompido"


async def test_pedido_chega_com_tela_ja_assumida(bancada, monkeypatch):
    s = await nova(bancada)
    await assumir_fake(s, monkeypatch)
    p = await criar_pedido(bancada)
    assert s.pedido_id == p.id and p.status == "em_atendimento"


async def test_aviso_usa_resumo_real_sem_credencial_na_api(monkeypatch):
    stub = AsyncMock(return_value="")
    monkeypatch.setattr(tela, "processo", stub)
    assert await tela.avisar("teste", "TESTE aviso")
    args = stub.call_args.args
    assert (tela.BH.parents[4] / "scripts" / "resumo" / "resumo.py").is_file()
    assert args[-3:] == (str(tela.BH.parents[4] / "scripts" / "resumo"), "teste", "TESTE aviso")
    assert "nivel='urgente'" in args[2]


async def test_router_montado_exige_identidade_tailscale(monkeypatch):
    from types import SimpleNamespace

    from main import app

    monkeypatch.setattr(
        app.state, "settings", SimpleNamespace(dev_bypass_auth=False), raising=False
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        assert (await c.get("/api/tela-agente/chromes")).status_code == 401
        r = await c.get(
            "/api/tela-agente/chromes", headers={"Tailscale-User-Login": "teste@example.test"}
        )
        assert r.status_code == 200 and any(x["id"] == "campanha-arsenal" for x in r.json())
