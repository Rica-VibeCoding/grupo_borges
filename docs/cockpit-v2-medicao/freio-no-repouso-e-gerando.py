"""O ■ some do repouso de agente ocioso, e continua nascendo quando ele gera?

O canarinho está `status=ocioso` com `lifecycle=trabalhando` preso — o caso que
a guarda anterior não pegava.
"""
import asyncio
import time
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:3008"


async def olha(b, slug, rot):
    page = await b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    await page.goto(f"{BASE}/agente/{slug}", wait_until="load", timeout=60000)
    await page.wait_for_timeout(5000)
    parar = await page.get_by_role("button", name="Parar", exact=False).count()
    voz = await page.get_by_role("button", name="Segure para falar", exact=False).count()
    print(f"  {rot:<10} repouso: ■={bool(parar)}  microfone={bool(voz)}", flush=True)
    await page.screenshot(path=f"/tmp/freio-{rot}.png")
    return page


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        print("=== REPOUSO ===", flush=True)
        page = await olha(b, "canarinho", "canarinho")
        await olha(b, "tara", "tara")

        print("=== GERANDO (canarinho) ===", flush=True)
        c = page.locator("textarea.ck-campo")
        await c.click()
        await c.fill(f"freio{str(int(time.time()))[-6:]}: conte de 1 a 60, um por linha")
        t0 = time.monotonic()
        await page.get_by_role("button", name="Enviar", exact=False).first.click()
        achou = None
        while time.monotonic() - t0 < 60:
            if await page.get_by_role("button", name="Parar", exact=False).count() > 0:
                achou = time.monotonic() - t0
                break
            await page.wait_for_timeout(200)
        print(f"  ■ apareceu em {achou:.2f}s" if achou else "  ■ NUNCA apareceu em 60s", flush=True)
        await page.screenshot(path="/tmp/freio-gerando.png")
        await b.close()


asyncio.run(main())
