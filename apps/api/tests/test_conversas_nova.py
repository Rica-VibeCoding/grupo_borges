# ruff: noqa: F811 — `bancada` vem importada da F2 e entra como parâmetro
"""F5 de `docs/conversas/PLANO.md` — estacionar, Nova conversa e `/operacao`.

Mesma bancada da F2, com dois falsos:

- **tmux falso**: um agente de mentira que recebe os envios. Ao ler o pedido
  de estacionar, ele fica ocupado, chama o `POST /estacionar` de verdade (pela
  mesma app, no mesmo loop) e fica ocioso. O `/clear` troca a conversa atual.
- **relógio falso**: `operacao.relogio`/`dormir` andam sozinhos — o prazo de
  60 s do estacionar passa em menos de um segundo.
"""
from __future__ import annotations

import asyncio
import sqlite3
from types import SimpleNamespace

import httpx
import pytest
from test_conversas_lista import (  # noqa: F401 — `bancada` é fixture
    ID_CUSTOM,
    ID_NOME,
    bancada,
)

from routers import conversas as conversas_router
from services import operacao_conversa as operacao
from services import tmux_driver

ID_NOVA = "77777777-7777-4777-8777-777777777777"


class AgenteFalso:
    """O pane do Pavan: guarda o que recebeu e reage como o CC reagiria."""

    def __init__(self, bancada, cliente: httpx.AsyncClient) -> None:
        self.bancada = bancada
        self.cliente = cliente
        self.enviados: list[str] = []
        self.ocupado = False
        self.interrupcoes = 0
        #: `None` = não responde ao pedido de estacionar (agente mudo).
        self.resposta: dict | None = {"titulo": "Feed enxuto", "nota": "parou no teste"}
        #: Passos do relógio que o agente leva até chamar a rota.
        self.demora = 3
        #: Fica ocupado depois de estacionar (turno que não acaba).
        self.preso = False
        self.recusa: str | None = None
        #: Prefixo cujo envio volta `uncertain` — mas chega ao agente.
        self.incerto: str | None = None
        #: O `/clear` cria o JSONL da conversa nova.
        self.clear_pega = True
        self.passos: list[str] = []

    async def send_message(self, sessao: str, texto: str):
        assert sessao == "pavan"
        if self.recusa and texto.startswith(self.recusa):
            return tmux_driver.DeliveryResult(outcome="refused", reason="pane_incompativel")
        self.enviados.append(texto)
        if texto.startswith("[cockpit]"):
            self.passos.append(f"pedido:{operacao.estado('pavan').fase}")
            asyncio.get_running_loop().create_task(self._estacionar())
        elif texto.startswith("/clear"):
            assert not self.ocupado, "/clear mandado com o agente no meio do turno"
            self.passos.append(f"clear:{operacao.estado('pavan').fase}")
            self.bancada.atuais["pavan"] = ID_NOVA
            if self.clear_pega:
                (self.bancada.pasta / f"{ID_NOVA}.jsonl").write_text("")
        if self.incerto and texto.startswith(self.incerto):
            return tmux_driver.DeliveryResult(outcome="uncertain", reason="envio_nao_confirmado")
        return tmux_driver.DELIVERED

    async def _estacionar(self) -> None:
        self.ocupado = True
        if self.resposta is None:
            return  # ocupado e calado: o cockpit vai ter de interromper
        for _ in range(self.demora):
            await operacao.dormir(operacao.PASSO_S)
        r = await self.cliente.post("/api/agents/pavan/conversas/estacionar", json=self.resposta)
        assert r.status_code == 200, r.text
        await operacao.dormir(operacao.PASSO_S)
        self.ocupado = self.preso

    async def interrupt(self, sessao: str) -> dict:
        self.interrupcoes += 1
        self.ocupado = False
        return {"parado": True, "pedido_limpo": False}


@pytest.fixture
async def palco(bancada, monkeypatch):
    operacao.esquecer("pavan")
    relogio = SimpleNamespace(t=0.0)

    async def dormir(segundos: float) -> None:
        # Um tiquinho de tempo real por passo: a chamada HTTP do agente falso
        # atravessa a app no mesmo loop e precisa de várias voltas dele.
        relogio.t += segundos
        await asyncio.sleep(0.005)

    monkeypatch.setattr(operacao, "relogio", lambda: relogio.t)
    monkeypatch.setattr(operacao, "dormir", dormir)
    bancada.atuais["pavan"] = ID_CUSTOM

    transporte = httpx.ASGITransport(app=bancada.app)
    async with httpx.AsyncClient(transport=transporte, base_url="http://cockpit") as cliente:
        agente = AgenteFalso(bancada, cliente)
        monkeypatch.setattr(tmux_driver, "send_message", agente.send_message)
        monkeypatch.setattr(tmux_driver, "interrupt", agente.interrupt)
        monkeypatch.setattr(conversas_router, "_esta_ocupado", lambda _a: agente.ocupado)
        yield SimpleNamespace(cliente=cliente, agente=agente, relogio=relogio, bancada=bancada)
    operacao.esquecer("pavan")


