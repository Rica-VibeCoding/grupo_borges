"""CDP remoto com posse do bh.sh; nenhum Chrome ou lock paralelo na VPS."""

from __future__ import annotations

import asyncio
import base64
import contextlib
import io
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException
from PIL import Image
from websockets.asyncio.client import connect

log = logging.getLogger(__name__)

BH = Path(
    os.getenv(
        "TELA_AGENTE_BH",
        "/home/clawd/repos/ze_claude/ze-shared/.claude/skills/browser-harness/scripts/bh.sh",
    )
)
# Identidades, não portas: estas continuam exclusivamente no case do bh.sh.
PERFIS = {
    "agente": "Agente",
    "campanha": "Campanha",
    "fluytpos": "Fluyt Pós",
    "fluytcom": "Fluyt Com",
    "fluytfin": "Fluyt Fin",
    "vinicius": "Vinicius",
}
CATALOGO = {
    **{
        ("arsenal" if p == "agente" else p + "-arsenal"): ("arsenal", "Chrome do " + n)
        for p, n in PERFIS.items()
    },
    **{
        ("omarchy" if p == "agente" else p): ("note", "Chrome do " + n)
        for p, n in PERFIS.items()
        if p != "vinicius"
    },
    "fluytpos2": ("note", "Chrome do Fluytpos2"),
    "pc": ("pc", "Chrome do agente"),
    "barsi": ("pc", "Chrome do Barsi"),
    "campanha-pc": ("pc", "Chrome da campanha"),
}
INATIVIDADE = 180
SEM_FLUXO = 20
FPS = 2
ESTADO_INTERVALO = 2
FORMATO_QUADRO = "jpeg"
QUALIDADE_QUADRO = 45
LIMITE_QUADRO = 960


async def processo(*args, env=None, limite_s=15):
    p = await asyncio.create_subprocess_exec(
        *args, env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
    )
    try:
        out, _ = await asyncio.wait_for(p.communicate(), limite_s)
        if p.returncode:
            raise HTTPException(502, "túnel/configuração do Chrome indisponível")
        return out.decode().strip()
    finally:
        if p.returncode is None:
            p.kill()
            await p.wait()


async def endereco(chrome):
    env = {**os.environ, "BH_MAQUINA": chrome}
    linha = await processo("bash", str(BH), "__cockpit_config", env=env)
    _, ssh, remota, local = linha.split("\t")
    base = f"http://127.0.0.1:{int(local)}"
    async with httpx.AsyncClient(timeout=3, trust_env=False) as client:
        try:
            r = await client.get(base + "/json/version")
            r.raise_for_status()
        except httpx.HTTPError:
            await processo(
                "ssh",
                "-f",
                "-N",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=5",
                "-o",
                "ExitOnForwardFailure=yes",
                "-o",
                "ServerAliveInterval=30",
                "-o",
                "ServerAliveCountMax=3",
                "-L",
                f"{local}:127.0.0.1:{remota}",
                ssh,
            )
            r = await client.get(base + "/json/version")
            r.raise_for_status()
        # Chrome anuncia a porta remota. O host é sempre o túnel escolhido por nós.
        path = urlsplit(r.json()["webSocketDebuggerUrl"]).path
        return f"ws://127.0.0.1:{int(local)}{path}"


