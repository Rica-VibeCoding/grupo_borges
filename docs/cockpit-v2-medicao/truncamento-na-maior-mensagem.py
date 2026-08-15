"""Checklist de truncamento rodado contra o painel vivo (itens 28-32 da pesquisa).

O item 30 é o de maior rendimento segundo a literatura: item flex sem min-w-0/
min-h-0 não encolhe abaixo do min-content, transborda, e o primeiro ancestral com
overflow:hidden corta. O texto não é truncado — é EMPURRADO pra fora.

Mede no corpo da MAIOR mensagem do feed, não numa qualquer: é onde o defeito
aparece primeiro.
"""
import asyncio, json, sys
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:3008"

MEDE = """() => {
  // Âncora no scroller do feed. Sem isso o filtro largo pega a barra lateral
  // de agentes e o instrumento aprova o que nunca mediu.
  const scroller = [...document.querySelectorAll('div')].filter(e => {
    const s = getComputedStyle(e);
    return /auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 50
           && e.clientHeight > 200;
  }).sort((a,b) => b.scrollHeight - a.scrollHeight)[0];
  if (!scroller) return { erro: 'nenhum scroller de feed encontrado' };
  // Folha de texto: mais fundo da árvore que ainda carrega o parágrafo inteiro.
  const candidatos = [...scroller.querySelectorAll('p, li, pre, div')]
    .filter(e => e.textContent.length > 120
                 && ![...e.children].some(f => f.textContent.length > e.textContent.length * 0.9));
  if (!candidatos.length) return { erro: 'nenhuma mensagem longa dentro do scroller',
                                   scrollerCls: (scroller.className||'').toString().slice(0,60) };
  const alvo = candidatos.sort((a, b) => b.textContent.length - a.textContent.length)[0];

  const c = getComputedStyle(alvo);
  const item28 = {
    chars: alvo.textContent.length,
    webkitLineClamp: c.webkitLineClamp,
    whiteSpace: c.whiteSpace,
    textOverflow: c.textOverflow,
    overflowWrap: c.overflowWrap,
    maxWidth: c.maxWidth,
    veredito: (c.webkitLineClamp !== 'none' || c.whiteSpace === 'nowrap'
               || c.textOverflow === 'ellipsis') ? 'CORTA' : 'ok',
  };

  // item 29: ancestral que recorta E tem conteudo maior que a caixa
  const recortando = [];
  for (let n = alvo; n && n.parentElement; n = n.parentElement) {
    const s = getComputedStyle(n);
    const recorta = /hidden|clip/.test(s.overflow + s.overflowX + s.overflowY);
    if (recorta && (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)) {
      recortando.push({
        tag: n.tagName.toLowerCase(),
        cls: (n.className || '').toString().slice(0, 60),
        overflow: s.overflow, ox: s.overflowX, oy: s.overflowY,
        sobra_v: n.scrollHeight - n.clientHeight,
        sobra_h: n.scrollWidth - n.clientWidth,
      });
    }
  }

  // item 30: a cadeia flex/grid inteira
  const cadeia = [];
  for (let n = alvo; n && n.parentElement; n = n.parentElement) {
    const p = n.parentElement, pc = getComputedStyle(p), s = getComputedStyle(n);
    const flexItem = /flex|inline-flex/.test(pc.display);
    const gridItem = /grid|inline-grid/.test(pc.display);
    if (!flexItem && !gridItem) continue;
    const col = flexItem && /column/.test(pc.flexDirection);
    const eixoMin = col ? s.minHeight : s.minWidth;
    const ehScroller = /auto|scroll/.test(s.overflow + s.overflowX + s.overflowY);
    cadeia.push({
      tag: n.tagName.toLowerCase(),
      cls: (n.className || '').toString().slice(0, 55),
      dir: flexItem ? pc.flexDirection : 'grid',
      min: eixoMin,
      overflow: s.overflow,
      transborda: col ? n.scrollHeight > p.clientHeight : n.scrollWidth > p.clientWidth,
      veredito: (eixoMin === 'auto' && s.overflow === 'visible' && !ehScroller)
                ? 'PRECISA min-h-0/min-w-0' : 'ok',
    });
  }

  // item 32: prose com teto de 65ch
  const prose = [...document.querySelectorAll('[class*="prose"]')].slice(0, 3)
    .map(e => ({ cls: (e.className||'').toString().slice(0,50), maxWidth: getComputedStyle(e).maxWidth }));

  // Quem é o alvo, para o instrumento não medir a coisa errada em silêncio.
  const caminho = [];
  for (let n = alvo; n && n !== document.body; n = n.parentElement) {
    const s2 = getComputedStyle(n);
    caminho.push(n.tagName.toLowerCase() + '.' + (n.className||'').toString().split(' ').slice(0,2).join('.')
                 + ' [' + s2.display + ']');
  }
  return { alvo: { tag: alvo.tagName.toLowerCase(), cls: (alvo.className||'').toString().slice(0,80),
                   texto: alvo.textContent.slice(0,60) },
           caminho: caminho.slice(0, 14),
           item28, item29: recortando, item30: cadeia, item32: prose };
}"""


async def main(slug: str) -> None:
    async with async_playwright() as pw:
        nav = await pw.chromium.launch(channel="chrome", headless=True,
                                       args=["--no-sandbox"])
        page = await (await nav.new_context(viewport={"width": 1280, "height": 900})).new_page()
        erros = []
        page.on("pageerror", lambda e: erros.append(str(e)[:120]))
        await page.goto(f"{BASE}/agente/{slug}", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(9000)
        r = await page.evaluate(MEDE)
        print(json.dumps(r, indent=2, ensure_ascii=False))
        if erros:
            print("ERROS DE PÁGINA:", erros)
        await nav.close()


asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "daniel"))
