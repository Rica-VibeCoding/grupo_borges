"""Prova opt-in na API e no Chrome reais, sem reiniciar serviço.

TELA_AGENTE_API_TESTE_REAL=http://127.0.0.1:8002 .venv/bin/pytest -q -s tests/test_tela_agente_real.py
A demo precisa estar aberta no arsenal. O teste assume a posse normal do harness,
acrescenta espaço temporário à página e restaura tudo, inclusive quando falha.
"""

import asyncio
import contextlib
import json
import os

import httpx
import pytest

from services import tela_agente as tela

API = os.getenv("TELA_AGENTE_API_TESTE_REAL")
pytestmark = pytest.mark.skipif(not API, reason="exige API e Chrome reais; execução explícita")


async def harness(codigo):
    p = await asyncio.create_subprocess_exec(
        "bash",
        str(tela.BH),
        env={**os.environ, "BH_MAQUINA": "arsenal", "BH_ALVO": "hcaptcha"},
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(p.communicate(codigo.encode()), 30)
        assert p.returncode == 0, err.decode()
        return out.decode().splitlines()
    finally:
        if p.returncode is None:
            p.kill()
            await p.wait()


PREPARAR = r'''
import json
assert js("location.href") == "https://accounts.hcaptcha.com/demo"
assert not js("Boolean(window.__telaTesteReal)")
js("""window.__telaTesteReal = {
    altura: document.body.style.minHeight, largura: document.body.style.minWidth,
    x: scrollX, y: scrollY, maxX: 0, maxY: 0, clicou: false
};
__telaTesteReal.registrar = e => {
    const p = __telaTesteReal;
    if (innerWidth === 375 && innerHeight === 560) {
        p.maxX = Math.max(p.maxX, scrollX);
        p.maxY = Math.max(p.maxY, scrollY);
        if (e.type === 'click' && e.isTrusted && e.target.id === 'ignored1')
            p.clicou = document.activeElement.id === 'ignored1';
    }
};
for (const evento of ['scroll', 'click'])
    addEventListener(evento, __telaTesteReal.registrar, {passive: true});
__telaTesteReal.restaurar = () => {
    const p = __telaTesteReal;
    for (const evento of ['scroll', 'click']) removeEventListener(evento, p.registrar);
    document.body.style.minHeight = p.altura;
    document.body.style.minWidth = p.largura;
    scrollTo(p.x,p.y);
    delete window.__telaTesteReal;
};""")
try:
    cdp('Emulation.setDeviceMetricsOverride', width=375, height=560, deviceScaleFactor=1, mobile=False)
    original = js("({altura:innerHeight,conteudo:document.documentElement.scrollHeight})")
    js("document.body.style.minHeight='2000px';document.body.style.minWidth='1000px';scrollTo(0,0)")
    campo = js("""(()=>{
        const r = document.getElementById('ignored1').getBoundingClientRect();
        return {x:(r.x+r.width/2)/innerWidth,y:(r.y+r.height/2)/innerHeight};
    })()""")
    print(json.dumps({'original':original,'campo':campo}))
except BaseException:
    js('__telaTesteReal.restaurar()')
    raise
finally:
    cdp('Emulation.clearDeviceMetricsOverride')
'''

RECOLHER = r'''
try:
    print(js("scrollY"))
    print(js("JSON.stringify({maxX:__telaTesteReal.maxX,maxY:__telaTesteReal.maxY,clicou:__telaTesteReal.clicou})"))
finally:
    js('__telaTesteReal.restaurar()')
'''


async def test_api_real_rola_nos_dois_eixos_e_preserva_clique():
    # O harness e assumir usam a MESMA trava. Instrumenta antes, lê depois do
    # DELETE: não furar a posse nem fazer uma segunda conexão disputar a página.
    preparado = None
    async with httpx.AsyncClient(base_url=API, timeout=20, trust_env=False) as c:
        base, fluxo = None, None
        ultimo = {}

        async def quadros():
            async with c.stream("GET", base + "/quadros", timeout=None) as resposta:
                resposta.raise_for_status()
                evento = ""
                async for linha in resposta.aiter_lines():
                    if linha.startswith("event: "):
                        evento = linha[7:]
                    elif linha.startswith("data: ") and evento == "quadro":
                        ultimo.clear()
                        ultimo.update(json.loads(linha[6:]))

        async def esperar(condicao):
            async with asyncio.timeout(12):
                while not condicao():
                    if fluxo.done():
                        await fluxo
                        pytest.fail("fluxo de quadros encerrado")
                    await asyncio.sleep(0.05)

        async def post(caminho, **kwargs):
            r = await c.post(caminho, **kwargs)
            if r.status_code == 409:
                await asyncio.sleep(60)
                r = await c.post(caminho, **kwargs)
            r.raise_for_status()
            return r.json()

        try:
            s = await post("/api/tela-agente/chromes/arsenal/sessoes")
            base = "/api/tela-agente/sessoes/" + s["id"]
            preparado = json.loads((await harness(PREPARAR))[-1])
            fluxo = asyncio.create_task(quadros())
            await esperar(lambda: bool(ultimo))
            controle = await post(base + "/assumir", json={"largura": 375, "altura": 560})
            headers = {"X-Tela-Controle": controle["controle"]}
            await esperar(lambda: ultimo["viewport"] == {"largura": 375, "altura": 560})
            for dx, dy in [(80, 200), (0, 200), (-80, -400)]:
                await post(base + "/entrada", headers=headers, json={
                    "tipo": "rolagem", "quadro": ultimo["id"], "x": 0.4, "y": 0.2,
                    "delta_x": dx, "delta_y": dy,
                })
                # Espera o compositor e o evento scroll; não confundir o ACK CDP
                # com a prova de efeito, que vem das medições da própria página.
                await asyncio.sleep(0.5)
            await post(base + "/entrada", headers=headers, json={
                "tipo": "clique", "quadro": ultimo["id"], **preparado["campo"],
            })
            await asyncio.sleep(0.2)
        finally:
            try:
                if base:
                    (await c.delete(base)).raise_for_status()
            finally:
                try:
                    if fluxo:
                        fluxo.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await fluxo
                finally:
                    if preparado:
                        linhas = await harness(RECOLHER)
                        prova = json.loads(linhas[-1])
                        print(json.dumps({**preparado, **prova}, ensure_ascii=False))
    assert prova["maxY"] >= 380, prova
    assert prova["maxX"] >= 60, prova
    assert prova["clicou"], prova
