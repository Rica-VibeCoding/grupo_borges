"""Prova dirigida do BUG 1 — o retry do painel abortava a própria requisição.

As duas metades, na ordem do Rica:
  1. o defeito sumiu   — com o `/painel` falhando, o painel volta SOZINHO
                         no instante em que a rota volta a responder
  2. o recurso vive    — o backoff CRESCE (2s, 4s, 8s…) e PARA ao fechar a gaveta

A falha é simulada NO CLIENTE (`page.route`), nunca derrubando a `cockpit-api`:
ela é unit transiente e o Rica usa o cockpit enquanto isto roda.

Não é teste de suíte: `node --test` não tem DOM, e o ciclo de vida de efeito do
React só se reproduz em navegador de verdade.
"""

import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

SLUG = "daniel"
URL = f"http://127.0.0.1:3009/agente/{SLUG}?painel=detalhes"
# Screenshot e artefato de corrida: sai FORA do repo (o que se versiona e o
# script que sabe tira-lo de novo). `PROVA_SAIDA` troca o destino.
SAIDA = Path(os.environ.get("PROVA_SAIDA", "/home/clawd/provas")) / "cockpit-retentativa"


def fechar(pag) -> None:
    """Clica no `×` da gaveta.

    Três elementos dividem o rótulo "Fechar detalhes": o botão do chrome (que
    fica ATRÁS do véu e não recebe clique), o próprio véu de tela cheia, e o
    `×`. Escolher por índice quebraria calado na primeira mudança de ordem —
    então escolhe por geometria e reclama se não achar.
    """
    alvos = pag.get_by_label("Fechar detalhes")
    for i in range(alvos.count()):
        caixa = alvos.nth(i).bounding_box()
        if caixa and caixa["width"] < 100 and caixa["y"] > 10:
            alvos.nth(i).click()
            return
    raise AssertionError("não achei o × da gaveta entre os alvos 'Fechar detalhes'")


def main() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)
    batidas: list[float] = []
    caido = True
    t0 = time.monotonic()

    with sync_playwright() as p:
        nav = p.chromium.launch()
        pag = nav.new_page(viewport={"width": 420, "height": 900})

        def trata(rota):
            batidas.append(time.monotonic() - t0)
            if caido:
                rota.fulfill(status=503, body='{"detail":"fora do ar"}')
            else:
                rota.continue_()

        # Só a leitura do painel cai. O resto da página continua real — a
        # gaveta precisa abrir e o SSR precisa achar o agente.
        pag.route("**/painel", trata)

        secao = pag.locator('section[aria-label="ações rápidas"]')
        recado = secao.get_by_text("não consegui ler os controles deste agente")
        # Só existe com `carga === 'pronto'` — é o sinal de que os controles voltaram.
        controles = secao.locator('button[aria-label^="Destravar o agente"]')

        # --- 1. o painel diz que não conseguiu, e oferece saída -------------
        pag.goto(URL, wait_until="domcontentloaded")
        recado.wait_for(timeout=15_000)
        pag.screenshot(path=SAIDA / "1-indisponivel.png")
        print("✓ painel indisponível, com recado e saída")

        # --- 2. o backoff cresce em vez de morrer na primeira rodada --------
        pag.wait_for_timeout(16_000)
        todos = [round(b - a, 1) for a, b in zip(batidas, batidas[1:])]
        # O StrictMode do dev monta duas vezes: o primeiro par vem colado (~0,02s)
        # e não é rodada de backoff. Comparar contra ele deixaria o assert passar
        # sozinho, com ou sem crescimento.
        rodadas = [i for i in todos if i > 0.5]
        print(f"  {len(batidas)} buscas; intervalos: {todos} → rodadas: {rodadas}")
        assert len(rodadas) >= 3, f"o backoff parou cedo: {rodadas}"
        assert rodadas[-1] >= rodadas[0] * 1.8, f"o backoff não cresceu: {rodadas}"

        # --- 3. fechar a gaveta para o backoff -----------------------------
        # Aqui, e não depois do painel voltar: em `pronto` não há polling, então
        # com a gaveta aberta o backoff nem estaria rodando para poder parar.
        fechar(pag)
        # Folga de assentamento antes de marcar: o clique pode cair com uma
        # rodada JÁ em voo (o cleanup mata o timer, não a requisição que saiu),
        # e a navegação remonta o Composer, que também lê `/painel`. Nenhum dos
        # dois é o backoff. O que o backoff faria, se estivesse vivo, é voltar —
        # e 25s cobrem o teto de 15s com sobra.
        pag.wait_for_timeout(3_000)
        parado = len(batidas)
        pag.wait_for_timeout(25_000)
        sobrou = len(batidas) - parado
        print(f"✓ gaveta fechada: {sobrou} busca(s) em 25s (tem de ser 0)")
        assert sobrou == 0, "o backoff continuou com a gaveta fechada"
        pag.screenshot(path=SAIDA / "2-gaveta-fechada.png")

        # --- 4. reabrir, e a rota volta: NINGUÉM toca em nada --------------
        pag.get_by_label("Abrir detalhes do agente").first.click()
        recado.wait_for(timeout=15_000)
        print("✓ reabriu indisponível e o backoff voltou a rodar")

        caido = False
        marca = len(batidas)
        controles.wait_for(timeout=40_000)
        pag.screenshot(path=SAIDA / "3-voltou-sozinho.png")
        print(f"✓ painel voltou sozinho ({len(batidas) - marca} busca(s), zero clique)")

        nav.close()

    print(f"\nprints em {SAIDA}")


if __name__ == "__main__":
    main()
