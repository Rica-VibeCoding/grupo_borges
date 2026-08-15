"""O 409 do pane vira espera, e não vermelho — mas só enquanto for passageiro.

O defeito que o Rica viveu em 15/08: mandou, deu parar, mandou de novo, e o
composer ficou vermelho pedindo intervenção — quando a entrega seguinte, sem
conserto nenhum, voltou 200.

A condição real do 409 **não reproduz** (por `curl`, input → interromper →
input imediato devolve 200), então ela é injetada por `page.route`. Injetar aqui
é honesto porque o que está sob teste é a reação do composer à recusa, não a
causa dela — essa é outra frente, e continua aberta.

As duas metades importam igualmente:

  A  409 na primeira tentativa, 200 depois  → a faixa vermelha NÃO aparece
  B  409 em todas                           → a faixa vermelha APARECE

Sem o B, o A provaria apenas que o defeito foi escondido.

Armadilhas de bancada já pagas (`cockpit-v2-composer.md` §7): clicar o botão,
nunca apertar Enter (com `pointer: coarse` o Enter quebra linha), e localizar
pelo papel do botão em vez de por texto solto, que casa com o conteúdo do
próprio textarea.
"""
import asyncio
import time

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:3008"
AGENTE = "canarinho"
# Somados 4,2 s de espera mais os POSTs; 12 s dá folga sem esticar a bancada.
JANELA_S = 12


async def roda(browser, sempre_409: bool, rotulo: str) -> tuple[int, bool]:
    page = await browser.new_page(
        viewport={"width": 390, "height": 844}, device_scale_factor=2
    )
    posts = 0

    async def intercepta(route):
        nonlocal posts
        posts += 1
        if sempre_409 or posts == 1:
            await route.fulfill(
                status=409,
                content_type="application/json",
                body='{"detail":"agent_pane_unavailable"}',
            )
        else:
            await route.continue_()

    await page.route(f"**/api/agents/{AGENTE}/input", intercepta)
    await page.goto(f"{BASE}/agente/{AGENTE}", wait_until="load", timeout=60000)
    await page.wait_for_timeout(3000)

    campo = page.locator("textarea.ck-campo")
    await campo.click()
    await campo.fill(f"recusa{str(int(time.time()))[-6:]}: responda apenas OK")
    await page.get_by_role("button", name="Enviar", exact=False).first.click()

    # O botão que o Rica viu. Papel + nome: não casa com o texto do textarea.
    vermelho = page.get_by_role("button", name="Tentar de novo", exact=False)
    apareceu = False
    t0 = time.monotonic()
    while time.monotonic() - t0 < JANELA_S:
        if await vermelho.count() > 0:
            apareceu = True
            break
        await page.wait_for_timeout(200)

    await page.screenshot(path=f"/tmp/recusa-{rotulo}.png")
    print(f"  {rotulo:<28} POSTs={posts}  'Tentar de novo'={apareceu}", flush=True)
    await page.close()
    return posts, apareceu


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        print("=== A · 409 só na primeira ===", flush=True)
        posts_a, vermelho_a = await roda(b, sempre_409=False, rotulo="passageiro")

        print("=== B · 409 em todas ===", flush=True)
        posts_b, vermelho_b = await roda(b, sempre_409=True, rotulo="teimoso")

        await b.close()

    print()
    ok_a = posts_a >= 2 and not vermelho_a
    ok_b = posts_b >= 2 and vermelho_b
    print(f"A · recupera sozinha .......... {'PASSOU' if ok_a else 'FALHOU'}")
    print(f"B · desiste e avisa ........... {'PASSOU' if ok_b else 'FALHOU'}")


asyncio.run(main())
