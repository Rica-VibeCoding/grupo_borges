/**
 * A régua do contexto — a aritmética, fora do componente.
 *
 * É o LUGAR CENTRAL pedido pelo Rica (09/08): statusline, tropa e gaveta leem o
 * teto e a escala daqui. Antes o `30` aparecia escrito à mão na string da gaveta
 * (`app/agente/[slug]/page.tsx`), e um teto escrito em dois lugares vira dois
 * tetos no dia em que um deles muda.
 *
 * Módulo neutro de propósito — sem `'use client'`, igual ao `estado.ts`.
 *
 * ## Por que a régua não é linear
 *
 * A barra é contínua por ordem do Rica (*"eu prefiro a contínua"*), e aí as duas
 * escalas óbvias falham, cada uma de um jeito:
 *
 * - **0 a 100 linear** desperdiça a barra inteira. A frota vive entre 5% e 40%:
 *   todo mundo desenha um toquinho à esquerda e as nove linhas ficam idênticas —
 *   exatamente o defeito que fez a primeira barra ser reprovada.
 * - **0 a 50 linear** dá resolução na faixa certa, mas satura: 55% e 95%
 *   encostam os dois no fim e desenham igual. A diferença entre "passou do teto"
 *   e "vai compactar a qualquer momento" some no caso mais grave — achado do
 *   Daniel, que vale igual aqui.
 *
 * Então a régua tem DOIS TRECHOS: a faixa de operação (0 até o teto) ocupa 70%
 * da barra, e todo o resto (do teto até 100) divide os 30% finais. O ganho é
 * duplo — resolução onde a frota realmente está, e função monótona até 100%, que
 * é o que garante que dois valores diferentes nunca desenhem igual.
 *
 * A quebra de inclinação cai no teto, o mesmo ponto onde a cor muda. Não há nada
 * desenhado ali: a mudança de trecho é invisível, quem marca o teto é a cor.
 */

/** Teto de contexto da frota. Não é enfeite: acima disso o agente compacta.
 *  Ordem do Rica de 30/07, escrita em `ze-shared/AGENTS.md`. */
export const TETO_PCT = 30;

/** Quanto da barra a faixa de operação (0 → teto) toma para si. O resto da
 *  escala inteira se espreme nos 30% que sobram — de propósito: ali o que
 *  importa é ordenar "passou pouco" e "passou muito", não medir com precisão. */
export const FATIA_ATE_O_TETO = 0.7;

/** Piso de desenho: 1% de contexto já é contexto, e um fio de 0,6px não aparece.
 *  Mesmo princípio do `Math.ceil` que a régua de células usava — quem tem alguma
 *  coisa mostra alguma coisa. */
export const PISO_VISIVEL = 0.04;

/** Passou do teto? É isto que decide a cor do preenchimento — e é a única marca
 *  do teto que existe, por ordem do Rica: *"essa barrinha na vertical é feio"*,
 *  *"passou de 30% muda de cor"*. Nada é desenhado por cima da barra. */
export function passouDoTeto(pct: number): boolean {
  return pct > TETO_PCT;
}

/**
 * Que fatia da barra o valor preenche, de 0 a 1.
 *
 * Acima de 100% clampa: 100 é o fim real da janela do modelo, não há "além" para
 * desenhar. Abaixo de 0 (dado torto vindo do pane) clampa em vazio em vez de
 * inverter a barra.
 */
export function fracaoDoMedidor(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;

  const bruta =
    pct <= TETO_PCT
      ? (pct / TETO_PCT) * FATIA_ATE_O_TETO
      : FATIA_ATE_O_TETO + ((pct - TETO_PCT) / (100 - TETO_PCT)) * (1 - FATIA_ATE_O_TETO);

  return Math.min(1, Math.max(PISO_VISIVEL, bruta));
}
