/**
 * A VOZ QUE TOCA SOZINHA — só no Ted (Rica, 18/11). O modelo puro: sem React,
 * sem áudio, sem rede.
 *
 * A REGRA DE 11/08 CONTINUA DE PÉ: na frota, e para Fred e Sofia, a resposta
 * só fala no toque (`bolha-voz.tsx`). A exceção é por agente
 * (`lib/perfil-do-agente.ts`) e tem três portas, todas obrigatórias:
 *
 * 1. A CHAVE NA MÃO DO DANIEL. "Ted fala / Ted fica quieto", lembrada no
 *    aparelho. Ligada por padrão — é o pedido —, mas um toque cala.
 * 2. SÓ DEPOIS DE UM GESTO NESTA ABERTURA (`armado`). Enviar ou tocar no
 *    microfone arma; abrir o app e ver o histórico, não. É o mesmo toque que
 *    destrava o áudio no iPhone — sem ele o Safari recusaria o som de qualquer
 *    jeito —, e é o que impede o Ted de "responder" mensagem velha ao abrir.
 * 3. SÓ O QUE CHEGOU DEPOIS DE ARMAR, e só quando o turno acaba: falas que
 *    chegam no meio do trabalho esperam a última, e o trecho é cortado por
 *    `trechoFalado` (fora da lousa, frase inteira, curto).
 */

import { trechoFalado } from '../../lib/lousa.ts';

export type ItemVigiado = { chave: string; kind: string };

export type VigiaDaFala = {
  /** A lista inteira, a cada mudança. Quem já foi visto não volta a contar. */
  observa(itens: readonly ItemVigiado[], armado: boolean): void;
  temPendente(): boolean;
  /** O trecho a falar — da última fala pendente com texto fora da lousa; esvazia a fila. */
  colhe(textoDe: (chave: string) => string | undefined): string | null;
};

export function criaVigiaDaFala(): VigiaDaFala {
  const vistas = new Set<string>();
  const pendentes: string[] = [];
  return {
    observa(itens, armado) {
      for (const item of itens) {
        if (vistas.has(item.chave)) continue;
        vistas.add(item.chave);
        if (armado && item.kind === 'assistant') pendentes.push(item.chave);
      }
    },
    temPendente: () => pendentes.length > 0,
    colhe(textoDe) {
      // A ÚLTIMA fala do turno que tenha o que dizer é a resposta; as do meio
      // ("vou procurar aqui") são andamento e ficam só na tela.
      const falas = pendentes.map((chave) => trechoFalado(textoDe(chave) ?? ''));
      pendentes.length = 0;
      return falas.filter((t): t is string => t !== null).at(-1) ?? null;
    },
  };
}

/** A chave do aparelho, por agente. Ausente = ligada (o pedido); só "0" cala. */
export const chaveDaFala = (slug: string) => `ck-fala-sozinha:${slug}`;

export function leFalaLigada(bruto: string | null | undefined): boolean {
  return bruto !== '0';
}

export function gravaFalaLigada(ligada: boolean): string {
  return ligada ? '1' : '0';
}

/** Turno acabado e quieto por este tanto antes de falar: entre uma fala e a
 *  ferramenta seguinte o turno pode piscar parado, e falar no vale seria ler
 *  o "vou ver aqui" em vez da resposta. */
export const ESPERA_DO_FIM_MS = 900;
