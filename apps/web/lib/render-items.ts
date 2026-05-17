// render-items — pure data transform JSONL → RenderItem[]. Extraído de
// `components/chat-messages.tsx` (V1) pra permitir teste de integração via
// `node --test` sem puxar React/CSS. Não tem side-effect — só types.

import type { ContentPart, MessagePayload } from './messages-types.ts';
import { classifyMessage } from './chat-payload-classifier.ts';
import type { OneLineChipKind } from '../components/one-line-chip-types.ts';

export type ToolResultLookup = Map<string, { content: string; isError: boolean }>;

export type SidechainGroupRef = {
  rootUuid: string;
  parentUuids: string[];
  durMs: number | null;
};

export type RenderItem =
  | { kind: 'user'; payload: MessagePayload; text: string }
  | { kind: 'user-internal'; payload: MessagePayload; text: string }
  | { kind: 'channel'; payload: MessagePayload; raw: string }
  | { kind: 'assistant'; payload: MessagePayload; parts: ContentPart[] }
  | { kind: 'meta-decision'; payload: MessagePayload; text: string }
  | {
      kind: 'chip';
      payload: MessagePayload;
      chip: { icon: string; label: string; summary: string };
      expandBody: string;
      classifierKind: OneLineChipKind;
    }
  | {
      kind: 'sidechain-group';
      rootUuid: string;
      count: number;
      durMs: number | null;
      parentUuids: string[];
    }
  | {
      kind: 'sidechain-cluster';
      groups: SidechainGroupRef[];
      subagentCount: number;
      totalDurMs: number | null;
    };

export function extractContentParts(content: string | ContentPart[] | undefined | null): ContentPart[] {
  if (content == null) return [];
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content;
}

export function textOf(content: string | ContentPart[] | undefined | null): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

export function toolResultBodyToString(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object' && 'text' in p && typeof (p as { text?: unknown }).text === 'string') {
          return (p as { text: string }).text;
        }
        return JSON.stringify(p);
      })
      .join('\n');
  }
  return String(content ?? '');
}

// Detector raso de envelope `<channel source=...>` — mantido inline pra evitar
// dependência circular com o componente React. Casa o mesmo prefixo que
// `looksLikeChannelEnvelope` em components/channel-envelope.tsx.
const LOOKS_LIKE_CHANNEL_RE = /^\s*<channel\s+source=/;

function looksLikeChannelEnvelopeRaw(raw: string): boolean {
  return LOOKS_LIKE_CHANNEL_RE.test(raw);
}

// META_DECISION_PATTERNS — JP-13 F2 (assistant text-only colapsa em chip).
const META_DECISION_PATTERNS: RegExp[] = [
  /^eco d[oae] /i,
  /^não respondo\b/i,
  /^aguardando direção/i,
  /^silenciando\b/i,
  /^ignorando (mensagem|eco|loop)/i,
];

