"""OS DOIS BURACOS, medidos em segundos, nos DOIS cenários.

1. Entre o Enter e a minha mensagem aparecer no feed — o que o Rica lê como
   "engoliu": o campo esvazia e a tela não mostra nada.
2. Entre o Enter e o botão ■ aparecer — depende do `lifecycle_status`, que vem
   de poll.

Cenário A: agente OCIOSO. Cenário B: agente OCUPADO (o caso do Rica — ele
manda enquanto o agente trabalha; o CLI enfileira internamente e o eco `user`
só nasce quando a fila drena).
"""
import asyncio
import json
import subprocess
import sys
import time
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:3008"
API = "http://127.0.0.1:8000"
IPHONE = {"width": 390, "height": 844}


def lifecycle(slug):
    try:
        out = subprocess.run(["curl", "-s", f"{API}/api/fleet"],
                             capture_output=True, text=True, timeout=10).stdout
        for a in json.loads(out):
            if a.get("slug") == slug:
                return a.get("lifecycle_status")
    except Exception:
        pass
    return None


async def mede(page, slug, rot, cenario, texto_extra=""):
    c = page.locator("textarea.ck-campo")
    marca = f"b{rot}{cenario}{str(int(time.time()))[-6:]}"

    await c.click()
    await c.fill(f"{marca}{texto_extra}")
    t0 = time.monotonic()
    await page.keyboard.press("Enter")

    t_campo = t_bolha = t_botao = t_api = None
    while time.monotonic() - t0 < 100:
        agora = time.monotonic() - t0
        if t_campo is None and (await c.input_value()) == "":
            t_campo = agora
        if t_bolha is None and marca in (await page.locator("body").inner_text()):
            t_bolha = agora
        if t_botao is None and await page.get_by_role("button", name="Parar", exact=False).count() > 0:
            t_botao = agora
        if t_api is None and lifecycle(slug) == "trabalhando":
            t_api = agora
        if t_bolha is not None and t_botao is not None:
            break
        await page.wait_for_timeout(400)

    def s(v):
        return "nunca em 100s" if v is None else f"{v:.1f}s"

    print(f"\n--- {rot} · {cenario} ---", flush=True)
    print(f"  campo esvaziou ............. {s(t_campo)}", flush=True)
    print(f"  MINHA bolha no feed ........ {s(t_bolha)}", flush=True)
    print(f"  botao ■ na tela ............ {s(t_botao)}", flush=True)
    print(f"  lifecycle=trabalhando (API)  {s(t_api)}", flush=True)
    if t_campo is not None and t_bolha is not None:
        print(f"  >> TELA MUDA: {t_bolha - t_campo:.1f}s", flush=True)
    elif t_bolha is None:
        print("  >> TELA MUDA: mais de 100s", flush=True)
    await page.screenshot(path=f"/tmp/buraco-{rot}-{cenario}.png")
    return marca


async def roda(browser, slug, rot):
    page = await browser.new_page(viewport=IPHONE, device_scale_factor=2)
    await page.goto(f"{BASE}/agente/{slug}", wait_until="load", timeout=60000)
    await page.wait_for_timeout(4500)

    print(f"\n========== {rot} ({slug}) ==========", flush=True)
    # A — agente ocioso
    await mede(page, slug, rot, "ocioso", ": responda so OK")
    # espera o turno acabar
    await page.wait_for_timeout(12000)
    # B — agente ocupado: primeiro um pedido longo, depois a mensagem medida
    c = page.locator("textarea.ck-campo")
    await c.click()
    await c.fill(f"ocupa{rot}: conte devagar de 1 ate 400, um numero por linha")
    await page.keyboard.press("Enter")
    await page.wait_for_timeout(9000)
    await mede(page, slug, rot, "ocupado", ": responda so OK2")
    await page.close()


async def main():
    alvos = sys.argv[1:] or ["canarinho:cc", "tara:codex"]
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for alvo in alvos:
            slug, rot = alvo.split(":")
            await roda(b, slug, rot)
        await b.close()


asyncio.run(main())
