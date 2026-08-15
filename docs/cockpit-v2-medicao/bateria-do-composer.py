"""E2E DO COMPOSER — o caminho inteiro do usuário, nos dois motores.

Ponta a ponta aqui significa: eu escrevo na tela -> a mensagem sai -> ela CHEGA
no agente -> o agente responde -> a resposta VOLTA para a tela. Nada de
"o campo esvaziou, logo funcionou".

Roda tudo, não aborta no primeiro erro, imprime a tabela no fim.
"""
import asyncio
import json
import subprocess
import time
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:3008"
API = "http://127.0.0.1:8000"
IPHONE = {"width": 390, "height": 844}
TECLADO = {"width": 390, "height": 430}
FOTO = "/tmp/bateria-foto.png"

R = []


def reg(cat, caso, ok, det=""):
    R.append({"cat": cat, "caso": caso, "ok": ok, "det": det})
    print(f"[{'OK  ' if ok else 'FALHA'}] {cat} · {caso}" + (f" — {det}" if det else ""), flush=True)


def pane(sessao, linhas=400):
    try:
        return subprocess.run(
            ["tmux", "capture-pane", "-t", sessao, "-p", "-S", f"-{linhas}"],
            capture_output=True, text=True, timeout=15,
        ).stdout
    except Exception as e:
        return f"<erro {e}>"


def msgs_codex(slug="tara"):
    try:
        out = subprocess.run(
            ["curl", "-s", f"{API}/api/agents/{slug}/codex/messages?limit=60"],
            capture_output=True, text=True, timeout=20,
        ).stdout
        return out
    except Exception as e:
        return f"<erro {e}>"


async def abre(browser, slug, vp=IPHONE, touch=False):
    page = await browser.new_page(
        viewport=vp, device_scale_factor=2, has_touch=touch, is_mobile=touch
    )
    await page.goto(f"{BASE}/agente/{slug}", wait_until="load", timeout=60000)
    await page.wait_for_timeout(3500)
    return page


def campo(page):
    return page.locator("textarea.ck-campo")


async def sossega(page, rot, limite=40):
    """Espera o agente terminar o que está fazendo ANTES de medir.

    Sem isto a bateria acusa o produto por concorrência que ela mesma criou:
    categoria que manda mensagem, seguida de outra que manda mensagem, produz
    `input_nao_observavel` no tmux do Claude Code e `shared_turn_in_flight` no
    telecodex da Tara — os dois 409 legítimos, os dois lidos como "o composer
    engoliu". Aconteceu três vezes em 15/08 antes de eu olhar o log da API.
    """
    for _ in range(limite):
        if await page.get_by_role("button", name="Parar", exact=False).count() == 0:
            break
        await page.wait_for_timeout(3000)
    await page.wait_for_timeout(3000)


# ============================== 1. E2E COMPLETO: sai, chega, responde, aparece
async def e2e_ida_e_volta(browser, slug, sessao, rot):
    page = await abre(browser, slug)
    await sossega(page, rot)
    c = campo(page)
    marca = str(int(time.time()))[-6:]
    pedido = f"e2e{rot}{marca}: responda somente com a palavra PONG{marca}"
    alvo = f"PONG{marca}"

    await c.click()
    await c.fill(pedido)
    await page.keyboard.press("Enter")
    await page.wait_for_timeout(1200)

    reg("e2e", f"{rot}: campo esvazia ao enviar", (await c.input_value()) == "")
    minha = await page.get_by_text(f"e2e{rot}{marca}", exact=False).first.count() > 0
    reg("e2e", f"{rot}: MINHA mensagem vira bolha na tela", minha,
        "" if minha else "sumiu do feed depois de sair do campo")

    # A RÉGUA EM SEGUNDOS, e não só "apareceu em algum momento". Em 15/08 este
    # caminho levava 18,9 s no Claude Code — e o teto de atenção da NN/g é 10 s.
    # Dois segundos é folga sobre o 0,0 s que o eco otimista entrega, e aperta o
    # bastante para pegar a regressão no dia em que ela voltar.
    t0 = time.monotonic()
    visto = None
    while time.monotonic() - t0 < 30:
        if f"e2e{rot}{marca}" in (await page.locator("body").inner_text()):
            visto = time.monotonic() - t0
            break
        await page.wait_for_timeout(200)
    reg("e2e", f"{rot}: a bolha aparece em ate 2s (tela muda e 'engoliu')",
        visto is not None and visto <= 2.0,
        f"{visto:.1f}s" if visto is not None else "nao apareceu em 30s")

    # CHEGOU no agente?
    chegou = False
    if sessao:
        for _ in range(30):
            await page.wait_for_timeout(3000)
            if f"e2e{rot}{marca}" in pane(sessao):
                chegou = True
                break
    else:
        for _ in range(30):
            await page.wait_for_timeout(3000)
            if f"e2e{rot}{marca}" in msgs_codex(slug):
                chegou = True
                break
    reg("e2e", f"{rot}: mensagem CHEGOU no agente de verdade", chegou,
        "" if chegou else "saiu da tela e nao apareceu do outro lado")

    # RESPOSTA voltou pra tela?
    voltou = False
    for _ in range(40):
        await page.wait_for_timeout(3000)
        corpo = await page.locator("body").inner_text()
        if alvo in corpo and corpo.count(alvo) >= 2:
            voltou = True
            break
    reg("e2e", f"{rot}: RESPOSTA do agente apareceu na tela", voltou,
        "" if voltou else f"nao vi '{alvo}' vindo de volta em 2min")
    await page.screenshot(path=f"/tmp/e2e-{rot}-idavolta.png", full_page=False)
    await page.close()


