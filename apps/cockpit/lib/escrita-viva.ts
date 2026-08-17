'use client';

/**
 * ESTÁ SAINDO OUTPUT AGORA? — o segundo sinal que só o feed tem, no mesmo molde
 * de `lib/turno-vivo.ts` e pelo mesmo motivo: quem abre o SSE é o feed, quem
 * precisa saber é o composer, e abrir uma segunda conexão para ler um booleano
 * seria pagar o stream duas vezes.
 *
 * Por que não bastava o turno vivo: ele responde "há um turno em voo", e é com
 * ele que a bolinha pensa. Mas o turno é quase todo execução — sem separar,
 * o mascote fica com uma cara só do começo ao fim, que foi exatamente o que o
 * Rica reportou em 17/08 ("não muda, a não ser quando o agente para").
 *
 * A RÉGUA ERRADA QUE ISTO CORRIGE: a primeira versão acendia só em texto
 * crescendo, e ferramenta rodando caía em "pensando". Só que "Executando" é a
 * palavra que o PRÓPRIO cockpit escreve na linha viva quando roda ferramenta —
 * o vocabulário do produto já existia e o sinal estava ligado na coisa errada.
 * Agora vale para os dois: ferramenta em voo OU texto crescendo, que é o que
 * "observando o que está sendo escrito" quer dizer na tela.
 *
 * IDENTIDADE DE SNAPSHOT é requisito do `useSyncExternalStore`: o valor é um
 * booleano primitivo, e a gravação só notifica na VIRADA — senão todo flush do
 * stream (que chega a cada token) acordaria o composer à toa.
 */

import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import type { ItemDoFeed } from '../components/feed/grupo-ferramentas';
import { trabalhoEmVooNoFim } from '../components/feed/linha-viva.ts';

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

/** Tem output saindo no fim do feed — ferramenta em voo OU texto crescendo.
 *
 *  As duas metades são exatamente as que a linha viva já usa para escolher entre
 *  "Executando <cmd>" e "Pensando há 12 s": `trabalhoEmVooNoFim` é a mesma peça,
 *  importada, não recopiada. A bolinha e a linha azul precisam contar a MESMA
 *  história — se divergirem, uma das duas está mentindo na mesma tela. */
export function saindoOutputNoFim(
  itens: readonly ItemDoFeed[],
  lookup?: ToolResultLookup,
): boolean {
  return trabalhoEmVooNoFim(itens, lookup) || escrevendoNoFim(itens);
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
