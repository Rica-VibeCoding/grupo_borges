export type OpcoesAlturaViewport = {
  alturaVisual?: number;
  deslocamentoVisual?: number;
  alturaDaJanela: number;
};

function medidaValida(medida: number | undefined): medida is number {
  return typeof medida === 'number' && Number.isFinite(medida) && medida > 0;
}

/** Altura da app **no aplicativo instalado, com o teclado em cena** — no
 *  navegador quem manda é o `100dvh` do CSS, em repouso também, e a decisão de
 *  nem publicar mora no componente.
 *
 *  A régua é `viewport visual + deslocamento`: os dois números que o
 *  compositor atualiza na hora. Medido no iPhone do Rica em 12/08 com o
 *  teclado aberto: visual 449, deslocamento 216 → 665, o fundo da app
 *  encostado no topo do teclado — com o "role para revelar o campo" do WebKit
 *  já compensado por construção (panorâmica de 216 ou de 0, a soma aponta o
 *  mesmo lugar).
 *
 *  Os dois erros históricos que esta soma encerra: o visual SOZINHO tira os
 *  206px do deslocamento e joga a app para fora por cima (pré-`dd23112`); a
 *  janela (`innerHeight`) é atrasada nas duas direções — com o teclado aberto
 *  ela nem desceu no aparelho (min/max do IMG_7704: "viu 793–852", nunca 655)
 *  e o composer ficava atrás do teclado (IMG_7705). */
export function alturaDoViewport({
  alturaVisual,
  deslocamentoVisual,
  alturaDaJanela,
}: OpcoesAlturaViewport): number {
  if (medidaValida(alturaVisual)) {
    const deslocamento = medidaValida(deslocamentoVisual) ? deslocamentoVisual : 0;
    return Math.round(alturaVisual + deslocamento);
  }
  return medidaValida(alturaDaJanela) ? Math.round(alturaDaJanela) : 0;
}