# ============================== 2. DOUBLE-TEXTING: 2a durante o pensamento
async def e2e_fila(browser, slug, sessao, rot):
    page = await abre(browser, slug)
    await sossega(page, rot)
    c = campo(page)
    marca = str(int(time.time()))[-6:]
    m1 = f"fila{rot}{marca}a: conte de 1 a 20, um por linha"
    m2 = f"fila{rot}{marca}b"

    await c.click(); await c.fill(m1); await page.keyboard.press("Enter")
    await page.wait_for_timeout(1500)
    await c.click(); await c.fill(m2); await page.keyboard.press("Enter")
    await page.wait_for_timeout(900)

    vazio = (await c.input_value()) == ""
    reg("fila", f"{rot}: 2a mensagem NAO volta pro campo (nao engole)", vazio,
        "" if vazio else "texto devolvido ao campo = o que o Rica chama de engolir")

    borda = await c.evaluate("el => getComputedStyle(el.closest('form') || el).borderColor")
    corpo = await page.locator("body").inner_text()
    tem_recado = ("fila" in corpo) or ("enviando" in corpo.lower())
    reg("fila", f"{rot}: a espera tem RECADO visivel (nao so borda vermelha)", tem_recado,
        f"borda={borda}")

    drenou = False
    for _ in range(40):
        await page.wait_for_timeout(3000)
        alvo = pane(sessao) if sessao else msgs_codex(slug)
        if m2 in alvo:
            drenou = True
            break
    reg("fila", f"{rot}: 2a mensagem DRENOU sozinha e chegou", drenou,
        "" if drenou else "fila nao esvaziou sozinha")
    await page.close()


# ============================== 3. PARAR DE VERDADE
async def e2e_parar(browser, slug, sessao, rot):
    page = await abre(browser, slug)
    c = campo(page)
    # Este foi o primeiro a cair pela falta de isolamento: a categoria anterior
    # deixava uma mensagem na fila, ela drenava logo depois do meu clique no ■,
    # o despacho passava por `enviar()` — que zera a marca de "eu mandei parar"
    # de propósito — e o botão voltava. Corretíssimo do produto, reprovado pelo
    # teste.
    await sossega(page, rot)
    marca = str(int(time.time()))[-6:]
    await c.click()
    await c.fill(f"parar{rot}{marca}: conte devagar de 1 ate 300, um numero por linha")
    await page.keyboard.press("Enter")

    achou = False
    for _ in range(20):
        await page.wait_for_timeout(1500)
        b = page.get_by_role("button", name="Parar", exact=False)
        if await b.count() > 0:
            achou = True
            break
    reg("parar", f"{rot}: o botao PARAR aparece enquanto o agente gera", achou)
    if not achou:
        await page.screenshot(path=f"/tmp/e2e-{rot}-semparar.png")
        await page.close(); return

    editavel = await c.is_editable()
    reg("parar", f"{rot}: campo continua editavel durante a geracao", editavel)

    await page.get_by_role("button", name="Parar", exact=False).first.click()
    await page.wait_for_timeout(5000)

    sumiu = await page.get_by_role("button", name="Parar", exact=False).count() == 0
    reg("parar", f"{rot}: o botao PARAR some depois do toque", sumiu,
        "" if sumiu else "ressuscita: lifecycle_status oscila entre pollings")

    # com texto escrito, o alvo tem de ser ENVIAR, nunca o quadrado
    await c.click(); await c.fill("texto durante a geracao")
    await page.wait_for_timeout(600)
    env = await page.get_by_role("button", name="Enviar", exact=False).count()
    reg("parar", f"{rot}: com texto escrito o alvo volta a ser ENVIAR", env > 0,
        "" if env else "o quadrado cobriu o unico alvo solido: beco sem saida no celular")
    await c.fill("")
    await page.close()


