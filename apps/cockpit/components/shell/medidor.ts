/**
 * A régua do medidor de contexto — a aritmética, fora do componente.
 *
 * Mora num módulo próprio porque é lógica pura e precisa de teste: os casos que
 * mais importam (acima do teto, acima do fim da escala) são justamente os que
 * quase nunca aparecem na tela na hora em que se está olhando, e um desenho que
 * só se prova quando a frota coopera não se prova nunca.
 *
 * Módulo neutro de propósito — sem `'use client'`, igual ao `estado.ts`.
 */

/** Teto de contexto da frota. Não é enfeite: acima disso o agente compacta.
 *  Ordem do Rica de 30/07, escrita em `ze-shared/AGENTS.md`. */
export const TETO_PCT = 30;

/** Onde a régua termina. Para em 50, não em 100, porque a frota vive entre 5% e
 *  40%: numa escala até 100 todo mundo acendia o mesmo toquinho à esquerda e as
 *  nove linhas ficavam idênticas. E não vai a 60 (o dobro do teto) porque aí a
 *  zona além do limite ficava com metade do desenho para um caso raro. */
export const ESCALA_PCT = 50;

export const CELULAS = 10;
export const PCT_POR_CELULA = ESCALA_PCT / CELULAS;

/** Índice da primeira célula que já passou do teto. DERIVADO: mudar o teto da
 *  frota reajusta o desenho sozinho, sem ninguém precisar lembrar deste arquivo. */
export const CELULA_DO_TETO = TETO_PCT / PCT_POR_CELULA;

export type CelulaMedidor = {
  acesa: boolean;
  /** Esta célula representa contexto acima do teto — acesa, sai em âmbar. */
  alemDoTeto: boolean;
  /** A régua acabou e o valor não. Só a última célula carrega isto. */
  saturada: boolean;
};

/**
 * Quais células acendem, e como.
 *
 * `Math.ceil` de propósito: 1% de contexto já é contexto, e uma célula apagada
 * diria "zero". Quem tem alguma coisa acende alguma coisa.
 *
 * A saturação existe porque encurtar a escala tem um custo, e ele cai no caso
 * mais grave: sem ela, 55% e 95% desenhavam as mesmas dez células âmbar, e a
 * diferença entre "passou do teto" e "vai compactar a qualquer momento"
 * desaparecia do desenho. A última célula muda de forma para dizer que a régua
 * acabou antes do valor — quanto exatamente, o percentual ao lado responde.
 */
export function celulasDoMedidor(pct: number): CelulaMedidor[] {
  const acesas = Math.min(CELULAS, Math.ceil(pct / PCT_POR_CELULA));
  const saturou = pct > ESCALA_PCT;
  return Array.from({ length: CELULAS }, (_, i) => ({
    acesa: i < acesas,
    alemDoTeto: i >= CELULA_DO_TETO,
    saturada: saturou && i === CELULAS - 1,
  }));
}
