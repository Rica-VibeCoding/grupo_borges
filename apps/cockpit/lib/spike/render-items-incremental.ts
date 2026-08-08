import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import type { RenderItem } from '@grupo_borges/cockpit-core/render-items';
import {
  buildRenderItems,
  buildSidechainRoots,
  coalesceSidechainGroups,
  resolucaoDaFila,
} from '@grupo_borges/cockpit-core/render-items';

import {
  agrupaFerramentas,
  ehLinhaDeTrabalho,
  type ItemDoFeed,
} from '../../components/feed/grupo-ferramentas.ts';
import { temConteudoVisivel } from './conteudo-visivel.ts';

/** O item cru, pré-agrupamento: exatamente o que o `buildRenderItems` do core
 *  produz. O agrupamento de ferramentas é o `grupo-ferramentas` deste app, não
 *  um kind do core. */
type ItemCru = RenderItem;

type RawEntry = {
  item: ItemCru;
  start: number;
  end: number;
};

type OutputEntry = {
  item: ItemDoFeed;
  start: number;
  end: number;
};

export type IncrementalRenderItemsStats = {
  reprocessedMessages: number;
  totalMessages: number;
};

const statsByInstance = new WeakMap<object, IncrementalRenderItemsStats>();

function samePrefix(previous: readonly MessagePayload[], current: readonly MessagePayload[]): boolean {
  if (current.length < previous.length) return false;
  if (previous.length === 0) return true;
  return previous[0] === current[0]
    && previous[previous.length - 1] === current[previous.length - 1];
}

function rootsAt(messages: readonly MessagePayload[]): Map<string, string> {
  return buildSidechainRoots([...messages]);
}

function rewindForChangedSidechains(
  previous: readonly MessagePayload[],
  current: readonly MessagePayload[],
  boundary: number,
): number {
  const oldRoots = rootsAt(previous);
  const newRoots = rootsAt(current);
  const affectedRoots = new Set<string>();
  let existingRootChanged = false;

  for (let index = 0; index < previous.length; index++) {
    const message = previous[index];
    if (!message.is_sidechain) continue;
    if (oldRoots.get(message.uuid) !== newRoots.get(message.uuid)) {
      existingRootChanged = true;
      affectedRoots.add(oldRoots.get(message.uuid) ?? message.parent_uuid ?? message.uuid);
      affectedRoots.add(newRoots.get(message.uuid) ?? message.parent_uuid ?? message.uuid);
    }
  }
  for (let index = previous.length; index < current.length; index++) {
    const message = current[index];
    if (message.is_sidechain) {
      affectedRoots.add(newRoots.get(message.uuid) ?? message.parent_uuid ?? message.uuid);
    }
  }

  if (affectedRoots.size === 0) return boundary;
  for (let index = 0; index < current.length; index++) {
    const message = current[index];
    if (!message.is_sidechain) continue;
    if (existingRootChanged) boundary = Math.min(boundary, index);
    const root = newRoots.get(message.uuid) ?? message.parent_uuid ?? message.uuid;
    if (affectedRoots.has(root)) boundary = Math.min(boundary, index);
  }
  return boundary;
}

function rewindAcrossCoalescedRun(entries: readonly RawEntry[], boundary: number): number {
  let index = entries.length;
  while (index > 0 && entries[index - 1].end >= boundary) index--;
  while (index > 0 && entries[index - 1].item.kind === 'sidechain-group') index--;
  return index < entries.length ? Math.min(boundary, entries[index].start) : boundary;
}

function rewindAcrossClassifierConsumption(entries: readonly RawEntry[], boundary: number): number {
  const predecessor = entries.find(
    (entry) => entry.start === boundary - 1
      && entry.item.kind === 'chip'
      && entry.item.classifierKind === 'skill',
  );
  return predecessor ? predecessor.start : boundary;
}

// O que resolve uma mensagem enfileirada — o eco `user` ou o fim do turno —
// muda um item ANTERIOR: apaga a marca "na fila" e, no caso do eco, descarta
// a repetição (`resolucaoDaFila`). Sem trazer a fronteira até o `queued`, a
// cauda reprocessada não enxerga o par: o eco vira uma SEGUNDA bolha da mesma
// frase e a marca nunca cai.
//
// A régua é "o gatilho está DENTRO da janela", não "o gatilho acabou de
// chegar": a fronteira padrão já reprocessa a última mensagem a cada flush, e
// um gatilho reprocessado sem o par ressuscita a bolha duplicada mesmo sem
// mensagem nova. Varre de trás pra frente porque baixar a fronteira pode
// puxar um gatilho anterior pra dentro da janela — descendo, ele ainda é
// testado.
function rewindForQueuedEcho(current: readonly MessagePayload[], boundary: number): number {
  const gatilhos = [...resolucaoDaFila(current).gatilhos];
  for (let index = gatilhos.length - 1; index >= 0; index--) {
    const [gatilho, fila] = gatilhos[index];
    if (gatilho >= boundary) boundary = Math.min(boundary, fila);
  }
  return boundary;
}