# ============================== 4. ANEXO + COLAR IMAGEM
async def e2e_anexo(browser, slug, rot):
    page = await abre(browser, slug)
    await sossega(page, rot)
    c = campo(page)
    mais = page.get_by_role("button", name="Anexar arquivo").first
    tem = await mais.count() > 0
    reg("anexo", f"{rot}: botao '+' existe", tem)
    if not tem:
        await page.close(); return

    await mais.click(); await page.wait_for_timeout(600)
    ent = page.locator("input[type=file]").first
    await ent.set_input_files(FOTO); await page.wait_for_timeout(1500)
    # DENTRO da miniatura, nao `img` da pagina inteira: o feed tem avatar e
    # imagem de mensagem antiga, entao o contador global dava OK sem anexo
    # nenhum e FALHA quando o feed nascia sem imagem. Falso positivo e falso
    # negativo no mesmo caso, os dois do teste.
    mini = page.locator(".ck-miniatura img")
    reg("anexo", f"{rot}: foto escolhida vira MINIATURA", await mini.count() > 0)

    rem = page.get_by_role("button", name="Remover", exact=False).first
    pode = await rem.count() > 0
    reg("anexo", f"{rot}: da pra REMOVER antes de enviar", pode)
    if pode:
        await rem.click(); await page.wait_for_timeout(700)

    # COLAR imagem do clipboard (comportamento novo — commit 83cd06e)
    await c.click()
    await page.evaluate("""async () => {
      const el = document.querySelector('textarea.ck-campo');
      const cv = document.createElement('canvas'); cv.width = 40; cv.height = 40;
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#c33'; ctx.fillRect(0,0,40,40);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      const f = new File([blob], 'colada.png', {type: 'image/png'});
      const dt = new DataTransfer(); dt.items.add(f);
      el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
    }""")
    await page.wait_for_timeout(2000)
    colou = await page.locator(".ck-miniatura img").count() > 0
    reg("anexo", f"{rot}: COLAR imagem do clipboard anexa a foto", colou,
        "" if colou else "print do celular so entra pela gaveta")
    if colou:
        r2 = page.get_by_role("button", name="Remover", exact=False).first
        if await r2.count() > 0:
            await r2.click(); await page.wait_for_timeout(500)

    # '+' vivo durante o envio anterior
    marca = str(int(time.time()))[-6:]
    await c.click(); await c.fill(f"anexo{rot}{marca}"); await page.keyboard.press("Enter")
    await page.wait_for_timeout(600)
    reg("anexo", f"{rot}: '+' CLICAVEL enquanto a anterior processa", not await mais.is_disabled())
    await page.close()