class Posse:
    def __init__(self, p):
        self.p = p

    @classmethod
    async def abrir(cls, chrome):
        p = await asyncio.create_subprocess_exec(
            "bash",
            str(BH),
            "__cockpit_lock",
            env={**os.environ, "BH_MAQUINA": chrome, "BH_LOCK_WAIT": "0"},
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        posse = cls(p)
        try:
            if await asyncio.wait_for(p.stdout.readline(), 18) != b"locked\n":
                raise HTTPException(409, "Chrome ocupado por outro agente")
            return posse
        except BaseException:
            await posse.fechar()
            raise

    async def fechar(self):
        if self.p.stdin:
            self.p.stdin.close()
        try:
            await asyncio.wait_for(self.p.wait(), 3)
        except TimeoutError:
            self.p.kill()
            await self.p.wait()


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.i = 0
        self.pendentes = {}
        self.eventos = asyncio.Queue(maxsize=1)
        self.sid = None
        self.alvo = None
        self.viewport = None
        self.geracao = 0
        self.reader = asyncio.create_task(self._ler())

    @classmethod
    async def abrir(cls, chrome):
        return cls(
            await connect(
                await endereco(chrome),
                max_size=4 * 1024 * 1024,
                open_timeout=8,
                close_timeout=2,
                compression=None,
                proxy=None,
            )
        )

    async def _ler(self):
        erro = RuntimeError("CDP desconectado")
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                if "id" in msg:
                    f = self.pendentes.get(msg["id"])
                    if f and not f.done():
                        if "error" in msg:
                            f.set_exception(RuntimeError("Chrome recusou o comando"))
                        else:
                            f.set_result(msg.get("result", {}))
                elif (
                    msg.get("method") == "Page.screencastVisibilityChanged"
                    and msg.get("sessionId") == self.sid
                    and not msg["params"]["visible"]
                ):
                    if self.eventos.full():
                        self.eventos.get_nowait()
                    self.eventos.put_nowait({"trocar_ativa": True})
                elif msg.get("method") == "Page.screencastFrame":
                    # ACK sempre, inclusive quadros descartados: fila limitada não trava CDP.
                    await self.enviar(
                        "Page.screencastFrameAck",
                        {"sessionId": msg["params"]["sessionId"]},
                        msg.get("sessionId"),
                    )
                    if msg.get("sessionId") == self.sid:
                        self._enfileirar_quadro(msg["params"])
        except Exception as exc:
            erro = exc
        finally:
            for f in self.pendentes.values():
                if not f.done():
                    f.set_exception(erro)

    def _enfileirar_quadro(self, frame):
        if self.eventos.full():
            self.eventos.get_nowait()
        self.eventos.put_nowait({**frame, "_sid": self.sid, "_geracao": self.geracao})

    async def enviar(self, method, params, sid=None):
        self.i += 1
        msg = {"id": self.i, "method": method, "params": params}
        if sid:
            msg["sessionId"] = sid
        await self.ws.send(json.dumps(msg))
        return self.i

    async def cmd(self, method, params=None, *, browser=False):
        if self.reader.done():
            raise RuntimeError("CDP desconectado")
        # Não ceder entre reservar id e registrar o future.
        mid = self.i + 1
        f = asyncio.get_running_loop().create_future()
        self.pendentes[mid] = f
        try:
            await self.enviar(method, params or {}, None if browser else self.sid)
            return await asyncio.wait_for(f, 8)
        finally:
            self.pendentes.pop(mid, None)

    async def abas(self):
        r = await self.cmd("Target.getTargets", browser=True)
        return [
            {"id": t["targetId"], "titulo": t["title"], "url": t["url"]}
            for t in r["targetInfos"]
            if t["type"] == "page"
        ]

    async def selecionar(self, alvo=None, assumir=False):
        abas = await self.abas()
        if not abas:
            raise HTTPException(409, "Chrome sem abas")
        if alvo and alvo not in {a["id"] for a in abas}:
            raise HTTPException(404, "aba não existe")
        if self.sid:
            if self.viewport:
                # A emulação pertence ao target: nunca deixar ajuste na aba anterior.
                await self.cmd("Emulation.clearDeviceMetricsOverride")
            with contextlib.suppress(Exception):
                await self.cmd("Page.stopScreencast")
                await self.cmd("Target.detachFromTarget", {"sessionId": self.sid}, browser=True)
            self.sid = None
        # CDP não informa 'active' em TargetInfo. Descobre visibilityState sem ativar.
        visivel = None
        for aba in [a for a in abas if a["id"] == alvo] if alvo else abas:
            r = await self.cmd(
                "Target.attachToTarget", {"targetId": aba["id"], "flatten": True}, browser=True
            )
            sid = r["sessionId"]
            self.sid = sid
            r = await self.cmd(
                "Runtime.evaluate",
                {
                    "expression": "document.hasFocus() ? 'focused' : document.visibilityState",
                    "returnByValue": True,
                },
            )
            if alvo or r["result"].get("value") == "focused":
                self.alvo = aba["id"]
                break
            if r["result"].get("value") == "visible" and visivel is None:
                visivel = aba["id"]
            await self.cmd("Target.detachFromTarget", {"sessionId": sid}, browser=True)
            self.sid = None
        if not self.sid and visivel:
            self.sid = (
                await self.cmd(
                    "Target.attachToTarget", {"targetId": visivel, "flatten": True}, browser=True
                )
            )["sessionId"]
            self.alvo = visivel
        if not self.sid:
            # Uma janela minimizada pode não ter página visível; não rouba foco só para ver.
            raise HTTPException(409, "nenhuma aba visível; abra a janela do Chrome")
        if assumir:
            await self.cmd("Page.bringToFront")
        if self.viewport:
            await self._aplicar_viewport()
        await self.iniciar_quadros()

    async def _aplicar_viewport(self):
        largura, altura = self.viewport
        await self.cmd(
            "Emulation.setDeviceMetricsOverride",
            {"width": largura, "height": altura, "deviceScaleFactor": 1, "mobile": False},
        )

    async def redimensionar(self, viewport):
        if viewport is None and self.viewport is None:
            return
        await self.cmd("Page.stopScreencast")
        if viewport:
            # Marca antes do envio: até uma resposta perdida exige limpeza.
            self.viewport = (max(320, viewport[0]), max(320, viewport[1]))
            await self._aplicar_viewport()
        else:
            await self.cmd("Emulation.clearDeviceMetricsOverride")
            self.viewport = None
        # Descarta quadros das métricas anteriores e força quadro de página estática.
        await self.iniciar_quadros()

    async def viewport_css(self):
        if self.viewport:
            # O JPEG inclui a barra; cssVisualViewport.clientWidth a exclui.
            # innerWidth/Height correspondem à imagem inteira, inclusive com zoom.
            r = await self.cmd(
                "Runtime.evaluate",
                {
                    "expression": "({clientWidth:innerWidth,clientHeight:innerHeight})",
                    "returnByValue": True,
                },
            )
            return r["result"]["value"]
        return (await self.cmd("Page.getLayoutMetrics"))["cssVisualViewport"]

    async def iniciar_quadros(self):
        self.geracao += 1
        while not self.eventos.empty():
            self.eventos.get_nowait()
        await self.cmd("Page.enable")
        # Página estática pode nunca repintar. Semeia a mesma fila antes do fluxo;
        # qualquer quadro vivo posterior o substitui, sem regredir a imagem.
        try:
            frame = await self.cmd(
                "Page.captureScreenshot",
                {
                    "format": FORMATO_QUADRO,
                    "quality": QUALIDADE_QUADRO,
                    "captureBeyondViewport": False,
                },
            )
            # captureScreenshot não tem maxWidth/maxHeight. Limita o viewport inteiro
            # após capturar, sem recortar barras nem depender de zoom/deviceScaleFactor.
            with Image.open(io.BytesIO(base64.b64decode(frame["data"]))) as img:
                if max(img.size) > LIMITE_QUADRO:
                    img.thumbnail((LIMITE_QUADRO, LIMITE_QUADRO), Image.Resampling.LANCZOS)
                    out = io.BytesIO()
                    img.save(out, format=FORMATO_QUADRO, quality=QUALIDADE_QUADRO)
                    frame["data"] = base64.b64encode(out.getvalue()).decode()
            self._enfileirar_quadro(frame)
        except Exception:
            # O quadro inicial é melhor-esforço; nunca impedir o fluxo ou a devolução.
            log.warning("Captura inicial indisponível; seguindo com o screencast", exc_info=True)
        await self.cmd(
            "Page.startScreencast",
            {
                "format": FORMATO_QUADRO,
                "quality": QUALIDADE_QUADRO,
                "maxWidth": LIMITE_QUADRO,
                "maxHeight": LIMITE_QUADRO,
                "everyNthFrame": 1,
            },
        )

    async def fechar(self):
        try:
            if self.viewport:
                with contextlib.suppress(Exception):
                    await self.cmd("Emulation.clearDeviceMetricsOverride")
        finally:
            # Desanexar também desativa emulação se o comando não teve resposta.
            await self.ws.close()
            self.reader.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.reader


@dataclass
class Sessao:
    id: str
    chrome: str
    dono: str
    cdp: CDP
    criada: float = field(default_factory=time.monotonic)
    atividade: float = field(default_factory=time.monotonic)
    fluxo_em: float = field(default_factory=time.monotonic)
    posse: Posse | None = None
    token: str | None = None
    fluxo: bool = False
    fechada: bool = False
    quadros: dict = field(default_factory=dict)
    sequencia: int = 0
    pedido_id: str | None = None
    operacao: asyncio.Lock = field(default_factory=asyncio.Lock)
    encerramento: asyncio.Lock = field(default_factory=asyncio.Lock)
    vigia: asyncio.Task | None = None


class ServicoTela:
    def __init__(self):
        self.sessoes = {}
        self.criando = set()

    async def abrir(self, chrome, dono, pedido_id=None):
        if chrome not in CATALOGO:
            raise HTTPException(404, "Chrome desconhecido")
        pedido = pedidos.obter(pedido_id) if pedido_id else pedidos.pendente(chrome)
        if pedido and (pedido.chrome != chrome or pedido.terminado.is_set()):
            raise HTTPException(409, "pedido não está pendente neste Chrome")
        if chrome in self.criando or any(s.chrome == chrome for s in self.sessoes.values()):
            raise HTTPException(409, "já existe uma tela aberta para este Chrome")
        self.criando.add(chrome)
        cdp = None
        try:
            cdp = await CDP.abrir(chrome)
            await cdp.selecionar()
            s = Sessao(uuid.uuid4().hex, chrome, dono, cdp)
            s.pedido_id = pedido.id if pedido else None
            self.sessoes[s.id] = s
            s.vigia = asyncio.create_task(self._vigiar(s))
            return s
        except BaseException:
            if cdp:
                await cdp.fechar()
            raise
        finally:
            self.criando.discard(chrome)

    def obter(self, sid, dono):
        s = self.sessoes.get(sid)
        if not s or s.fechada:
            raise HTTPException(410, "tela encerrada; abra outra sessão")
        if s.dono != dono:
            raise HTTPException(403, "tela de outra identidade")
        return s

    def controlar(self, s, token):
        if not token or not s.token or token != s.token or not s.posse:
            raise HTTPException(403, "assuma antes de enviar entrada")
        if s.posse.p.returncode is not None:
            raise HTTPException(409, "a trava foi perdida; devolva e assuma novamente")

    async def assumir(self, s, viewport=None):
        async with s.operacao:
            if not s.fluxo or time.monotonic() - s.fluxo_em > SEM_FLUXO:
                raise HTTPException(409, "conecte os quadros antes de assumir")
            if s.posse:
                raise HTTPException(409, "esta tela já está assumida")
            posse = await Posse.abrir(s.chrome)
            if s.fechada:
                await posse.fechar()
                raise HTTPException(410, "tela encerrada durante a espera da trava")
            s.posse = posse
            s.token = uuid.uuid4().hex
            s.atividade = time.monotonic()
            try:
                await s.cdp.cmd("Page.bringToFront")
                if viewport:
                    await s.cdp.redimensionar(viewport)
                    s.quadros.clear()
            except BaseException:
                await self.devolver(s)
                raise
            if s.pedido_id:
                p = pedidos.obter(s.pedido_id)
                if not p.terminado.is_set():
                    p.status = "em_atendimento"
            return s.token

    async def devolver(self, s):
        import anyio

        with anyio.CancelScope(shield=True):
            try:
                if s.posse:
                    try:
                        await s.cdp.redimensionar(None)
                    except BaseException:
                        # Fecha o CDP antes de entregar a trava se a limpeza falhar.
                        await s.cdp.fechar()
                        raise
            finally:
                posse, s.posse, s.token = s.posse, None, None
                s.quadros.clear()
                if posse:
                    await posse.fechar()

    async def encerrar(self, sid, dono):
        s = self.sessoes.get(sid)
        if s is None:
            return
        if s.dono != dono:
            raise HTTPException(403, "tela de outra identidade")
        await self.fechar(s)

    async def fechar(self, s):
        import anyio

        with anyio.CancelScope(shield=True):
            # SSE, vigia e DELETE aguardam a mesma limpeza, inclusive após fechada=True.
            async with s.encerramento:
                if s.fechada:
                    return
                s.fechada = True
                if s.vigia and s.vigia is not asyncio.current_task():
                    s.vigia.cancel()
                async with s.operacao:
                    try:
                        with contextlib.suppress(Exception):
                            await self.devolver(s)
                    finally:
                        try:
                            await s.cdp.fechar()
                        finally:
                            self.sessoes.pop(s.id, None)
                            if s.pedido_id:
                                p = pedidos.pedidos.get(s.pedido_id)
                                if p and not p.terminado.is_set():
                                    p.status = "aguardando"

    async def _vigiar(self, s):
        try:
            while not s.fechada:
                await asyncio.sleep(1)
                agora = time.monotonic()
                if (
                    agora - s.fluxo_em > SEM_FLUXO
                    or (s.posse and agora - s.atividade > INATIVIDADE)
                    or s.cdp.reader.done()
                ):
                    await self.fechar(s)
        except asyncio.CancelledError:
            pass

    async def eventos(self, s):
        ultimo = 0
        estado_em = float("-inf")
        try:
            while not s.fechada:
                s.fluxo_em = time.monotonic()
                if s.fluxo_em - estado_em >= ESTADO_INTERVALO:
                    estado_em = s.fluxo_em
                    yield self.estado(s)
                try:
                    frame = await asyncio.wait_for(
                        s.cdp.eventos.get(),
                        max(0.01, estado_em + ESTADO_INTERVALO - time.monotonic()),
                    )
                except TimeoutError:
                    continue
                agora = time.monotonic()
                await asyncio.sleep(max(0, ultimo + 1 / FPS - agora))
                # Durante a espera, prioriza o quadro mais recente.
                while not s.cdp.eventos.empty():
                    frame = s.cdp.eventos.get_nowait()
                ultimo = time.monotonic()
                async with s.operacao:
                    if s.fechada:
                        break
                    if frame.get("trocar_ativa"):
                        await s.cdp.selecionar()
                        s.quadros.clear()
                        continue
                    if (
                        frame.get("_sid", s.cdp.sid) != s.cdp.sid
                        or frame.get("_geracao", s.cdp.geracao) != s.cdp.geracao
                    ):
                        continue
                    viewport = await s.cdp.viewport_css()
                    with Image.open(io.BytesIO(base64.b64decode(frame["data"]))) as img:
                        largura, altura = img.size
                    s.sequencia += 1
                    qid = str(s.sequencia)
                    s.quadros[qid] = (
                        ultimo,
                        s.cdp.alvo,
                        viewport["clientWidth"],
                        viewport["clientHeight"],
                    )
                    s.quadros = dict(list(s.quadros.items())[-4:])
                    corpo = {
                        "id": qid,
                        "aba": s.cdp.alvo,
                        "jpeg": frame["data"],
                        "largura": largura,
                        "altura": altura,
                        "viewport": {
                            "largura": viewport["clientWidth"],
                            "altura": viewport["clientHeight"],
                        },
                    }
                yield {"event": "quadro", "data": json.dumps(corpo, separators=(",", ":"))}
            yield self.estado(s)
        finally:
            # Starlette cancela o gerador ao desconectar; a limpeza precisa sobreviver.
            import anyio

            with anyio.CancelScope(shield=True):
                await self.fechar(s)

    def estado(self, s):
        return {
            "event": "estado",
            "data": json.dumps(
                {
                    "assumido": bool(s.posse) and not s.fechada,
                    "aba": s.cdp.alvo,
                    "pedido": pedidos.obter(s.pedido_id).corpo() if s.pedido_id else None,
                }
            ),
        }

    async def entrada(self, s, token, pedido):
        async with s.operacao:
            self.controlar(s, token)
            tipo = pedido.tipo
            if tipo in ("clique", "rolagem"):
                q = s.quadros.get(pedido.quadro)
                if (
                    not q
                    or q[1] != s.cdp.alvo
                    or (time.monotonic() - q[0] > 10 and pedido.quadro != str(s.sequencia))
                ):
                    raise HTTPException(409, "quadro antigo; espere outro quadro")
                viewport = await s.cdp.viewport_css()
                if (
                    abs(viewport["clientWidth"] - q[2]) > 1
                    or abs(viewport["clientHeight"] - q[3]) > 1
                ):
                    raise HTTPException(409, "viewport mudou; espere outro quadro")
                x, y = pedido.x * q[2], pedido.y * q[3]
                if tipo == "clique":
                    await s.cdp.cmd(
                        "Input.dispatchMouseEvent",
                        {
                            "type": "mousePressed",
                            "x": x,
                            "y": y,
                            "button": "left",
                            "buttons": 1,
                            "clickCount": 1,
                        },
                    )
                    await s.cdp.cmd(
                        "Input.dispatchMouseEvent",
                        {
                            "type": "mouseReleased",
                            "x": x,
                            "y": y,
                            "button": "left",
                            "buttons": 0,
                            "clickCount": 1,
                        },
                    )
                else:
                    await s.cdp.cmd(
                        "Input.dispatchMouseEvent",
                        {
                            "type": "mouseWheel",
                            "x": x,
                            "y": y,
                            "deltaX": pedido.delta_x,
                            "deltaY": pedido.delta_y,
                        },
                    )
            elif tipo == "texto":
                await s.cdp.cmd("Input.insertText", {"text": pedido.texto})
            elif tipo == "tecla":
                codigo = {"Enter": 13, "Tab": 9, "Backspace": 8}[pedido.tecla]
                for acao in ("keyDown", "keyUp"):
                    await s.cdp.cmd(
                        "Input.dispatchKeyEvent",
                        {
                            "type": acao,
                            "key": pedido.tecla,
                            "code": pedido.tecla,
                            "windowsVirtualKeyCode": codigo,
                            **(
                                {"text": "\r"}
                                if pedido.tecla == "Enter" and acao == "keyDown"
                                else {}
                            ),
                        },
                    )
            elif tipo == "aba":
                await s.cdp.selecionar(pedido.aba, assumir=True)
                s.quadros.clear()
            s.atividade = time.monotonic()

    async def shutdown(self):
        for s in list(self.sessoes.values()):
            await self.fechar(s)


servico = ServicoTela()


def titulo_aviso(texto):
    motivo = texto.splitlines()[0].strip() if texto.strip() else ''
    busca = motivo.casefold()
    if 'captcha' in busca or 'desafio de imagens' in busca:
        return 'Tela do agente: resolver desafio de imagens' + (' na Receita' if 'receita' in busca else '')
    if 'forma de pagamento' in busca:
        return 'Tela do agente: cadastrar forma de pagamento' + (' no Google Ads' if 'google ads' in busca else '')
    if any(acao in busca for acao in ('entrar', 'login', 'acessar')):
        servico = next((nome for nome in ('Mercado Livre', 'Vercel', 'Google') if nome.casefold() in busca), None)
        return 'Tela do agente: acessar a conta' + (f' em {servico}' if servico else '')
    return motivo if len(motivo) <= 90 else 'Tela do agente precisa da sua ação; conferir o pedido no detalhe'


async def avisar(agente, texto):
    """Resumo persiste o evento e confirma o envio urgente; sem token neste serviço."""
    import sys

    resumo = BH.parents[4] / "scripts" / "resumo"
    codigo = (
        "import sys;sys.path.insert(0,sys.argv[1]);from resumo import registrar_evento;"
        "sys.exit(0 if registrar_evento(sys.argv[2],'tela-agente',sys.argv[3],nivel='urgente',tipo='decisao',"
        "titulo=sys.argv[4],detalhe=sys.argv[3]) is True else 1)"
    )
    try:
        await processo(sys.executable, "-c", codigo, str(resumo), agente, texto, titulo_aviso(texto), limite_s=20)
        return True
    except (HTTPException, TimeoutError, OSError):
        return False


@dataclass
class PedidoHumano:
    id: str
    chrome: str
    motivo: str
    agente: str
    prazo_s: int
    criado_em: float = field(default_factory=time.time)
    status: str = "aguardando"
    aviso_enviado: bool = False
    terminado: asyncio.Event = field(default_factory=asyncio.Event)
    timer: asyncio.Task | None = None

    def corpo(self):
        maquina = CATALOGO[self.chrome][0]
        return {
            "id": self.id,
            "chrome": self.chrome,
            "motivo": self.motivo,
            "agente": self.agente,
            "prazo_s": self.prazo_s,
            "expira_em": self.criado_em + self.prazo_s,
            "status": self.status,
            "aviso_enviado": self.aviso_enviado,
            "url": f"https://borges.tailfe77db.ts.net:3446/maquinas/{maquina}/chrome/{self.chrome}?pedido={self.id}",
        }


class PedidosHumanos:
    def __init__(self):
        self.pedidos = {}

    def pendente(self, chrome):
        return next(
            (p for p in self.pedidos.values() if p.chrome == chrome and not p.terminado.is_set()),
            None,
        )

    def obter(self, pid):
        p = self.pedidos.get(pid)
        if not p:
            raise HTTPException(410, "pedido encerrado ou API reiniciada")
        return p

    async def criar(self, chrome, motivo, agente, prazo_s, *, teste=False):
        if chrome not in CATALOGO:
            raise HTTPException(404, "Chrome desconhecido")
        if self.pendente(chrome):
            raise HTTPException(409, "já existe pedido pendente para este Chrome")
        p = PedidoHumano(uuid.uuid4().hex, chrome, motivo, agente, prazo_s)
        # Retenção limitada em memória; o evento urgente é persistido pelo resumo.
        referenciados = {s.pedido_id for s in servico.sessoes.values()}
        for antigo in list(self.pedidos.values()):
            if len(self.pedidos) < 128:
                break
            if antigo.terminado.is_set() and antigo.id not in referenciados:
                self.pedidos.pop(antigo.id, None)
        self.pedidos[p.id] = p
        for s in servico.sessoes.values():
            if s.chrome == chrome:
                s.pedido_id = p.id
                if s.posse:
                    p.status = "em_atendimento"
        p.timer = asyncio.create_task(self._prazo(p))
        if not teste:
            p.aviso_enviado = await avisar(
                agente, f"{motivo}\nChrome: {chrome}\n{p.corpo()['url']}"
            )
        return p

    async def _prazo(self, p):
        try:
            try:
                await asyncio.wait_for(p.terminado.wait(), p.prazo_s)
                return
            except TimeoutError:
                pass
            # Primeiro libera o Chrome, só então o agente pode sair da espera.
            for s in list(servico.sessoes.values()):
                if s.pedido_id == p.id:
                    await servico.fechar(s)
            self.concluir(p, "expirado")
        except asyncio.CancelledError:
            pass

    def concluir(self, p, status):
        if p.terminado.is_set():
            return
        p.status = status
        p.terminado.set()

    async def esperar(self, p):
        while not p.terminado.is_set():
            yield {"event": "estado", "data": json.dumps(p.corpo())}
            try:
                await asyncio.wait_for(p.terminado.wait(), 5)
            except TimeoutError:
                pass
        yield {"event": "terminado", "data": json.dumps(p.corpo())}

    async def shutdown(self):
        for p in self.pedidos.values():
            self.concluir(p, "interrompido")
        await asyncio.gather(
            *(p.timer for p in self.pedidos.values() if p.timer), return_exceptions=True
        )


pedidos = PedidosHumanos()
