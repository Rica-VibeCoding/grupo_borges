'use client';

/**
 * O AGENTE ESTÁ ESCREVENDO A RESPOSTA AGORA? — o segundo sinal que só o feed
 * tem, no mesmo molde de `lib/turno-vivo.ts` e pelo mesmo motivo: quem abre o
 * SSE é o feed, quem precisa saber é o composer, e abrir uma segunda conexão
 * para ler um booleano seria pagar o stream duas vezes.
 *
 * Por que não bastava o turno vivo: ele responde "há um turno em voo", e é com
 * ele que a bolinha pensa. Mas pensar e responder são coisas diferentes na
 * tela — enquanto o agente lê arquivo e roda comando, o fim do feed é execução;
 * quando ele começa a escrever, o fim vira texto que cresce. Sem separar os
 * dois, o mascote fica com uma cara só para o turno inteiro, e é justamente a
 * troca de cara que faz a bolinha substituir o "Pensando há 12 s".
 *
 * IDENTIDADE DE SNAPSHOT é requisito do `useSyncExternalStore`: o valor é um
 * booleano primitivo, e a gravação só notifica na VIRADA — senão todo flush do
 * stream (que chega a cada token) acordaria o composer à toa.
 */

import type { ItemDoFeed } from '../components/feed/grupo-ferramentas';

const porAgente = new Map<string, boolean>();
const ouvintes = new Map<string, Set<() => void>>();

/** O fim do feed é texto do assistente crescendo?
 *
 *  A régua é a ÚLTIMA parte do ÚLTIMO item, não "existe texto em algum lugar":
 *  um item de assistente costuma ser `text` seguido de `tool_use`, e nesse caso
 *  quem está no ar é a ferramenta, não a escrita. É o complemento exato do
 *  `trabalhoEmVooNoFim` da linha viva. */
export function escrevendoNoFim(itens: readonly ItemDoFeed[]): boolean {
  const ultimo = itens[itens.length - 1];
  if (!ultimo || ultimo.kind !== 'assistant') return false;
  const ultimaParte = ultimo.parts[ultimo.parts.length - 1];
  return ultimaParte?.type === 'text';
}

/** Chamado pelo feed a cada mudança. Só notifica na virada. */
export function publicaEscritaViva(slug: string, escrevendo: boolean): void {
  if ((porAgente.get(slug) ?? false) === escrevendo) return;
  if (escrevendo) porAgente.set(slug, true);
  else porAgente.delete(slug);
  for (const fn of ouvintes.get(slug) ?? []) fn();
}

export function leEscritaViva(slug: string): boolean {
  return porAgente.get(slug) ?? false;
}

export function assinaEscritaViva(slug: string, fn: () => void): () => void {
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

/** Só para teste. */
export function limpaEscritaViva(): void {
  porAgente.clear();
  ouvintes.clear();
}
