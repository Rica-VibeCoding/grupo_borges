// Âncora de rolagem — G3 do gate, o item que reprovou no iPhone.
//
// O invariante NÃO é "o scrollTop não muda". É: **a mensagem que o Rica está
// lendo não se move na tela**. Os dois divergem exatamente no caso que reprovou:
// quando um item ACIMA da dobra muda de altura, manter o scrollTop parado
// desloca o texto lido; manter o ITEM parado exige mover o scrollTop junto.
// Foram 20.273 px de deslocamento medidos, e o corte é zero — então o alvo é o
// item, não o número.
//
// Tudo aqui é função pura sobre números: é o que permite provar o corte zero em
// teste, sem browser e sem virtualizador.

/** Distância do fim, em px, dentro da qual o feed se considera colado. */
export const COLADO_PX = 24;

export type Metrica = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/** Onde um item está hoje, no sistema de coordenadas do conteúdo rolável. */
export type Faixa = {
  chave: string;
  start: number;
  end: number;
};

export type Ancora = {
  chave: string;
  /**
   * `start - scrollTop` no instante da captura: negativo quando o item começa
   * acima da dobra, que é o caso comum (o item do topo quase nunca está
   * alinhado com a borda). Guardar a DIFERENÇA, e não o start, é o que faz a
   * restauração ser imune a qualquer remedição acima.
   */
  deslocamento: number;
};

export function distanciaDoFim(metrica: Metrica): number {
  return Math.max(0, metrica.scrollHeight - metrica.scrollTop - metrica.clientHeight);
}

export function estaColado(metrica: Metrica, tolerancia: number = COLADO_PX): boolean {
  return distanciaDoFim(metrica) <= tolerancia;
}

/**
 * O item que ocupa o topo do viewport — o primeiro que ainda não terminou antes
 * da dobra. É ele que o olho está usando como referência.
 *
 * Empate em `end === scrollTop` conta como já passado: um item que termina
 * exatamente na borda não está visível.
 */
export function capturaAncora(visiveis: readonly Faixa[], scrollTop: number): Ancora | null {
  for (const faixa of visiveis) {
    if (faixa.end > scrollTop) {
      return { chave: faixa.chave, deslocamento: faixa.start - scrollTop };
    }
  }
  return null;
}

/**
 * Novo `scrollTop` que recoloca a âncora onde ela estava, ou `null` quando não
 * há nada a fazer.
 *
 * `null` quando a chave sumiu é deliberado: com o feed em append-only isso não
 * acontece, e se acontecer (troca de sessão, replay que reconstrói) ficar parado
 * é menos ofensivo do que saltar para um item homônimo.
 */
export function scrollTopParaAncora(
  ancora: Ancora,
  visiveis: readonly Faixa[],
  scrollTopAtual: number,
): number | null {
  const faixa = visiveis.find((candidata) => candidata.chave === ancora.chave);
  if (!faixa) return null;
  const alvo = Math.max(0, faixa.start - ancora.deslocamento);
  return alvo === scrollTopAtual ? null : alvo;
}
