/**
 * O DESLIZE DA TROPA (28/09). Depois do arrasto, as linhas que cederam lugar
 * deslizam até a posição nova em vez de saltar — FLIP: fotografa o topo de
 * cada linha antes da ordem otimista, pinta a ordem nova, devolve cada linha
 * ao lugar antigo com `transform` e solta a transição até zero.
 *
 * Por que FLIP e não View Transition com um nome por linha: a VT fotografa a
 * página inteira e trava o toque durante o voo, e a tropa mora na mesma tela
 * que o feed ao vivo e o composer. O FLIP mexe só no `transform` das linhas
 * que andaram. E o `voo-do-envio.ts` já usa a VT da página; duas no mesmo
 * documento se cancelam (a segunda aborta a primeira).
 *
 * A linha que o dedo SOLTOU fica de fora: o Rica já a levou até lá com o
 * dedo, e fazê-la voltar ao lugar antigo para deslizar de novo seria o salto
 * duplo. Pela seta do teclado não há dedo — ali ela desliza junto.
 *
 * Aqui mora só a conta, onde o `node --test` alcança; o fio fica em
 * `tropa.tsx` (refs, efeito) e `deslize-da-tropa.ts` (estilo).
 */

export type Deslize = { slug: string; dy: number };

/** Abaixo disso é arredondamento de subpixel, não movimento. */
const LIMIAR_PX = 0.5;

export function deslizes(
  antes: ReadonlyMap<string, number>,
  depois: ReadonlyMap<string, number>,
  soltada: string | null,
): Deslize[] {
  const lista: Deslize[] = [];
  for (const [slug, topoNovo] of depois) {
    if (slug === soltada) continue;
    const topoVelho = antes.get(slug);
    // Linha que não existia antes (agente novo no mesmo poll) entra seca.
    if (topoVelho === undefined) continue;
    const dy = topoVelho - topoNovo;
    if (Math.abs(dy) < LIMIAR_PX) continue;
    lista.push({ slug, dy });
  }
  return lista;
}