function rewindToWholeSidechainGroups(
  messages: readonly MessagePayload[],
  boundary: number,
): number {
  const roots = rootsAt(messages);
  const rootsInTail = new Set<string>();
  for (let index = boundary; index < messages.length; index++) {
    const message = messages[index];
    if (!message.is_sidechain) continue;
    rootsInTail.add(roots.get(message.uuid) ?? message.parent_uuid ?? message.uuid);
  }
  for (let index = 0; index < boundary; index++) {
    const message = messages[index];
    if (!message.is_sidechain) continue;
    const root = roots.get(message.uuid) ?? message.parent_uuid ?? message.uuid;
    if (rootsInTail.has(root)) boundary = index;
  }
  return boundary;
}

function annotateTail(
  messages: readonly MessagePayload[],
  boundary: number,
  items: readonly ItemCru[],
): RawEntry[] {
  // Índice por `id`, não por identidade de objeto: o item de uma mensagem
  // enfileirada carrega uma CÓPIA normalizada do payload (o core troca o kind
  // e move o texto pra dentro do `message`), e por identidade ela não seria
  // achada — a entrada cairia toda no `boundary` e desalinharia os cortes.
  const absoluteIndex = new Map<number, number>();
  for (let index = boundary; index < messages.length; index++) {
    absoluteIndex.set(messages[index].id, index);
  }
  const hasSidechainItem = items.some((item) => item.kind === 'sidechain-group');
  const roots = hasSidechainItem ? rootsAt(messages) : new Map<string, string>();
  const firstByRoot = new Map<string, number>();
  const lastByRoot = new Map<string, number>();
  for (let index = boundary; index < messages.length; index++) {
    const message = messages[index];
    if (!message.is_sidechain) continue;
    const root = roots.get(message.uuid) ?? message.parent_uuid ?? message.uuid;
    if (!firstByRoot.has(root)) firstByRoot.set(root, index);
    lastByRoot.set(root, index);
  }

  return items.map((item) => {
    if (item.kind === 'sidechain-group') {
      return {
        item,
        start: firstByRoot.get(item.rootUuid) ?? boundary,
        end: lastByRoot.get(item.rootUuid) ?? boundary,
      };
    }
    if ('payload' in item) {
      const index = absoluteIndex.get(item.payload.id) ?? boundary;
      return { item, start: index, end: index };
    }
    return { item, start: boundary, end: boundary };
  });
}

function coalesceEntries(entries: readonly RawEntry[]): OutputEntry[] {
  const output: OutputEntry[] = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    // Duas famílias agrupam (§7): runs de sidechain viram cluster, runs de
    // linha de trabalho viram grupo de ferramentas. Uma run é sempre de UMA
    // família, então uma passagem basta — equivale a aplicar os dois
    // coalescedores em sequência. A família da ferramenta é a LINHA DE
    // TRABALHO (chip ∪ assistant só de tool_use), não o chip do
    // `coalesceToolGroups`: o classificador só emite chip com resultado
    // >300 caracteres — 18 das 148 execuções da conversa medida em 02/08 —
    // e agrupar só ele deixaria a parede de trabalho intacta.
    const familia = entry.item.kind === 'sidechain-group'
      ? 'sidechain'
      : ehLinhaDeTrabalho(entry.item)
        ? 'execucao'
        : null;
    if (familia === null) {
      output.push(entry);
      index++;
      continue;
    }
    const mesmaFamilia = (candidate: RawEntry): boolean =>
      familia === 'sidechain'
        ? candidate.item.kind === 'sidechain-group'
        : ehLinhaDeTrabalho(candidate.item);
    let end = index + 1;
    while (end < entries.length && mesmaFamilia(entries[end])) end++;
    const run = entries.slice(index, end);
    // O lado sidechain devolve `RenderItem` no tipo, mas a run que entrou só
    // tinha sidechain-group — o que sai é group ou cluster.
    const [item] = (familia === 'sidechain'
      ? coalesceSidechainGroups(run.map((candidate) => candidate.item))
      : agrupaFerramentas(run.map((candidate) => candidate.item))) as ItemDoFeed[];
    output.push({
      item,
      start: Math.min(...run.map((candidate) => candidate.start)),
      end: Math.max(...run.map((candidate) => candidate.end)),
    });
    index = end;
  }
  return output;
}

function tailCut(entries: readonly { end: number }[], boundary: number): number {
  let index = entries.length;
  while (index > 0 && entries[index - 1].end >= boundary) index--;
  return index;
}

export function incrementalRenderItemsStats(instance: object): IncrementalRenderItemsStats | undefined {
  return statsByInstance.get(instance);
}

