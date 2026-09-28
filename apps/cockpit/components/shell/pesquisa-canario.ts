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

/** Quem tem o `/pesquisa`. Hoje só o Canarinho. */
export function podePesquisar(agentSlug: string): boolean {
  return agentSlug === 'canarinho';
}

/**
 * O estado do toggle, compartilhado entre a GAVETA (onde o botão mora desde
 * 28/09, pedido do Rica) e o COMPOSER (que prefixa o envio). Os dois são
 * irmãos distantes na árvore, então o estado mora aqui, fora do React, por
 * agente — e se lê pelo `usaPesquisaAtiva`. Vive o tempo da aba, como vivia o
 * `useState` do composer.
 */
const ativas = new Set<string>();
const ouvintes = new Set<() => void>();

export function pesquisaEstaAtiva(agentSlug: string): boolean {
  return ativas.has(agentSlug);
}

export function alternaPesquisa(agentSlug: string): void {
  if (ativas.has(agentSlug)) ativas.delete(agentSlug);
  else ativas.add(agentSlug);
  for (const ouvinte of ouvintes) ouvinte();
}

export function assinaPesquisa(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}
