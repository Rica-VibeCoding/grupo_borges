/**
 * O ritmo do Histórico na Motion (rodada 2 das conversas). A Motion quer
 * número, não token: isto espelha `--ck-dur-*`, `--ck-ease*` e `--ck-mola` do
 * globals.css, como o `troca-de-fileira.ts` do composer. Mudou lá, muda aqui.
 */

const EASE = [0.2, 0, 0.2, 1] as const; // --ck-ease
const EASE_SAIDA = [0.4, 0, 1, 1] as const; // --ck-ease-exit

export const TOQUE = { duration: 0.12, ease: EASE } as const; // --ck-dur-fast
export const ENTRADA = { duration: 0.2, ease: EASE } as const; // --ck-dur-enter
export const SAIDA = { duration: 0.2, ease: EASE_SAIDA } as const;
export const CALMA = { duration: 0.32, ease: EASE } as const; // --ck-dur-calm

/** Os pontos do `linear()` da `--ck-mola`: [progresso, valor]. */
const PONTOS_DA_MOLA: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.03, 0.03],
  [0.06, 0.104],
  [0.1, 0.238],
  [0.14, 0.386],
  [0.18, 0.527],
  [0.23, 0.68],
  [0.28, 0.799],
  [0.34, 0.899],
  [0.4, 0.961],
  [0.47, 0.998],
  [0.55, 1.013],
  [0.65, 1.014],
  [0.8, 1.006],
  [1, 1],
];

/** A `--ck-mola` como função de easing: a mesma curva por trechos retos do `linear()`. */
export function mola(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  for (let i = 1; i < PONTOS_DA_MOLA.length; i++) {
    const [t1, v1] = PONTOS_DA_MOLA[i];
    if (t <= t1) {
      const [t0, v0] = PONTOS_DA_MOLA[i - 1];
      return v0 + ((t - t0) / (t1 - t0)) * (v1 - v0);
    }
  }
  return 1;
}

/** Entrada com peso (o pulso da ⭐), na duração de entrada. */
export const COM_MOLA = { duration: 0.32, ease: mola } as const;

/** A volta da barra indeterminada da espera, e o respirar do esqueleto. */
export const VOLTA_DA_BARRA = { duration: 1.4, ease: EASE, repeat: Infinity } as const;
export const RESPIRO_DO_ESQUELETO = { duration: 1.6, ease: EASE, repeat: Infinity } as const;

/** Quanto a lista espera, depois de voltar da leitura, para tirar a linha que
 *  saiu: o fade da volta (`.ck-surge`) termina antes, e a saída da linha é vista. */
export const ESPERA_DA_VOLTA_MS = 220;