export function createIncrementalRenderItems(): {
  update(messages: readonly MessagePayload[]): ItemDoFeed[];
} {
  let previous: readonly MessagePayload[] = [];
  let rawEntries: RawEntry[] = [];
  let outputEntries: OutputEntry[] = [];
  const outputItems: ItemDoFeed[] = [];
  let sidechainParentUuids = new Set<string>();
  // Sem nenhuma mensagem enfileirada não há par a refazer, e o `paresFilaEco`
  // é uma varredura de tudo — o caso comum (fila vazia) não paga por ela.
  let temEnfileirado = false;

  const instance = {
    update(messages: readonly MessagePayload[]): ItemDoFeed[] {
      if (messages === previous) return outputItems;

      const previousLength = previous.length;
      const appendOnly = samePrefix(previous, messages);
      let boundary = appendOnly && previous.length > 0 ? previous.length - 1 : 0;
      if (appendOnly) {
        const appended = messages.slice(previous.length);
        const sidechainMayChange = appended.some(
          (message) => message.is_sidechain || sidechainParentUuids.has(message.uuid),
        );
        if (sidechainMayChange) {
          boundary = rewindForChangedSidechains(previous, messages, boundary);
        }
        if (temEnfileirado || appended.some((message) => message.kind === 'queued')) {
          boundary = rewindForQueuedEcho(messages, boundary);
        }
        boundary = rewindAcrossClassifierConsumption(rawEntries, boundary);
        boundary = rewindAcrossCoalescedRun(rawEntries, boundary);
        if (sidechainMayChange || messages.slice(boundary).some((message) => message.is_sidechain)) {
          boundary = rewindToWholeSidechainGroups(messages, boundary);
          boundary = rewindAcrossCoalescedRun(rawEntries, boundary);
        }
      }

      const stableRawLength = appendOnly ? tailCut(rawEntries, boundary) : 0;
      let stableOutputLength = appendOnly ? tailCut(outputEntries, boundary) : 0;
      // Dois estágios na cauda, na ordem em que precisam acontecer:
      //   1. temConteudoVisivel — item sem conteúdo não desenha NADA (ordem do
      //      Rica, 02/08): o assistant de thinking vazio virava padding puro.
      //      Filtrar ANTES de agrupar, senão o item oco quebraria a run de
      //      ferramentas em duas e o §7 nunca dispararia numa corrida real.
      //   2. coalesceEntries — §7: ferramentas consecutivas viram um grupo só.
      const tailItems = buildRenderItems([...messages.slice(boundary)])
        .filter(temConteudoVisivel) as ItemCru[];
      const tailEntries = annotateTail(messages, boundary, tailItems);

      // Janela de absorção da §7. Se a cauda reprocessada COMEÇA com linha de
      // trabalho, as linhas consecutivas que a antecedem voltam para a janela
      // e o grupo é refeito inteiro — MAS sem reprocessar mensagem: os itens
      // já classificados são reaproveitados como estão. A alternativa (mover
      // o boundary para trás da run, como o sidechain faz) reclassificaria a
      // corrida inteira a cada flush — com 738 Bash no baseline, o custo por
      // flush voltaria a crescer com o histórico, que é o que este módulo
      // existe para evitar. A linha de trabalho é imutável depois de
      // classificada (o único item que pode mudar de forma é o da ÚLTIMA
      // mensagem — um tool_use cujo resultado casa com a mensagem seguinte —
      // e ela está sempre na cauda pelo `boundary = previous.length - 1`),
      // então reusá-la é seguro — é por isso que o sidechain continua com
      // rewind de mensagem e a execução não precisa.
      let janela: RawEntry[] = tailEntries;
      if (appendOnly && tailEntries.length > 0 && ehLinhaDeTrabalho(tailEntries[0].item)) {
        let inicio = stableRawLength;
        while (inicio > 0 && ehLinhaDeTrabalho(rawEntries[inicio - 1].item)) inicio--;
        if (inicio < stableRawLength) {
          janela = [...rawEntries.slice(inicio, stableRawLength), ...tailEntries];
          // O grupo velho que cobre as linhas absorvidas sai da saída estável —
          // sem este corte ele ficaria E o grupo novo nasceria, duplicando as
          // execuções. (Mensagens invisíveis entre elas — o thinking vazio
          // filtrado acima — não deixam entrada, então o corte é por índice de
          // mensagem, não por posição na lista.)
          const inicioMsg = rawEntries[inicio].start;
          while (stableOutputLength > 0 && outputEntries[stableOutputLength - 1].end >= inicioMsg) {
            stableOutputLength--;
          }
        }
      }
      const coalescedTail = coalesceEntries(janela);

      rawEntries.splice(stableRawLength, rawEntries.length - stableRawLength, ...tailEntries);
      outputEntries.splice(stableOutputLength, outputEntries.length - stableOutputLength, ...coalescedTail);
      outputItems.splice(
        stableOutputLength,
        outputItems.length - stableOutputLength,
        ...coalescedTail.map((entry) => entry.item),
      );
      previous = messages;
      if (!appendOnly) {
        sidechainParentUuids = new Set();
        temEnfileirado = false;
      }
      for (let index = appendOnly ? previousLength : 0; index < messages.length; index++) {
        const message = messages[index];
        if (message.is_sidechain && message.parent_uuid) {
          sidechainParentUuids.add(message.parent_uuid);
        }
        if (message.kind === 'queued') temEnfileirado = true;
      }
      statsByInstance.set(instance, {
        reprocessedMessages: messages.length - boundary,
        totalMessages: messages.length,
      });
      return outputItems;
    },
  };

  return instance;
}