def _meta(bancada, session_id: str) -> tuple | None:
    with sqlite3.connect(bancada.db.db_path) as conn:
        return conn.execute(
            "SELECT titulo, nota, estacionada_em IS NOT NULL FROM conversa_meta "
            "WHERE slug = 'pavan' AND session_id = ?",
            (session_id,),
        ).fetchone()


# ---------- POST /estacionar ----------


async def test_estacionar_grava_na_conversa_atual_e_preserva_a_estrela(palco) -> None:
    c = palco.cliente
    await c.post(f"/api/agents/pavan/conversas/{ID_CUSTOM}/estrela", json={"valor": True})
    r = await c.post(
        "/api/agents/pavan/conversas/estacionar",
        json={"titulo": "  Feed\nenxuto ", "nota": "parou no teste;\nfalta o build"},
    )
    assert r.status_code == 200
    assert r.json() == {"id": ID_CUSTOM, "titulo": "Feed enxuto",
                        "nota": "parou no teste; falta o build"}
    assert _meta(palco.bancada, ID_CUSTOM) == ("Feed enxuto", "parou no teste; falta o build", 1)
    item = next(
        i for i in (await c.get("/api/agents/pavan/conversas")).json()["conversas"]
        if i["id"] == ID_CUSTOM
    )
    assert (item["titulo"], item["titulo_origem"], item["estrela"]) == (
        "Feed enxuto", "estacionada", True,
    )


async def test_estacionar_sem_conversa_atual_e_409(palco) -> None:
    palco.bancada.atuais["pavan"] = None
    r = await palco.cliente.post(
        "/api/agents/pavan/conversas/estacionar", json={"titulo": "x", "nota": "y"}
    )
    assert r.status_code == 409


async def test_estacionar_titulo_so_de_espaco_e_422(palco) -> None:
    r = await palco.cliente.post(
        "/api/agents/pavan/conversas/estacionar", json={"titulo": " \n\t "}
    )
    assert r.status_code == 422


# ---------- POST /nova ----------


async def test_nova_com_agente_ocioso_estaciona_limpa_e_renomeia(palco) -> None:
    c, agente = palco.cliente, palco.agente
    assert (await c.get("/api/agents/pavan/conversas/operacao")).json()["fase"] is None

    r = await c.post("/api/agents/pavan/conversas/nova", json={})
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert (corpo["fase"], corpo["titulo"], corpo["nota"]) == ("pronta", "Feed enxuto", True)

    pedido, clear, rename = agente.enviados
    assert pedido.startswith("[cockpit]")
    assert "http://127.0.0.1:" in pedido and "/api/agents/pavan/conversas/estacionar" in pedido
    assert "\n" not in pedido
    # `/clear` puro: com o título, o CC o grava na conversa nova e o agente o
    # lê como pedido (F11). A nova recebe o nome do agente.
    assert clear == "/clear"
    assert rename == "/rename José Pavan"
    assert agente.passos == ["pedido:estacionando", "clear:religando"]
    assert agente.interrupcoes == 0
    assert _meta(palco.bancada, ID_CUSTOM)[:2] == ("Feed enxuto", "parou no teste")

    op = (await c.get("/api/agents/pavan/conversas/operacao")).json()
    assert op["fase"] == "pronta" and isinstance(op["desde"], int)


async def test_nova_com_agente_ocupado_e_409_sem_mandar_nada(palco) -> None:
    palco.agente.ocupado = True
    r = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={"forcar": False})
    assert (r.status_code, r.json()["detail"]) == (409, "ocupado")
    assert palco.agente.enviados == []
    assert operacao.estado("pavan") is None


async def test_nova_forcar_interrompe_e_segue_sem_nota_com_titulo_de_queda(palco) -> None:
    palco.agente.ocupado = True
    r = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={"forcar": True})
    assert r.status_code == 200, r.text
    assert (r.json()["nota"], r.json()["titulo"]) == (False, "sonda-titulo")
    assert palco.agente.interrupcoes == 1
    # Nada de pedido de estacionar: direto ao /clear; o título de queda só na resposta.
    assert palco.agente.enviados == ["/clear", "/rename José Pavan"]
    assert _meta(palco.bancada, ID_CUSTOM) is None


async def test_nova_agente_que_nao_responde_segue_com_titulo_de_queda(palco) -> None:
    palco.agente.resposta = None
    palco.bancada.atuais["pavan"] = ID_NOME  # custom-title = nome do agente → cai para o ai-title
    r = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={})
    assert r.status_code == 200, r.text
    assert (r.json()["nota"], r.json()["titulo"]) == (False, "Palavra-senha da sonda")
    # Esperou o prazo inteiro do estacionar, no relógio falso.
    assert palco.relogio.t >= operacao.PRAZO_ESTACIONAR_S
    # Ficou ocupado com o pedido e calado: interrompido antes do /clear.
    assert palco.agente.interrupcoes == 1
    assert palco.agente.enviados[1:] == ["/clear", "/rename José Pavan"]


