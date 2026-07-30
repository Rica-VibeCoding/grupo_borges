// Altura estimada de um item, ANTES de ele existir no DOM.
//
// ⚠️ A regra que não pode ser quebrada: esta função é DETERMINÍSTICA e ESTÁVEL
// NO TEMPO. O mesmo item devolve o mesmo número na primeira e na milésima
// chamada.
//
// O esqueleto de medição estimava por média móvel (`alturaRef` alimentada por
// cada `measureElement`) e é dali que saem os 20.273 px do G3: quando a média
// desliza, TODOS os itens ainda não medidos mudam de altura de uma vez, o
// `getTotalSize()` salta e nada disso passa por `_measureElement` — que é o
// único ponto onde o virtualizador compensa o scroll (virtual-core 3.17.7,
// `defaultShouldAdjust`). O deslocamento entra por fora da compensação, e por
// isso a âncora sozinha não salvava. A média ainda era enviesada de saída: uma
// remedição do mesmo item contava de novo, então ela nunca convergia.
//
// Errar a estimativa é barato — a medição real corrige e o virtual-core
// compensa o delta. Mudá-la depois é que é caro. Estime por FORMA do item.

import type { ContentPart } from '@grupo_borges/cockpit-core/messages-types';
import type { RenderItem } from '@grupo_borges/cockpit-core/render-items';

/** Altura de uma linha de texto renderizada, em px. */
const LINHA_PX = 22;
/** Uma execução colapsada: sigilo + alvo + rendimento, tudo em uma linha só. */
const COLAPSADA_PX = 28;
/** Padding vertical do envelope de cada item no feed. */
const MOLDURA_PX = 16;
/** Largura útil em caracteres na pior tela que importa (iPhone em retrato). */
const CHARS_POR_LINHA = 56;
/**
 * Teto de linhas estimadas para um bloco de texto. Ficar perto do TÍPICO vale
 * mais que ficar perto do máximo: um único despejo de 5.000 linhas puxaria a
 * estimativa de todo mundo, e a medição real conserta ele sozinho.
 */
const TETO_LINHAS = 24;

export const ALTURA_MINIMA_PX = COLAPSADA_PX;

/** Linhas que um texto ocupa: quebras explícitas mais dobra por largura. */
export function linhasDeTexto(texto: string): number {
  if (texto.length === 0) return 1;
  let linhas = 0;
  for (const fisica of texto.split('\n')) {
    linhas += Math.max(1, Math.ceil(fisica.length / CHARS_POR_LINHA));
    if (linhas >= TETO_LINHAS) return TETO_LINHAS;
  }
  return Math.min(linhas, TETO_LINHAS);
}

function alturaDeTexto(texto: string): number {
  return linhasDeTexto(texto) * LINHA_PX;
}

function alturaDeParte(parte: ContentPart): number {
  switch (parte.type) {
    case 'text':
      return alturaDeTexto(parte.text);
    // Raciocínio e execução nascem colapsados — a altura de primeira é a da
    // linha fechada, não a do corpo que só existe depois do toque.
    case 'thinking':
    case 'tool_use':
    case 'tool_result':
      return COLAPSADA_PX;
  }
}

export function estimaAltura(item: RenderItem): number {
  switch (item.kind) {
    case 'user':
    case 'user-internal':
      return alturaDeTexto(item.text) + MOLDURA_PX;
    case 'meta-decision':
      return alturaDeTexto(item.text) + MOLDURA_PX;
    case 'assistant': {
      const corpo = item.parts.reduce((soma, parte) => soma + alturaDeParte(parte), 0);
      return Math.max(COLAPSADA_PX, corpo) + MOLDURA_PX;
    }
    case 'chip':
    case 'synthetic':
    case 'channel':
    case 'sidechain-group':
    case 'sidechain-cluster':
      return COLAPSADA_PX + MOLDURA_PX;
    case 'ask-user':
      // Pergunta aberta é um cartão com ação: mais alto que uma linha, e o
      // número só importa até a primeira medição.
      return COLAPSADA_PX * 2 + MOLDURA_PX;
  }
}