# ============================== 5. ENTRADA / IME / MOBILE / A11Y / RASCUNHO
async def e2e_basico(browser, slug, rot):
    page = await abre(browser, slug, IPHONE, touch=True)
    c = campo(page)
    await c.click()

    await c.fill("uma linha"); await page.wait_for_timeout(300)
    h1 = (await c.bounding_box())["height"]
    await c.fill("\n".join(f"l{i}" for i in range(8))); await page.wait_for_timeout(400)
    h8 = (await c.bounding_box())["height"]
    reg("entrada", f"{rot}: a caixa cresce com o conteudo", h8 > h1, f"{h1:.0f}->{h8:.0f}px")

    await c.fill("\n".join(f"l{i}" for i in range(60))); await page.wait_for_timeout(400)
    h60 = (await c.bounding_box())["height"]
    reg("entrada", f"{rot}: a caixa tem TETO e rola por dentro", h60 < 500, f"{h60:.0f}px")

    await c.fill("x"); await page.wait_for_timeout(300)
    reg("entrada", f"{rot}: a caixa encolhe ao apagar", (await c.bounding_box())["height"] < h60)

    fs = await c.evaluate("el => getComputedStyle(el).fontSize")
    reg("entrada", f"{rot}: fonte >=16px (senao o iPhone da zoom)",
        float(fs.replace("px", "")) >= 16, f"fonte={fs}")

    longo = "palavra " * 4000
    await c.fill(longo); await page.wait_for_timeout(700)
    reg("entrada", f"{rot}: aceita colar texto muito longo", len(await c.input_value()) >= len(longo) - 5)
    await c.fill("")

    # IME — duas bordas
    await c.type("n")
    await page.evaluate("""() => {
      const el = document.querySelector('textarea.ck-campo');
      el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
      el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', keyCode:229, isComposing:true, bubbles:true, cancelable:true}));
    }""")
    await page.wait_for_timeout(500)
    reg("acentuacao", f"{rot}: Enter no meio da acentuacao nao envia", (await c.input_value()) != "")

    await c.fill("a")
    await page.evaluate("""() => {
      const el = document.querySelector('textarea.ck-campo');
      el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', keyCode:229, isComposing:false, bubbles:true, cancelable:true}));
    }""")
    await page.wait_for_timeout(500)
    reg("acentuacao", f"{rot}: Enter na BORDA do IME (229 sem isComposing) nao envia",
        (await c.input_value()) != "")

    esp = 'áçãõ ñ "aspas" <tag> & 100% #1 `code` \\ 🔥👍'
    await c.fill(esp); await page.wait_for_timeout(400)
    reg("robustez", f"{rot}: aceita acento, emoji e especial", (await c.input_value()) == esp)

    # a11y
    await c.fill("oi"); await page.wait_for_timeout(400)
    env = page.get_by_role("button", name="Enviar", exact=False).first
    reg("a11y", f"{rot}: botao de enviar tem nome acessivel", await env.count() > 0)
    if await env.count() > 0:
        b = await env.bounding_box()
        reg("a11y", f"{rot}: alvo de toque >=24px (WCAG 2.2)",
            b and b["width"] >= 24 and b["height"] >= 24, f"{b['width']:.0f}x{b['height']:.0f}")
    reg("a11y", f"{rot}: existe regiao viva pra anunciar estado",
        await page.locator("[aria-live]").count() > 0)

    # rascunho sobrevive ao reload
    marca = str(int(time.time()))[-6:]
    await c.fill(f"rasc{rot}{marca}"); await page.wait_for_timeout(700)
    await page.reload(wait_until="load"); await page.wait_for_timeout(3500)
    v = await campo(page).input_value()
    reg("robustez", f"{rot}: rascunho sobrevive ao reload", v != "", f"campo={v!r}")

    # teclado de pe
    await page.set_viewport_size(TECLADO); await page.wait_for_timeout(600)
    forma = await campo(page).bounding_box()
    reg("mobile", f"{rot}: composer visivel com o teclado de pe",
        forma is not None and forma["y"] + forma["height"] <= TECLADO["height"] + 2, f"{forma}")
    await page.screenshot(path=f"/tmp/e2e-{rot}-teclado.png")
    await campo(page).fill("")
    await page.wait_for_timeout(400)
    await page.close()


async def main():
    subprocess.run(["python3", "-c",
        "from PIL import Image; Image.new('RGB',(80,80),(40,120,200)).save('/tmp/bateria-foto.png')"],
        check=False)

    async with async_playwright() as p:
        b = await p.chromium.launch()
        for slug, sessao, rot in (("canarinho", "canario", "cc"), ("tara", None, "codex")):
            print(f"\n########## {rot.upper()} ({slug}) ##########", flush=True)
            for fn, args in (
                (e2e_basico, (slug, rot)),
                (e2e_anexo, (slug, rot)),
                (e2e_ida_e_volta, (slug, sessao, rot)),
                (e2e_fila, (slug, sessao, rot)),
                (e2e_parar, (slug, sessao, rot)),
            ):
                try:
                    await fn(b, *args)
                except Exception as e:
                    reg("erro", f"{rot}: {fn.__name__}", False, f"{type(e).__name__}: {str(e)[:160]}")
        await b.close()

    print("\n" + "=" * 60, flush=True)
    ok = sum(1 for r in R if r["ok"])
    print(f"RESULTADO: {ok}/{len(R)} passaram\n", flush=True)
    for r in R:
        if not r["ok"]:
            print(f"  FALHA · {r['cat']} · {r['caso']} — {r['det']}", flush=True)
    with open("/tmp/e2e-composer.json", "w") as f:
        json.dump(R, f, indent=2, ensure_ascii=False)


asyncio.run(main())
