import type { FalaDaVez } from './fala-da-vez.ts';
import type { FalaDoZe } from './frases-da-voz.ts';
import { falasVisiveis } from './leitura-da-conversa.ts';
import type { Cena } from './moldura-estado.ts';

/**
 * O texto da conversa na tela de voz — PURO. Não é mais título: é a legenda do visual, pequena,
 * em meio-tom, logo abaixo da animação. Uma regra só: **só o agora brilha**.
 *
 * - ouvindo: as palavras ao vivo; a linha nova embaixo, as velhas somem por cima;
 * - entendendo: as palavras esmaecidas até o texto firme (sem nenhuma, reticências);
 * - pensando e erro: "Você disse", só com o texto firme DESTA vez (item 6: nada de fala velha);
 * - falando e pausado: a sua fala numa linha apagada em cima; a dele acompanha a voz palavra a
 *   palavra (`janela-que-corre.tsx`), o que falta não aparece. Pausado (falou por cima), congela.
 *
 * Sem "Mostrar texto", nada: o estado fica com a cor do visual e a palavra da pílula.
 */
export type TrechoDaLegenda =
  | { quem: 'voce'; forma: 'ao-vivo'; texto: string }
  | { quem: 'voce'; forma: 'disse'; texto: string | null; firme: boolean }
  | { quem: 'voce'; forma: 'recuada'; texto: string }
  | { quem: 'ze'; forma: 'resposta' | 'pausada'; fala: FalaDoZe };

export type EntradaDaLegenda = { cena: Cena; texto: boolean; fala: FalaDaVez; falaDoZe: FalaDoZe | null };

export function legendaDaVez({ cena, texto, fala, falaDoZe }: EntradaDaLegenda): TrechoDaLegenda[] {
  if (!texto) return [];
  if (cena === 'ouvindo') return fala.parcial ? [{ quem: 'voce', forma: 'ao-vivo', texto: fala.parcial }] : [];
  if (cena === 'transcrevendo') {
    return [{ quem: 'voce', forma: 'disse', texto: fala.firme ?? fala.parcial, firme: fala.firme !== null }];
  }
  const falas = falasVisiveis(cena);
  const trechos: TrechoDaLegenda[] = [];
  if (falas.voce === 'cheia' && fala.firme) trechos.push({ quem: 'voce', forma: 'disse', texto: fala.firme, firme: true });
  if (falas.voce === 'recuada' && fala.firme) trechos.push({ quem: 'voce', forma: 'recuada', texto: fala.firme });
  if (falas.ze && falaDoZe) trechos.push({ quem: 'ze', forma: cena === 'interrompendo' ? 'pausada' : 'resposta', fala: falaDoZe });
  return trechos;
}