async def test_nova_turno_que_nao_fecha_depois_de_estacionar_e_interrompido(palco) -> None:
    palco.agente.preso = True
    r = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={})
    assert r.status_code == 200 and r.json()["nota"] is True
    assert palco.agente.interrupcoes == 1
    assert palco.agente.enviados[1] == "/clear"


@pytest.mark.parametrize(
    ("titulo", "esperado"),
    [
        ('Deploy "verde" do feed', 'Deploy "verde" do feed'),
        ("Revisão da gaveta — ação", "Revisão da gaveta — ação"),
        ("linha um\nlinha dois\r\n", "linha um linha dois"),
        ("tab\tno\x1b[31mmeio", "tab no [31mmeio"),
    ],
)
async def test_titulo_fica_numa_linha_so_e_nao_vai_no_clear(
    palco, titulo: str, esperado: str
) -> None:
    palco.agente.resposta = {"titulo": titulo, "nota": "n"}
    r = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={})
    assert r.status_code == 200, r.text
    assert palco.agente.enviados[1] == "/clear"
    assert _meta(palco.bancada, ID_CUSTOM)[0] == esperado


async def test_segunda_operacao_com_uma_em_curso_e_409(palco) -> None:
    palco.agente.demora = 20
    c = palco.cliente
    primeira = asyncio.create_task(c.post("/api/agents/pavan/conversas/nova", json={}))
    while not palco.agente.enviados:  # noqa: ASYNC110 — o falso não tem evento
        await asyncio.sleep(0)
    op = (await c.get("/api/agents/pavan/conversas/operacao")).json()
    assert op["fase"] == "estacionando"
    segunda = await c.post("/api/agents/pavan/conversas/nova", json={"forcar": True})
    assert (segunda.status_code, segunda.json()["detail"]) == (409, "operacao_em_curso")
    assert (await primeira).status_code == 200
    # Terminada a primeira, a próxima entra.
    palco.bancada.atuais["pavan"] = ID_CUSTOM
    (palco.bancada.pasta / f"{ID_NOVA}.jsonl").unlink()
    assert (await c.post("/api/agents/pavan/conversas/nova", json={})).status_code == 200


async def test_clear_recusado_vira_fase_erro_legivel(palco) -> None:
    palco.agente.recusa = "/clear"
    r = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={})
    assert r.status_code == 502
    assert r.json()["fase"] == "erro" and "/clear não chegou" in r.json()["detalhe"]
    op = (await palco.cliente.get("/api/agents/pavan/conversas/operacao")).json()
    assert op["fase"] == "erro"
    # Erro não prende: a próxima tentativa entra.
    palco.agente.recusa = None
    palco.bancada.atuais["pavan"] = ID_CUSTOM
    (palco.bancada.pasta / f"{ID_NOVA}.jsonl").unlink(missing_ok=True)
    de_novo = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={})
    assert de_novo.status_code == 200


async def test_clear_incerto_com_conversa_nova_no_disco_segue_pronta(palco) -> None:
    """F11: o CC limpa a tela no Enter e a prova some; a troca tinha acontecido."""
    palco.agente.incerto = "/clear"
    r = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={})
    assert r.status_code == 200, r.text
    assert r.json()["fase"] == "pronta"
    assert palco.agente.enviados[1:] == ["/clear", "/rename José Pavan"]


async def test_clear_incerto_sem_conversa_nova_e_erro_de_entrega(palco) -> None:
    palco.agente.incerto = "/clear"
    palco.agente.clear_pega = False
    r = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={})
    assert r.status_code == 502
    assert "/clear não chegou" in r.json()["detalhe"]
    assert not any(t.startswith("/rename") for t in palco.agente.enviados)


async def test_conversa_nova_que_nao_aparece_e_erro_sem_rename(palco) -> None:
    palco.agente.clear_pega = False
    r = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={})
    assert r.status_code == 502
    assert "conversa nova não apareceu" in r.json()["detalhe"]
    assert not any(t.startswith("/rename") for t in palco.agente.enviados)


async def test_nova_com_agente_desligado_e_409(palco) -> None:
    palco.bancada.vivas.discard("pavan")
    r = await palco.cliente.post("/api/agents/pavan/conversas/nova", json={})
    assert (r.status_code, r.json()["detail"]) == (409, "desligado")


async def test_motor_nao_cc_nao_tem_nova(palco) -> None:
    r = await palco.cliente.post("/api/agents/hiro/conversas/nova", json={})
    assert (r.status_code, r.json()["detail"]) == (409, "motor_sem_conversas")


# ---------- aquecimento ----------


async def test_aquecimento_le_a_pasta_e_deixa_o_cache_pronto(palco, monkeypatch) -> None:
    from services import conversas as conversas_service

    conversas_service._cache.clear()
    await conversas_router.aquecer_cache(palco.bancada.app)
    assert any(str(palco.bancada.pasta) in chave for chave in conversas_service._cache)
