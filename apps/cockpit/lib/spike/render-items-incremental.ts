import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import type { RenderItem } from '@grupo_borges/cockpit-core/render-items';
import {
  buildRenderItems,
  buildSidechainRoots,
  coalesceSidechainGroups,
} from '@grupo_borges/cockpit-core/render-items';

type RawEntry = {
  item: RenderItem;
  start: number;
  end: number;
};

type OutputEntry = {
  item: RenderItem;
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
  items: readonly RenderItem[],
): RawEntry[] {
  const absoluteIndex = new Map<MessagePayload, number>();
  for (let index = boundary; index < messages.length; index++) {
    absoluteIndex.set(messages[index], index);
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
      const index = absoluteIndex.get(item.payload) ?? boundary;
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
    if (entry.item.kind !== 'sidechain-group') {
      output.push(entry);
      index++;
      continue;
    }
    let end = index + 1;
    while (end < entries.length && entries[end].item.kind === 'sidechain-group') end++;
    const run = entries.slice(index, end);
    const [item] = coalesceSidechainGroups(run.map((candidate) => candidate.item));
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
  update(messages: readonly MessagePayload[]): RenderItem[];
} {
  let previous: readonly MessagePayload[] = [];
  let rawEntries: RawEntry[] = [];
  let outputEntries: OutputEntry[] = [];
  const outputItems: RenderItem[] = [];
  let sidechainParentUuids = new Set<string>();

  const instance = {
    update(messages: readonly MessagePayload[]): RenderItem[] {
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
        boundary = rewindAcrossClassifierConsumption(rawEntries, boundary);
        boundary = rewindAcrossCoalescedRun(rawEntries, boundary);
        if (sidechainMayChange || messages.slice(boundary).some((message) => message.is_sidechain)) {
          boundary = rewindToWholeSidechainGroups(messages, boundary);
          boundary = rewindAcrossCoalescedRun(rawEntries, boundary);
        }
      }

      const stableRawLength = appendOnly ? tailCut(rawEntries, boundary) : 0;
      const stableOutputLength = appendOnly ? tailCut(outputEntries, boundary) : 0;
      const tailItems = buildRenderItems([...messages.slice(boundary)]);
      const tailEntries = annotateTail(messages, boundary, tailItems);
      const coalescedTail = coalesceEntries(tailEntries);

      rawEntries.splice(stableRawLength, rawEntries.length - stableRawLength, ...tailEntries);
      outputEntries.splice(stableOutputLength, outputEntries.length - stableOutputLength, ...coalescedTail);
      outputItems.splice(
        stableOutputLength,
        outputItems.length - stableOutputLength,
        ...coalescedTail.map((entry) => entry.item),
      );
      previous = messages;
      if (!appendOnly) sidechainParentUuids = new Set();
      for (let index = appendOnly ? previousLength : 0; index < messages.length; index++) {
        const message = messages[index];
        if (message.is_sidechain && message.parent_uuid) {
          sidechainParentUuids.add(message.parent_uuid);
        }
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
