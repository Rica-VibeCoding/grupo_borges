'use client';

/**
 * O CANAL do "Nova conversa" (e do comando `clear`) na Tara.
 *
 * O Composer e o FeedDaConversa são irmãos em `app/agente/[slug]/page.tsx`
 * (território do Daniel). Quando o Rica arma uma conversa nova — botão da
 * gaveta ou digitar `clear` no chat — o feed precisa zerar a lista NA HORA,
 * como o /clear do CC faz (72e67bd/732f685). O back devolve vazio enquanto o
 * `codex_next_fresh` estiver armado, mas esperar o poll de 3 s é tela parada;
 * este store dá o reset imediato, e o poll confirma.
 */

const porAgente = new Map<string, number>();
const ouvintes = new Map<string, Set<() => void>>();

/** Uma geração por slug — cada publicação incrementa; quem escuta zera a lista
 *  quando o número sobe. Primitivo, então `useSyncExternalStore` é seguro. */
export function publicaNovaConversa(slug: string): void {
  porAgente.set(slug, (porAgente.get(slug) ?? 0) + 1);
  for (const fn of ouvintes.get(slug) ?? []) fn();
}

export function assinaNovaConversa(slug: string, fn: () => void): () => void {
  let conjunto = ouvintes.get(slug);
  if (!conjunto) {
    conjunto = new Set();
    ouvintes.set(slug, conjunto);
  }
  conjunto.add(fn);
  return () => {
    conjunto.delete(fn);
    if (conjunto.size === 0) ouvintes.delete(slug);
  };
}

export function leGeracaoNovaConversa(slug: string): number {
  return porAgente.get(slug) ?? 0;
}

/** Só para teste. */
export function limpaNovaConversa(): void {
  porAgente.clear();
  ouvintes.clear();
}
