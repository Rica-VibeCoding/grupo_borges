/**
 * As chaves de liga/desliga da folha de configurações. Como a escolha de visual,
 * moram no `localStorage` do aparelho e não passam pelo backend. Qualquer valor
 * que não seja o "ligado" gravado aqui conta como desligado: o padrão é a tela
 * limpa e a conversa sem fone.
 */

export const CHAVE_FONE = 'ck-conversa-fone';
export const CHAVE_TEXTO = 'ck-conversa-texto';
export type ChaveLigada = typeof CHAVE_FONE | typeof CHAVE_TEXTO;
/** A dica dos gestos já apareceu neste aparelho ("1"): não aparece mais. */
export const CHAVE_DICA_DOS_GESTOS = 'ck-conversa-dica-gestos';

const LIGADO = '1';

export function leLigado(bruto: string | null | undefined): boolean {
  return bruto === LIGADO;
}

export function gravaLigado(ligado: boolean): string {
  return ligado ? LIGADO : '0';
}
