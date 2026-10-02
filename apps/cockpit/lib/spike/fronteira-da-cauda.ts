// Onde a cauda reprocessada começa. O `update` de `render-items-incremental.ts`
// parte de `previous.length - 1` e cada regra daqui pode puxar a fronteira para
// trás — nunca para a frente —, até ela cair num ponto em que reclassificar só a
// cauda dá o mesmo feed que reclassificar a conversa inteira.

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import type { RenderItem } from '@grupo_borges/cockpit-core/render-items';
import { buildSidechainRoots, resolucaoDaFila } from '@grupo_borges/cockpit-core/render-items';

import { juntaMetadesDoAnexo } from '../../components/feed/anexo-imagem.ts';

/** O item cru, pré-agrupamento: exatamente o que o `buildRenderItems` do core
 *  produz. O agrupamento de ferramentas é o `grupo-ferramentas` deste app, não
 *  um kind do core. */
export type ItemCru = RenderItem;

export type RawEntry = {
  item: ItemCru;
  start: number;
  end: number;
};

export function samePrefix(previous: readonly MessagePayload[], current: readonly MessagePayload[]): boolean {
  if (current.length < previous.length) return false;
  if (previous.length === 0) return true;
  return previous[0] === current[0]
    && previous[previous.length - 1] === current[previous.length - 1];
}

export function rootsAt(messages: readonly MessagePayload[]): Map<string, string> {
  return buildSidechainRoots([...messages]);
}

export function rewindForChangedSidechains(
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

export function rewindAcrossCoalescedRun(entries: readonly RawEntry[], boundary: number): number {
  let index = entries.length;
  while (index > 0 && entries[index - 1].end >= boundary) index--;
  while (index > 0 && entries[index - 1].item.kind === 'sidechain-group') index--;
  return index < entries.length ? Math.min(boundary, entries[index].start) : boundary;
}

// A metade com o caminho da imagem só vira cartão ao lado da metade com a
// legenda. Se a fronteira cai ENTRE as duas, a cauda reprocessada enxerga só o
// caminho, a legenda fica presa na parte estável e o par se desfaz na tela —
// acontece em qualquer `update` que não traga mensagem nova, porque a
// fronteira vira `previous.length - 1`, exatamente o meio de um par no fim da
// conversa. Trazer a fronteira para a primeira metade mantém as duas na janela.
export function rewindAtravesDoAnexoPicado(entries: readonly RawEntry[], boundary: number): number {
  if (boundary <= 0) return boundary;
  const primeira = entries.find((entry) => entry.start === boundary - 1);
  const segunda = entries.find((entry) => entry.start === boundary);
  if (primeira?.item.kind !== 'user' || segunda?.item.kind !== 'user') return boundary;
  return juntaMetadesDoAnexo(primeira.item.text, segunda.item.text) === null
    ? boundary
    : primeira.start;
}

export function rewindAcrossClassifierConsumption(entries: readonly RawEntry[], boundary: number): number {
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
export function rewindForQueuedEcho(current: readonly MessagePayload[], boundary: number): number {
  const gatilhos = [...resolucaoDaFila(current).gatilhos];
  for (let index = gatilhos.length - 1; index >= 0; index--) {
    const [gatilho, fila] = gatilhos[index];
    if (gatilho >= boundary) boundary = Math.min(boundary, fila);
  }
  return boundary;
}

export function rewindToWholeSidechainGroups(
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
