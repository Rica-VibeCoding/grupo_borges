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
    cdp.viewport_css.return_value = {"clientWidth": 1920, "clientHeight": 1080}
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
        if msg["method"] == "Page.captureScreenshot":
            out = io.BytesIO()
            Image.new("RGB", getattr(self, "tamanho", (1920, 1080))).save(out, format="JPEG")
            result = {"data": base64.b64encode(out.getvalue()).decode()}
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


async def criar_pedido(bancada, prazo=60, *, teste=False):
    c, _, _ = bancada
    r = await c.post(
        "/api/tela-agente/pedidos",
        json={
            "chrome": "campanha-arsenal",
            "motivo": "TESTE captcha público",
            "agente": "teste",
            "prazo_s": prazo,
            "teste": teste,
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


@pytest.mark.parametrize("animada", [False, True])
async def test_estado_periodico_com_e_sem_quadros(bancada, monkeypatch, animada):
    _, svc, cdp = bancada
    monkeypatch.setattr(tela, "ESTADO_INTERVALO", 0.06)
    monkeypatch.setattr(tela, "FPS", 200)
    s = await nova(bancada)
    await assumir_fake(s, monkeypatch)
    out = io.BytesIO()
    Image.new("RGB", (96, 54)).save(out, format="JPEG")
    frame = {"data": base64.b64encode(out.getvalue()).decode()}

    async def animar():
        while True:
            if not cdp.eventos.full():
                cdp.eventos.put_nowait(frame)
            await asyncio.sleep(0.005)

    produtor = asyncio.create_task(animar()) if animada else None
    gen = svc.eventos(s)
    try:
        assert json.loads((await anext(gen))["data"])["assumido"]
        p = await criar_pedido(bancada, teste=True)
        quadros = 0
        inicio = time.monotonic()
        while True:
            e = await asyncio.wait_for(anext(gen), 0.3)
            if e["event"] == "estado":
                assert json.loads(e["data"])["pedido"]["id"] == p.id
                break
            quadros += 1
        assert time.monotonic() - inicio >= 0.05
        assert bool(quadros) == animada
        await svc.fechar(s)
        e = await anext(gen)
        assert e["event"] == "estado" and not json.loads(e["data"])["assumido"]
    finally:
        if produtor:
            produtor.cancel()
            with pytest.raises(asyncio.CancelledError):
                await produtor
        await gen.aclose()


async def test_pedido_teste_pula_so_aviso_e_conclui_igual(bancada, monkeypatch):
    c, _, _ = bancada
    p = await criar_pedido(bancada, teste=True)
    tela.avisar.assert_not_awaited()
    assert not p.aviso_enviado and p.timer and not p.terminado.is_set()
    s = await nova(bancada)
    _, headers = await assumir_fake(s, monkeypatch)
    assert p.status == "em_atendimento"
    r = await c.post(f"/api/tela-agente/sessoes/{s.id}/devolver", headers=headers)
    assert r.status_code == 200 and p.status == "devolvido" and p.terminado.is_set()


class WireViewport(Wire):
    """Chrome dublado mantém métricas e quadros conforme os comandos de protocolo."""

    def __init__(self, animada=True):
        super().__init__()
        self.animada = animada
        self.tamanho = (1920, 1080)
        self.falhar_limpeza = False
        self.fechado = False

    async def send(self, raw):
        msg = json.loads(raw)
        method, params = msg["method"], msg["params"]
        if method == "Emulation.setDeviceMetricsOverride":
            self.tamanho = (params["width"], params["height"])
        if method == "Emulation.clearDeviceMetricsOverride":
            if self.falhar_limpeza:
                self.sent.append(msg)
                await self.queue.put({"id": msg["id"], "error": {"message": "desconectado"}})
                return
            self.tamanho = (1920, 1080)
        if method == "Page.getLayoutMetrics":
            self.sent.append(msg)
            await self.queue.put(
                {
                    "id": msg["id"],
                    "result": {
                        "cssVisualViewport": {
                            "clientWidth": self.tamanho[0] - 15,
                            "clientHeight": self.tamanho[1],
                        }
                    },
                }
            )
            return
        if method == "Runtime.evaluate" and "innerWidth" in params["expression"]:
            self.sent.append(msg)
            await self.queue.put(
                {
                    "id": msg["id"],
                    "result": {
                        "result": {
                            "value": {
                                "clientWidth": self.tamanho[0],
                                "clientHeight": self.tamanho[1],
                            }
                        }
                    },
                }
            )
            return
        await super().send(raw)
        if method == "Page.startScreencast" and self.animada:
            out = io.BytesIO()
            Image.new("RGB", self.tamanho).save(out, format="JPEG")
            await self.queue.put(
                {
                    "method": "Page.screencastFrame",
                    "sessionId": "sid1",
                    "params": {"sessionId": 1, "data": base64.b64encode(out.getvalue()).decode()},
                }
            )

    async def close(self):
        self.fechado = True
        self.tamanho = (1920, 1080)


@pytest.mark.parametrize(
    "tamanho,esperado", [((1920, 1080), (960, 540)), ((1080, 1920), (540, 960)), ((390, 700), (390, 700))]
)
async def test_quadro_inicial_sem_repintura_chega_pelo_sse(bancada, monkeypatch, tamanho, esperado):
    _, svc, _ = bancada
    wire = WireViewport(animada=False)
    wire.tamanho = tamanho
    cdp = tela.CDP(wire)
    monkeypatch.setattr(tela.CDP, "abrir", AsyncMock(return_value=cdp))
    s = await nova(bancada)
    gen = svc.eventos(s)
    try:
        assert (await anext(gen))["event"] == "estado"
        e = await asyncio.wait_for(anext(gen), 1)
        assert e["event"] == "quadro"
        q = json.loads(e["data"])
        assert (q["largura"], q["altura"]) == esperado
        assert q["aba"] == "t1"
        assert q["viewport"] == {"largura": tamanho[0] - 15, "altura": tamanho[1]}
        assert s.quadros[q["id"]][1:] == ("t1", tamanho[0] - 15, tamanho[1])
        with Image.open(io.BytesIO(base64.b64decode(q["jpeg"]))) as img:
            assert img.format == "JPEG" and img.size == esperado
        methods = [m["method"] for m in wire.sent]
        assert methods.index("Page.captureScreenshot") < methods.index("Page.startScreencast")
        captura = next(m["params"] for m in wire.sent if m["method"] == "Page.captureScreenshot")
        fluxo = next(m["params"] for m in wire.sent if m["method"] == "Page.startScreencast")
        assert captura == {"format": fluxo["format"], "quality": fluxo["quality"], "captureBeyondViewport": False}
        # A captura não é screencastFrame: não inventar um ACK nem esperar por repintura.
        assert "Page.screencastFrameAck" not in methods
        assert cdp.eventos.empty()
    finally:
        await gen.aclose()


async def test_reinicio_estatico_descarta_quadro_inicial_do_viewport_anterior(bancada, monkeypatch):
    _, svc, _ = bancada
    wire = WireViewport(animada=False)
    cdp = tela.CDP(wire)
    monkeypatch.setattr(tela.CDP, "abrir", AsyncMock(return_value=cdp))
    s = await nova(bancada)
    geracao = cdp.geracao
    await cdp.redimensionar((390, 700))
    assert cdp.eventos.qsize() == 1 and cdp.geracao == geracao + 1
    gen = svc.eventos(s)
    try:
        assert (await anext(gen))["event"] == "estado"
        q = json.loads((await asyncio.wait_for(anext(gen), 1))["data"])
        assert q["largura"] == q["viewport"]["largura"] == 390
        assert q["altura"] == q["viewport"]["altura"] == 700
    finally:
        await gen.aclose()


@pytest.fixture
async def viewport_real(bancada):
    c, svc, _ = bancada
    s = await nova(bancada)
    wire = WireViewport()
    s.cdp = tela.CDP(wire)
    await s.cdp.selecionar()
    s.fluxo = True
    yield c, svc, s, wire
    await svc.fechar(s)


async def assumir_aparelho(c, s, wire, monkeypatch, tamanho=(390, 700)):
    posse = AsyncMock()
    posse.p.returncode = None

    async def soltar():
        # O agente só recebe a trava DEPOIS de restaurar as métricas.
        assert wire.tamanho == (1920, 1080)

    posse.fechar.side_effect = soltar
    monkeypatch.setattr(tela.Posse, "abrir", AsyncMock(return_value=posse))
    r = await c.post(
        f"/api/tela-agente/sessoes/{s.id}/assumir",
        json={"largura": tamanho[0], "altura": tamanho[1]},
    )
    assert r.status_code == 200, r.text
    return posse, {"X-Tela-Controle": r.json()["controle"]}


async def test_tamanho_com_posse_reaplica_viewport_e_descarta_quadros(viewport_real, monkeypatch):
    c, svc, s, wire = viewport_real
    posse, headers = await assumir_aparelho(c, s, wire, monkeypatch)
    token = s.token
    geracao = s.cdp.geracao
    gen = svc.eventos(s)
    base = f"/api/tela-agente/sessoes/{s.id}"
    try:
        assert (await anext(gen))["event"] == "estado"
        velho = json.loads((await anext(gen))["data"])
        r = await c.post(base + "/tamanho", headers=headers, json={"largura": 700, "altura": 390})
        assert r.status_code == 200 and r.json() == {"ajustado": True}
        assert wire.tamanho == s.cdp.viewport == (700, 390)
        assert s.cdp.geracao == geracao + 1
        assert not s.quadros and s.token == token and s.posse is posse
        posse.fechar.assert_not_awaited()
        tela.Posse.abrir.assert_awaited_once()
        r = await c.post(
            base + "/entrada",
            headers=headers,
            json={"tipo": "clique", "quadro": velho["id"], "x": 0.5, "y": 0.5},
        )
        assert r.status_code == 409
        novo = json.loads((await asyncio.wait_for(anext(gen), 2))["data"])
        assert novo["viewport"] == {"largura": 700, "altura": 390}
        assert (novo["largura"], novo["altura"]) == (700, 390)
    finally:
        await gen.aclose()


@pytest.mark.parametrize("controle", ["sem-posse", "ausente", "errado", "perdido", "devolvido"])
async def test_tamanho_recusa_como_entrada_sem_controle(viewport_real, monkeypatch, controle):
    c, _, s, wire = viewport_real
    headers = {}
    base = f"/api/tela-agente/sessoes/{s.id}"
    if controle != "sem-posse":
        posse, headers = await assumir_aparelho(c, s, wire, monkeypatch)
        if controle == "ausente":
            headers = {}
        elif controle == "errado":
            headers = {"X-Tela-Controle": "incorreto"}
        elif controle == "perdido":
            posse.p.returncode = 1
        elif controle == "devolvido":
            assert (await c.post(base + "/devolver", headers=headers)).status_code == 200
    s.quadros["velho"] = (time.monotonic(), "t1", *wire.tamanho)
    tamanho = wire.tamanho
    wire.sent.clear()
    entrada = await c.post(base + "/entrada", headers=headers, json={"tipo": "texto", "texto": "x"})
    r = await c.post(base + "/tamanho", headers=headers, json={"largura": 700, "altura": 390})
    assert r.status_code == entrada.status_code == (409 if controle == "perdido" else 403)
    assert r.json() == entrada.json()
    assert wire.tamanho == tamanho and not wire.sent
    assert "velho" in s.quadros


@pytest.mark.parametrize("saida", ["devolver", "inatividade", "queda", "sem-fluxo", "cdp"])
async def test_override_e_retirada_antes_da_trava(viewport_real, monkeypatch, saida):
    c, svc, s, wire = viewport_real
    s.quadros["velho"] = (time.monotonic(), "t1", 1920, 1080)
    posse, headers = await assumir_aparelho(c, s, wire, monkeypatch)
    assert not s.quadros
    assert wire.tamanho == (390, 700)
    override = next(m for m in wire.sent if m["method"] == "Emulation.setDeviceMetricsOverride")
    assert override["params"] == {
        "width": 390,
        "height": 700,
        "deviceScaleFactor": 1,
        "mobile": False,
    }
    gen = svc.eventos(s)
    assert (await anext(gen))["event"] == "estado"
    q = json.loads((await anext(gen))["data"])
    assert q["largura"] == q["viewport"]["largura"] == 390
    r = await c.post(
        f"/api/tela-agente/sessoes/{s.id}/entrada",
        headers=headers,
        json={"tipo": "clique", "quadro": q["id"], "x": 0.5, "y": 0.25},
    )
    assert r.status_code == 200
    clique = next(m for m in wire.sent if m["method"] == "Input.dispatchMouseEvent")
    assert clique["params"]["x"] == 195 and clique["params"]["y"] == 175
    if saida == "devolver":
        assert (
            await c.post(f"/api/tela-agente/sessoes/{s.id}/devolver", headers=headers)
        ).status_code == 200
    elif saida == "queda":
        await gen.aclose()
    else:
        if saida == "inatividade":
            s.atividade -= tela.INATIVIDADE + 1
        elif saida == "sem-fluxo":
            s.fluxo_em -= tela.SEM_FLUXO + 1
        else:
            await wire.queue.put(None)
        await asyncio.wait_for(s.vigia, 2)
    assert wire.tamanho == (1920, 1080) and s.token is None
    posse.fechar.assert_awaited_once()
    if saida == "cdp":
        assert wire.fechado
    else:
        assert any(m["method"] == "Emulation.clearDeviceMetricsOverride" for m in wire.sent)
    await gen.aclose()


async def test_override_piso_e_troca_de_aba(viewport_real, monkeypatch):
    c, svc, s, wire = viewport_real
    await assumir_aparelho(c, s, wire, monkeypatch, (200, 100))
    assert wire.tamanho == (320, 320)
    wire.sent.clear()
    await svc.entrada(s, s.token, router.Aba(tipo="aba", aba="t1"))
    methods = [m["method"] for m in wire.sent]
    assert methods.index("Emulation.clearDeviceMetricsOverride") < methods.index(
        "Target.detachFromTarget"
    )
    assert methods.index("Target.attachToTarget") < methods.index(
        "Emulation.setDeviceMetricsOverride"
    )
    assert wire.tamanho == (320, 320)


async def test_limpeza_recusada_fecha_cdp_antes_de_soltar(viewport_real, monkeypatch):
    c, _, s, wire = viewport_real
    posse, headers = await assumir_aparelho(c, s, wire, monkeypatch)
    wire.falhar_limpeza = True
    r = await c.post(f"/api/tela-agente/sessoes/{s.id}/devolver", headers=headers)
    assert r.status_code == 502 and wire.fechado
    posse.fechar.assert_awaited_once()


async def test_assumir_sem_corpo_preserva_viewport(viewport_real, monkeypatch):
    c, _, s, wire = viewport_real
    posse = AsyncMock()
    posse.p.returncode = None
    monkeypatch.setattr(tela.Posse, "abrir", AsyncMock(return_value=posse))
    base = f"/api/tela-agente/sessoes/{s.id}"
    r = await c.post(base + "/assumir")
    assert r.status_code == 200 and wire.tamanho == (1920, 1080)
    assert (
        await c.post(base + "/devolver", headers={"X-Tela-Controle": r.json()["controle"]})
    ).status_code == 200
    assert not any(m["method"].startswith("Emulation.") for m in wire.sent)


async def test_quadro_em_processamento_nao_atravessa_redimensionamento(viewport_real):
    _, svc, s, _ = viewport_real
    gen = svc.eventos(s)
    assert (await anext(gen))["event"] == "estado"
    try:
        async with s.operacao:
            proximo = asyncio.create_task(anext(gen))
            # O gerador já retirou o quadro antigo e aguarda a operação em curso.
            await asyncio.sleep(0.02)
            assert not proximo.done() and s.cdp.eventos.empty()
            await s.cdp.redimensionar((390, 700))
        e = await asyncio.wait_for(proximo, 2)
        q = json.loads(e["data"])
        assert q["largura"] == q["viewport"]["largura"] == 390
    finally:
        await gen.aclose()


async def test_assumir_falha_depois_de_aplicar_restaura_e_solta(viewport_real, monkeypatch):
    c, _, s, wire = viewport_real
    posse = AsyncMock()
    posse.p.returncode = None

    async def soltar():
        assert wire.tamanho == (1920, 1080)

    posse.fechar.side_effect = soltar
    monkeypatch.setattr(tela.Posse, "abrir", AsyncMock(return_value=posse))
    iniciar = s.cdp.iniciar_quadros
    tentativas = 0

    async def falhar_uma_vez():
        nonlocal tentativas
        tentativas += 1
        if tentativas == 1:
            raise RuntimeError("resposta perdida após aplicar métricas")
        await iniciar()

    monkeypatch.setattr(s.cdp, "iniciar_quadros", falhar_uma_vez)
    r = await c.post(
        f"/api/tela-agente/sessoes/{s.id}/assumir", json={"largura": 390, "altura": 700}
    )
    assert r.status_code == 502 and s.token is None
    posse.fechar.assert_awaited_once()
    assert s.cdp.viewport is None


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"largura": 390},
        {"largura": 0, "altura": 700},
        {"largura": 390.5, "altura": 700},
        {"largura": 100000, "altura": 700},
    ],
)
async def test_aparelho_invalido_nao_assume(bancada, monkeypatch, body):
    c, _, _ = bancada
    s = await nova(bancada)
    trava = AsyncMock()
    monkeypatch.setattr(tela.Posse, "abrir", trava)
    r = await c.post(f"/api/tela-agente/sessoes/{s.id}/assumir", json=body)
    assert r.status_code == 422
    trava.assert_not_awaited()
