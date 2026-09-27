/**
 * A gaveta da tropa que segue o dedo (fase 3, pedido do Rica em 27/09): anda com o dedo e, ao
 * soltar, assenta com a mola da folha de configurações — a única que ele achou bonita. Aqui
 * mora só a regra, sem DOM: quando o arrasto vira de lado, quanto andou e para onde vai.
 * Chat ⇄ voz não passa por aqui: é a rolagem nativa do pager.
 */

import { LIMIAR, type Ponto } from './gesto-de-arrasto.ts';

// Sem faixa de borda (D2 do Rica, 27/09): ele não usa o voltar do Safari pela borda no cockpit, e a
// faixa de 24 px engolia justamente o dedo que abre a tropa. O gesto começa de qualquer ponto.

/** O tempo e a curva da folha (vaul 1.1.2, `TRANSITIONS`): 500 ms, sai rápido e pousa devagar. */
export const MOLA = { duracaoMs: 500, curva: 'cubic-bezier(0.32, 0.72, 0, 1)' } as const;

/** Arremesso: acima disto (px/ms) soltar vale o destino, ande o quanto andou — o `VELOCITY_THRESHOLD` da folha. */
export const ARREMESSO = 0.4;

/** As amostras que medem a velocidade na hora de soltar: só o fim do gesto conta. */
export const JANELA_DA_VELOCIDADE_MS = 100;

export type Eixo = 'horizontal' | 'vertical';

/**
 * O eixo se decide logo que o dedo sai do raio do toque, pela direção desses primeiros
 * pixels: de lado se anda mais de lado que na vertical (até 45°). Decidido, fica: o arco que
 * o polegar faz depois não desfaz o gesto. É o que a regra antiga (o dobro, medido do começo
 * ao fim) não perdoava — o arrasto curvo do polegar era recusado.
 */
export function travaEixo(inicio: Ponto, atual: Ponto): Eixo | null {
  const dx = atual.x - inicio.x;
  const dy = atual.y - inicio.y;
  if (Math.hypot(dx, dy) <= LIMIAR.toque) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
}

/** O quanto andou rumo ao destino, sem passar dele nem voltar além do começo. */
export function limitaAvanco(avanco: number, extensao: number): number {
  return Math.min(Math.max(avanco, 0), extensao);
}

export type Amostra = { t: number; x: number };

/** px/ms no eixo x, com sinal, medidos nas amostras da última janela. Sem amostra bastante, zero. */
export function velocidadeFinal(amostras: readonly Amostra[], janelaMs = JANELA_DA_VELOCIDADE_MS): number {
  const ultima = amostras.at(-1);
  if (!ultima) return 0;
  const primeira = amostras.find((a) => a.t >= ultima.t - janelaMs) ?? ultima;
  const tempo = ultima.t - primeira.t;
  return tempo > 0 ? (ultima.x - primeira.x) / tempo : 0;
}

export type Soltura = 'vai' | 'volta';

/**
 * Soltou: vai ao destino se passou da metade ou se foi arremessado; senão volta. Abaixo do
 * limiar de sempre (`LIMIAR.arrasto`) nunca vai, com a pressa que for — e arremessar de volta
 * desiste, mesmo depois da metade.
 *
 * `velocidade` é px/ms rumo ao destino: negativa quando o dedo está voltando.
 */
export function decideSoltura(avanco: number, extensao: number, velocidade: number): Soltura {
  if (avanco < LIMIAR.arrasto) return 'volta';
  if (velocidade >= ARREMESSO) return 'vai';
  if (velocidade <= -ARREMESSO) return 'volta';
  return avanco >= extensao / 2 ? 'vai' : 'volta';
}

/** Com movimento reduzido nada anda com o dedo: vale o limiar, como antes da mola. */
export function decideSemMovimento(avanco: number): Soltura {
  return avanco >= LIMIAR.arrasto ? 'vai' : 'volta';
}
