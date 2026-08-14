const COMANDO_RE = /^\s*\//;

/**
 * O toggle do Canarinho só transforma texto novo. Comandos já escritos pelo
 * Rica preservam a própria semântica, e uma retomada reenvia byte a byte o
 * corpo que a máquina já guardou.
 */
export function prefixaPesquisa(corpo: string, ativa: boolean, retomada = false): string {
  if (!ativa || retomada || !corpo.trim() || COMANDO_RE.test(corpo)) return corpo;
  return `/pesquisa ${corpo}`;
}
