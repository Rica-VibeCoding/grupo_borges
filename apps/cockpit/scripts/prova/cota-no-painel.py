"""Prova dirigida da tropa_task 294c5464 — a cota nunca aparecia no painel do v2.

As duas metades:
  1. o buraco fechou   — o painel de um agente Claude Code mostra as duas
     janelas (5h e 7d) com percentual e reset; o da `tara` mostra o mesmo
     número acompanhado do aviso de leitura velha
  2. o que funcionava continua — com a cota em `missing` o bloco vira recado e
     os controles que já existiam (segmentados, Destravar, Relançar) seguem na
     tela, inteiros

Os três estados são REAIS hoje, nenhum é simulado (medido 07/08):
  `daniel`   → available, 5h e 7d preenchidas
  `tara`     → stale, `five_hour: null` e `seven_day` em 71%
  `vinicius` → missing

Só leitura: abre painel e lê a tela. Nada é despachado, nada é derrubado — a
régua 1 do README vale inteira aqui.
"""

import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3009"
SAIDA = Path(os.environ.get("PROVA_SAIDA", "/home/clawd/provas")) / "cockpit-cota-no-painel"


def abre_painel(pag, slug: str):
    pag.goto(f"{BASE}/agente/{slug}?painel=detalhes", wait_until="domcontentloaded")
    # O bloco só nasce com o `/painel` respondido (`carga === 'pronto'`) — esperar
    # o seletor é esperar o FATO, não o relógio.
    pag.wait_for_selector("section[aria-label='ações rápidas']", timeout=30_000)
    return pag.get_by_role("region", name="Cota usada")


def texto_da_cota(pag, slug: str) -> str:
    bloco = abre_painel(pag, slug)
    bloco.wait_for(timeout=30_000)
    return bloco.inner_text()


def main() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        nav = p.chromium.launch()
        pag = nav.new_page(viewport={"width": 480, "height": 1000})

        # --- METADE A1: cota viva, as duas janelas ------------------------
        texto = texto_da_cota(pag, "daniel")
        pag.screenshot(path=SAIDA / "1-cota-viva.png", full_page=True)
        assert "5h" in texto and "7d" in texto, f"faltou uma das janelas: {texto!r}"
        assert "%" in texto, f"cota sem percentual: {texto!r}"
        assert "reset em" in texto, f"cota sem o quanto falta pro reset: {texto!r}"
        assert "dados antigos" not in texto, f"cota fresca marcada como velha: {texto!r}"

        # O `meter` sem nome acessível anuncia um número sem dono — é o furo do
        # v1 (`quotas-bloco.tsx:31-38`), e a APG exige `aria-label`/`labelledby`.
        medidor = pag.get_by_role("meter").first
        assert medidor.get_attribute("aria-label"), "meter sem nome acessível"
        falado = medidor.get_attribute("aria-valuetext") or ""
        assert "usada" in falado, f"meter sem valor falado compreensível: {falado!r}"
        print(f"✓ A1 — daniel: cota viva com as duas janelas ({texto.splitlines()})")

        # --- METADE A2: cota velha, número E aviso na mesma linha ----------
        texto = texto_da_cota(pag, "tara")
        pag.screenshot(path=SAIDA / "2-cota-velha.png", full_page=True)
        assert "dados antigos" in texto, f"cota de 25h não avisou que é velha: {texto!r}"
        # O número CONTINUA. Esconder a cota velha seria o buraco de novo.
        assert "71%" in texto, f"a cota velha sumiu em vez de ser marcada: {texto!r}"
        # A Tara não tem janela de 5h: ela vira "sem leitura", não some.
        assert "sem leitura" in texto, f"janela vazia sumiu da tela: {texto!r}"
        print(f"✓ A2 — tara: {texto.splitlines()}")

        # --- METADE B: `missing` não quebra nem come os controles ----------
        bloco = abre_painel(pag, "vinicius")
        bloco.wait_for(timeout=30_000)
        texto = bloco.inner_text()
        assert "indisponível" in texto, f"missing virou bloco vazio: {texto!r}"

        acoes = pag.get_by_role("region", name="ações rápidas")
        grupos = acoes.get_by_role("group").count()
        assert grupos >= 1, "os segmentados sumiram com a cota em missing"
        assert acoes.get_by_role("button", name="Destravar", exact=False).count() >= 1, (
            "o Destravar sumiu com a cota em missing"
        )
        # Os dois relançares se chamam "Resume" e "Restart" no nome acessível
        # (`rotulaRelancar`) — a palavra "relançar" só aparece na frase que vem
        # depois dos dois pontos.
        for botao in ("Resume", "Restart"):
            assert acoes.get_by_role("button", name=botao, exact=False).count() >= 1, (
                f"o {botao} sumiu com a cota em missing"
            )
        erros = []
        pag.on("pageerror", lambda e: erros.append(str(e)))
        pag.wait_for_timeout(2_000)
        assert not erros, f"a tela quebrou com missing: {erros}"
        pag.screenshot(path=SAIDA / "3-missing-com-controles.png", full_page=True)
        print(f"✓ B — vinicius (missing): recado no lugar da cota, {grupos} segmentado(s) e os dois botões de pé")

        nav.close()

    print(f"\nprints em {SAIDA}")


if __name__ == "__main__":
    main()
