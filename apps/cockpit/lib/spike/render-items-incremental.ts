import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import {
  buildRenderItems,
  coalesceSidechainGroups,
} from '@grupo_borges/cockpit-core/render-items';

import { juntaMetadesDoAnexo } from '../../components/feed/anexo-imagem.ts';
import {
  agrupaFerramentas,
  ehLinhaDeTrabalho,
  type ItemDoFeed,
} from '../../components/feed/grupo-ferramentas.ts';
import { temConteudoVisivel } from './conteudo-visivel.ts';
import {
  rewindAcrossClassifierConsumption,
  rewindAcrossCoalescedRun,
  rewindAtravesDoAnexoPicado,
  rewindForChangedSidechains,
  rewindForQueuedEcho,
  rewindToWholeSidechainGroups,
  rootsAt,
  samePrefix,
  type ItemCru,
  type RawEntry,
} from './fronteira-da-cauda.ts';

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
    // O CC pica o envelope da imagem em DUAS mensagens (a legenda numa, o
    // caminho na outra) e o feed desenhava as duas: balão de texto em cima,
    // foto solta embaixo. Remontadas aqui, viram o cartão único da Tara —
    // forma aprovada pelo Rica em 15/08. A posição é a da primeira metade,
    // que é onde a fala dele entrou na conversa.
    const proxima = entries[index + 1];
    if (entry.item.kind === 'user' && proxima?.item.kind === 'user') {
      const inteiro = juntaMetadesDoAnexo(entry.item.text, proxima.item.text);
      if (inteiro !== null) {
        output.push({
          item: { ...entry.item, text: inteiro },
          start: Math.min(entry.start, proxima.start),
          end: Math.max(entry.end, proxima.end),
        });
        index += 2;
        continue;
      }
    }
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
        boundary = rewindAtravesDoAnexoPicado(rawEntries, boundary);
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
