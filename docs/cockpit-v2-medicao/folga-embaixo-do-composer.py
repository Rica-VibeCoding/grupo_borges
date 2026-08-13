"""Quanto sobra embaixo da caixa do composer — contra a régua do app do Claude.

O Rica mandou os dois prints lado a lado em 13/08: no app do Claude a caixa
termina a **34pt** do fundo da tela, que é a barra de gestos do iPhone e nada
mais; no cockpit sobravam **66,7pt** (medidos no print dele, e 67px em
bancada). A conta dos 67: 4 de gap + 17 do reservador da linha de status + 12
de padding + 34 do `safe-area-inset-bottom`.

Duas correções, uma por regime:

- repouso — o padding de baixo passa a somar só o que FALTA para a barra de
  gestos, já que o reservador de 21px está embaixo da caixa de qualquer jeito;
- teclado — o `--ck-safe-bottom` vai a zero enquanto o campo está focado: o
  teclado cobre a barra de gestos, e reservar espaço para ela ali é folga morta
  entre a caixa e o teclado.

O Chromium reporta `env(safe-area-inset-bottom)` = 0, então a bancada encena a
barra de gestos do iPhone injetando o token.

Uso: python3 folga-embaixo-do-composer.py <porta> [segundos]
"""

import sys

from playwright.sync_api import sync_playwright

porta = sys.argv[1]
segundos = int(sys.argv[2]) if len(sys.argv) > 2 else 4

BARRA_DE_GESTOS = 34
ALVO_EM_REPOUSO = BARRA_DE_GESTOS  # a régua do app do Claude
TETO_COM_TECLADO = 30  # sem a barra em cena, sobra só o reservador + respiro

FINGE_APLICATIVO = """
Object.defineProperty(navigator, 'standalone', { get: () => true });
"""

MEDE = """() => {
  const caixa = document.querySelector('.ck-caixa');
  const app = document.querySelector('body .ck-janela');
  return {
    sobra: Math.round(app.getBoundingClientRect().bottom - caixa.getBoundingClientRect().bottom),
    safe: getComputedStyle(document.documentElement).getPropertyValue('--ck-safe-bottom').trim(),
  };
}"""

with sync_playwright() as p:
    navegador = p.chromium.launch()
    ctx = navegador.new_context(viewport={"width": 393, "height": 852})
    ctx.add_init_script(FINGE_APLICATIVO)
    pagina = ctx.new_page()
    pagina.goto(f"http://127.0.0.1:{porta}/agente/pavan", wait_until="domcontentloaded")
    # a barra de gestos do iPhone, que o Chromium não tem
    pagina.add_style_tag(content=f":root {{ --ck-safe-bottom: {BARRA_DE_GESTOS}px }}")
    pagina.wait_for_timeout(segundos * 1000)

    repouso = pagina.evaluate(MEDE)

    campo = pagina.query_selector("textarea")
    if not campo:
        print("FALHA: não achei o textarea do composer")
        sys.exit(1)
    campo.click()
    pagina.wait_for_timeout(2_000)
    teclado = pagina.evaluate(MEDE)

    ctx.close()
    navegador.close()

print(f"== folga embaixo da caixa (porta {porta})")
print(f"   repouso  sobra {repouso['sobra']}px   safe {repouso['safe']}   alvo {ALVO_EM_REPOUSO}px (app do Claude)")
print(f"   teclado  sobra {teclado['sobra']}px   safe {teclado['safe']}   teto {TETO_COM_TECLADO}px")
ok = repouso["sobra"] <= ALVO_EM_REPOUSO and teclado["sobra"] <= TETO_COM_TECLADO
print("\n   " + ("PARIDADE COM A RÉGUA" if ok else "REPROVOU — ainda sobra folga embaixo da caixa"))
sys.exit(0 if ok else 1)
