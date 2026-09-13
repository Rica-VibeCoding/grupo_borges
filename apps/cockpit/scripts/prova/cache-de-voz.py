"""Prova do cache de reprodução da bolha de voz — o mesmo texto se paga UMA vez.

Duas perguntas na mesma rodada, e as duas custam dinheiro pra responder errado:
  1. a síntese aparece no contador (`tts-uso.jsonl`) com a voz certa do agente
  2. o SEGUNDO toque na MESMA bolha não abre stream nem grava linha nova

Duas armadilhas que custaram 3.628 caracteres de Google até esta forma ficar de
pé (12/09):

- **O rótulo da bolha troca no INÍCIO da fala, não no fim.** Esperar o
  `aria-label` virar "resposta em áudio" solta o segundo clique no meio da
  síntese, onde ele vira PAUSA — e o "1 requisição só" que se lê parece cache e
  é o stream ainda aberto. O que marca o fim sem depender de o áudio tocar
  (headless não tem saída de som) é o `requestfinished` da URL do SSE.
- **`.first` pega a bolha que estiver na janela, e uma resposta longa custa 4
  minutos de fala.** O feed é virtualizado: rolar até ter algumas bolhas, medir
  o texto de cada uma e escolher a MENOR. Assim a rodada inteira sai por ~80
  caracteres.

Roda contra a 3008 (produção) porque é lá que o cache precisa valer; o gasto é
o da bolha escolhida. Para provar só CONFIGURAÇÃO de voz não use esta bancada:
`POST /api/tts/synth -d '{"text":"Oi.","slug":"<slug>"}'` custa 3 caracteres.

    python3 apps/cockpit/scripts/prova/cache-de-voz.py
"""
import asyncio, json
from playwright.async_api import async_playwright

LOG = "/home/clawd/.claude/metrics/tts-uso.jsonl"
def linhas():
    try: return open(LOG, encoding="utf-8").read().splitlines()
    except FileNotFoundError: return []

async def main():
    base = len(linhas())
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={"width":1280,"height":900})
        streams = {"abertos": 0, "fechados": 0}
        pg.on("request", lambda r: streams.__setitem__("abertos", streams["abertos"]+1) if "/api/tts/synth/stream" in r.url else None)
        pg.on("requestfinished", lambda r: streams.__setitem__("fechados", streams["fechados"]+1) if "/api/tts/synth/stream" in r.url else None)
        await pg.goto("http://127.0.0.1:3008/agente/daniel", wait_until="domcontentloaded", timeout=90000)
        await pg.wait_for_timeout(8000)

        sel = 'button[aria-label^="ouvir a resposta"]'
        await pg.mouse.move(640, 450)
        for _ in range(40):
            if await pg.locator(sel).count() >= 3: break
            await pg.mouse.wheel(0, -2500)
            await pg.wait_for_timeout(700)
        n = await pg.locator(sel).count()
        print("bolhas visíveis:", n)
        if n == 0:
            print("INCONCLUSIVO: nenhuma bolha de voz na janela"); await b.close(); return

        medidas = []
        for i in range(n):
            t = await pg.locator(sel).nth(i).evaluate("""el => {
                let no = el;
                while (no && (no.innerText||'').trim().length < 40) no = no.parentElement;
                return no ? no.innerText.trim().length : 0;
            }""")
            medidas.append(t)
        print("tamanho do texto por bolha:", medidas)
        menor = min(range(n), key=lambda i: medidas[i] if medidas[i] else 10**6)
        print("escolhida:", menor, "com", medidas[menor], "caracteres de bloco")
        alvo = await pg.locator(sel).nth(menor).element_handle()
        await alvo.scroll_into_view_if_needed()

        # --- 1º toque: paga
        await alvo.click()
        for _ in range(120):
            await pg.wait_for_timeout(1000)
            if streams["fechados"] >= 1: break
        await pg.wait_for_timeout(2000)
        l1 = linhas()[base:]
        print(f"1º toque | streams abertos={streams['abertos']} fechados={streams['fechados']} | linhas novas={len(l1)}")
        for l in l1: print("   ", l)

        # --- 2º toque: tem que sair do cache
        await pg.wait_for_timeout(1500)
        await alvo.click()
        await pg.wait_for_timeout(8000)
        l2 = linhas()[base+len(l1):]
        print(f"2º toque | streams abertos={streams['abertos']} | linhas novas={len(l2)}")
        for l in l2: print("   ", l)

        vozes = {json.loads(l)["voz"] for l in l1 if l.strip()}
        engines = {json.loads(l)["engine"] for l in l1 if l.strip()}
        print("VOZ NO CONTADOR:", vozes, "| ENGINE:", engines)
        # engine `edge` aqui não é detalhe: é a voz do agente trocada em
        # silêncio, o defeito que o portão de motor da API existe pra impedir.
        print("SERVIDA PELO GOOGLE:", engines == {"google"})
        print("CACHE OK (sem stream novo):", streams["abertos"] == 1)
        print("CACHE OK (sem cobrança nova):", len(l2) == 0)
        await b.close()

asyncio.run(main())