function isMetaDecisionAssistant(parts: ContentPart[]): boolean {
  if (parts.some((p) => p.type === 'tool_use')) return false;
  const textParts = parts.filter(
    (p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text',
  );
  if (textParts.length === 0) return false;
  const head = textParts[0].text.trim();
  if (!head) return false;
  return META_DECISION_PATTERNS.some((re) => re.test(head));
}

export function buildSidechainRoots(messages: MessagePayload[]): Map<string, string> {
  const byUuid = new Map<string, MessagePayload>();
  for (const m of messages) byUuid.set(m.uuid, m);
  const rootByUuid = new Map<string, string>();

  for (const m of messages) {
    if (!m.is_sidechain || rootByUuid.has(m.uuid)) continue;
    const chain: string[] = [];
    const visited = new Set<string>();
    let cur: MessagePayload | undefined = m;
    let root: string | null = null;
    while (cur && cur.is_sidechain) {
      if (visited.has(cur.uuid)) { root = cur.uuid; break; }
      visited.add(cur.uuid);
      chain.push(cur.uuid);
      const cached = rootByUuid.get(cur.uuid);
      if (cached) { root = cached; break; }
      if (!cur.parent_uuid) { root = cur.uuid; break; }
      const parent = byUuid.get(cur.parent_uuid);
      if (!parent) { root = cur.parent_uuid; break; }
      if (!parent.is_sidechain) { root = parent.uuid; break; }
      cur = parent;
    }
    if (root) {
      for (const u of chain) rootByUuid.set(u, root);
    }
  }
  return rootByUuid;
}

export function buildToolResultLookup(messages: MessagePayload[]): ToolResultLookup {
  const map: ToolResultLookup = new Map();
  for (const m of messages) {
    if (m.kind !== 'user' || !m.message) continue;
    const parts = extractContentParts(m.message.content);
    for (const p of parts) {
      if (p.type === 'tool_result') {
        const body = typeof p.content === 'string' ? p.content : toolResultBodyToString(p.content);
        map.set(p.tool_use_id, { content: body, isError: Boolean(p.is_error) });
      }
    }
  }
  return map;
}

// V1: blinda o switch de kinds vindos do classifier. Se um kind futuro nascer
// sem handler, o TS quebra na build (parâmetro `kind: never`) e o runtime
// joga — caça-fantasma melhor que XML vazando em UserBubble.
function assertNever(kind: never): never {
  throw new Error(`unhandled chat payload kind: ${String(kind)}`);
}

export function buildRenderItems(messages: MessagePayload[]): RenderItem[] {
  const items: RenderItem[] = [];
  const sidechainRootByUuid = buildSidechainRoots(messages);
  const sidechainByRoot = new Map<string, MessagePayload[]>();
  for (const m of messages) {
    if (!m.is_sidechain) continue;
    const root = sidechainRootByUuid.get(m.uuid) ?? m.parent_uuid ?? m.uuid;
    const arr = sidechainByRoot.get(root) ?? [];
    arr.push(m);
    sidechainByRoot.set(root, arr);
  }
  const sidechainEmitted = new Set<string>();
  const consumedByClassifier = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (consumedByClassifier.has(m.uuid)) continue;

    if (m.is_sidechain) {
      const root = sidechainRootByUuid.get(m.uuid) ?? m.parent_uuid ?? m.uuid;
      if (sidechainEmitted.has(root)) continue;
      sidechainEmitted.add(root);
      const group = sidechainByRoot.get(root) ?? [m];
      const tsStart = Date.parse(group[0]?.timestamp ?? m.timestamp);
      const tsEnd = Date.parse(group[group.length - 1]?.timestamp ?? m.timestamp);
      const durMs = Number.isFinite(tsStart) && Number.isFinite(tsEnd) ? tsEnd - tsStart : null;
      const parentUuids: string[] = [];
      for (const sm of group) {
        if (sm.parent_uuid) parentUuids.push(sm.parent_uuid);
      }
      items.push({
        kind: 'sidechain-group',
        rootUuid: root,
        count: group.length,
        durMs,
        parentUuids,
      });
      continue;
    }

    const next = messages[i + 1];
    const payload = classifyMessage(m, next);
    switch (payload.kind) {
      case 'suppress':
        continue;
      case 'plain':
        break;
      case 'slash':
      case 'skill':
      case 'tool':
      case 'task-notification':
      case 'channel-envelope':
      case 'sidechain-cluster': {
        items.push({
          kind: 'chip',
          payload: m,
          chip: payload.chip,
          expandBody: payload.expandBody,
          classifierKind: payload.kind,
        });
        if (payload.kind === 'skill' && next) consumedByClassifier.add(next.uuid);
        continue;
      }
      default:
        assertNever(payload);
        break;
    }

    if (m.kind === 'user') {
      if (!m.message) continue;
      const parts = extractContentParts(m.message.content);
      const onlyToolResult = parts.every((p) => p.type === 'tool_result');
      if (onlyToolResult && parts.length > 0) continue;

      const text = textOf(m.message.content).trim();
      if (!text) continue;
      if (looksLikeChannelEnvelopeRaw(text)) {
        items.push({ kind: 'channel', payload: m, raw: text });
        continue;
      }
      if (m.user_type === 'internal') {
        items.push({ kind: 'user-internal', payload: m, text });
      } else {
        items.push({ kind: 'user', payload: m, text });
      }
      continue;
    }

    if (m.kind === 'assistant') {
      if (!m.message) continue;
      const parts = extractContentParts(m.message.content);
      if (isMetaDecisionAssistant(parts)) {
        const text = textOf(m.message.content).trim();
        items.push({ kind: 'meta-decision', payload: m, text });
        continue;
      }
      items.push({ kind: 'assistant', payload: m, parts });
      continue;
    }
  }

  return items;
}

// JP-13 F1: colapsa runs de sidechain-group consecutivos. 1 grupo isolado fica
// como está; 2+ viram um sidechain-cluster com count agregado.
export function coalesceSidechainGroups(items: RenderItem[]): RenderItem[] {
  const out: RenderItem[] = [];
  let i = 0;
  while (i < items.length) {
    const cur = items[i];
    if (cur.kind !== 'sidechain-group') {
      out.push(cur);
      i++;
      continue;
    }
    let j = i;
    const refs: SidechainGroupRef[] = [];
    let totalDur = 0;
    let anyDur = false;
    while (j < items.length && items[j].kind === 'sidechain-group') {
      const g = items[j] as Extract<RenderItem, { kind: 'sidechain-group' }>;
      refs.push({ rootUuid: g.rootUuid, parentUuids: g.parentUuids, durMs: g.durMs });
      if (g.durMs !== null) { totalDur += g.durMs; anyDur = true; }
      j++;
    }
    if (refs.length === 1) {
      out.push(cur);
    } else {
      out.push({
        kind: 'sidechain-cluster',
        groups: refs,
        subagentCount: refs.length,
        totalDurMs: anyDur ? totalDur : null,
      });
    }
    i = j;
  }
  return out;
}
