'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import type {
  ContentPart,
  MessagePayload,
  SubagentStatusEntry,
  SubagentStatusKind,
} from '../lib/messages-types';
import { ChannelEnvelopeView, looksLikeChannelEnvelope } from './channel-envelope';
import { OneLineChip, type OneLineChipKind } from './one-line-chip';
import { classifyMessage, type ChatChip } from '../lib/chat-payload-classifier';

/**
 * ChatMessages — render da conversa real (JSONL) — JP-11 Fase 2.
 *
 * Recebe a stream linearizada de `useMessagesStream` e:
 *  - bolhas user (direita) vs assistant (esquerda)
 *  - tool_use chip colapsável (parea com tool_result via tool_use_id)
 *  - thinking chip colapsável
 *  - sidechain agrupado por parent_uuid (subagents viram 1 chip único)
 *  - dual rail técnica (tools/arquivos/tempo/tokens) embaixo de assistant
 *  - markdown via react-markdown 10 + remark-gfm + rehype-highlight
 *  - auto-scroll bottom + pílula "↓ nova mensagem" se user scrollou
 */

function extractContentParts(content: string | ContentPart[] | undefined | null): ContentPart[] {
  if (content == null) return [];
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content;
}

function textOf(content: string | ContentPart[] | undefined | null): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

function toolResultBodyToString(content: string | ContentPart[]): string {
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

function shortToolArg(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const i = input as Record<string, unknown>;
  // heurísticas mais comuns: Bash → command, Edit/Write/Read → file_path, Grep → pattern
  if (typeof i.command === 'string') return truncate(i.command, 64);
  if (typeof i.file_path === 'string') return truncate(i.file_path, 64);
  if (typeof i.pattern === 'string') return truncate(i.pattern, 64);
  if (typeof i.path === 'string') return truncate(i.path, 64);
  if (typeof i.url === 'string') return truncate(i.url, 64);
  if (typeof i.query === 'string') return truncate(i.query, 64);
  return '';
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return `${m}m ${rs}s`;
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

// --- Estrutura de render -----------------------------------------------------

type ToolResultLookup = Map<string, { content: string; isError: boolean }>;

type SidechainGroupRef = {
  rootUuid: string;
  parentUuids: string[];
  durMs: number | null;
};

type RenderItem =
  | { kind: 'user'; payload: MessagePayload; text: string }
  | { kind: 'user-internal'; payload: MessagePayload; text: string }
  | { kind: 'channel'; payload: MessagePayload; raw: string }
  | { kind: 'assistant'; payload: MessagePayload; parts: ContentPart[] }
  | { kind: 'meta-decision'; payload: MessagePayload; text: string }
  | {
      /** DS-70/JP-17: chip universal vindo do classifier (Tara, JP-16).
       *  Cobre slash command nativo, Skill tool, e tool_use com result
       *  grande. Sidechain e channel envelope continuam com seus chips
       *  específicos (F1 e F4-1) — refator pra OneLineChip neles é
       *  opcional e fica pra round seguinte. */
      kind: 'chip';
      payload: MessagePayload;
      chip: ChatChip;
      expandBody: string;
      classifierKind: OneLineChipKind;
    }
  | {
      kind: 'sidechain-group';
      rootUuid: string;
      count: number;
      durMs: number | null;
      /** parent_uuids de TODAS as msgs sidechain do grupo. Usado pra
       *  casar o status ao vivo: o backend indexa por `parent_uuid` da
       *  msg sidechain, que varia ao longo do subagent (cada turn
       *  aponta pra anterior). Sem essa lista, chip só casaria status
       *  do primeiro turn. */
      parentUuids: string[];
    }
  | {
      /** JP-13 F1: N sidechain-groups consecutivos colapsam num único
       *  chip "launched N subagents". Sem isso, 14 subagents = 14 chips
       *  empilhados que enchem a tela. Cada subagent é resolvido por
       *  seu rootUuid próprio pro status live (active/completed/stalled
       *  aggregado). */
      kind: 'sidechain-cluster';
      groups: SidechainGroupRef[];
      subagentCount: number;
      totalDurMs: number | null;
    };

// Calcula o root de cada msg sidechain — sobe parent_uuid até achar uma
// msg NÃO-sidechain (o caller, dona do tool_use Task/Agent) ou sair do
// batch. Sem esse walk, cada turn do subagent vira seu próprio "root"
// e o Rica vê N chips em vez de 1 (turn N tem parentUuid = uuid de
// turn N-1, ambos sidechain).
function buildSidechainRoots(messages: MessagePayload[]): Map<string, string> {
  const byUuid = new Map<string, MessagePayload>();
  for (const m of messages) byUuid.set(m.uuid, m);
  const rootByUuid = new Map<string, string>();

  for (const m of messages) {
    if (!m.is_sidechain || rootByUuid.has(m.uuid)) continue;
    const chain: string[] = [];
    // visited blinda contra JSONL cíclico (A.parent=B, B.parent=A). Cache
    // só é populado pós-break, então sem isso o walk loopa infinitamente
    // e congela o tab.
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

// JP-13 F2: padrões de meta-decisão. Match no início do primeiro text part
// do assistant. Case-insensitive, ancorado em ^. Manter conservador —
// false-positive aqui esconde resposta legítima do agente.
const META_DECISION_PATTERNS: RegExp[] = [
  /^eco d[oae] /i,
  /^não respondo\b/i,
  /^aguardando direção/i,
  /^silenciando\b/i,
  /^ignorando (mensagem|eco|loop)/i,
];

function isMetaDecisionAssistant(parts: ContentPart[]): boolean {
  // Tem tool_use? Não é meta-decisão — agente está agindo.
  if (parts.some((p) => p.type === 'tool_use')) return false;
  const textParts = parts.filter(
    (p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text',
  );
  if (textParts.length === 0) return false;
  const head = textParts[0].text.trim();
  if (!head) return false;
  return META_DECISION_PATTERNS.some((re) => re.test(head));
}

function buildToolResultLookup(messages: MessagePayload[]): ToolResultLookup {
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

function buildRenderItems(messages: MessagePayload[]): RenderItem[] {
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
  // DS-70/JP-17: mensagens consumidas pelo classifier como `nextMsg`
  // (caso clássico: Skill tool puxa o assistant text seguinte como
  // expandBody do chip — esse assistant não deve renderizar de novo).
  const consumedByClassifier = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (consumedByClassifier.has(m.uuid)) continue;

    if (m.is_sidechain) {
      // F4-2: filtra bubbles individuais; emite UM chip por subagent
      // (agrupado pelo root real, não pelo parent_uuid literal).
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

    // DS-70/JP-17: classifier universal (JP-16 Tara) com lookahead. Substitui
    // o F5-4 silenciador e cobre slash command nativo, Skill tool e tool_use
    // com result grande — todos viram OneLineChip. Sidechain (F1) e channel
    // envelope (F4-1) caem como `plain` aqui e são tratados pelos branches
    // abaixo com chips específicos atuais (refator pra OneLineChip neles é
    // round seguinte).
    const next = messages[i + 1];
    const payload = classifyMessage(m, next);
    if (payload.kind === 'suppress') continue;
    if (payload.kind === 'slash' || payload.kind === 'skill' || payload.kind === 'tool') {
      items.push({
        kind: 'chip',
        payload: m,
        chip: payload.chip,
        expandBody: payload.expandBody,
        classifierKind: payload.kind,
      });
      // Skill puxa o assistant text seguinte como expandBody — marca pra não
      // renderizar de novo. Tool não consome (o tool_result-only user já é
      // skipped pelo guard `onlyToolResult` mais abaixo).
      if (payload.kind === 'skill' && next) consumedByClassifier.add(next.uuid);
      continue;
    }

    if (m.kind === 'user') {
      if (!m.message) continue;
      const parts = extractContentParts(m.message.content);
      // tool_result-only user messages são absorvidos no chip do assistant
      const onlyToolResult = parts.every((p) => p.type === 'tool_result');
      if (onlyToolResult && parts.length > 0) continue;

      const text = textOf(m.message.content).trim();
      if (!text) continue;
      // F4-1: detecta envelope `<channel source="...">` injetado pelo hook
      // UserPromptSubmit e renderiza chip por tipo (audio/imagem/doc) em
      // vez de bubble user com XML cru.
      if (looksLikeChannelEnvelope(text)) {
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
      // JP-13 F2: assistant text-only com padrão de meta-decisão no início
      // ("eco da minha mensagem", "não respondo", "aguardando direção" …)
      // colapsa em chip discreto pra não vazar raciocínio interno como
      // bubble grande. Filtro frágil: whitelist puro. Alargar quando
      // aparecer padrão novo que o Rica reclamar; fix durável fica no
      // agente (não emitir meta-decisão como assistant text).
      if (isMetaDecisionAssistant(parts)) {
        const text = textOf(m.message.content).trim();
        items.push({ kind: 'meta-decision', payload: m, text });
        continue;
      }
      items.push({ kind: 'assistant', payload: m, parts });
      continue;
    }
    // kind === 'attachment' | 'summary' | 'system' — fall-through proposital:
    // MVP da Fase 2 só rende user/assistant/sidechain. Quando entrar suporte
    // a attachment (imagem inline) ou summary (separador de compaction),
    // adicionar branch aqui — não esquecer do guard `!m.message`.
  }

  return items;
}

// JP-13 F1: colapsa runs de sidechain-group consecutivos. 1 grupo isolado
// fica como está; 2+ viram um sidechain-cluster com count agregado.
function coalesceSidechainGroups(items: RenderItem[]): RenderItem[] {
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

// --- Bubbles e chips ---------------------------------------------------------

const UserBubble = memo(function UserBubble({ text }: { text: string }) {
  return (
    <div className="msg-row msg-row-user">
      <div className="msg-bubble msg-bubble-user">
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </div>
    </div>
  );
});

const UserInternalBubble = memo(function UserInternalBubble({ text }: { text: string }) {
  return (
    <div className="msg-row msg-row-user">
      <div className="msg-bubble msg-bubble-internal" title="evento interno (hook/sistema)">
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </div>
    </div>
  );
});

function ThinkingChip({ text, ts }: { text: string; ts?: string }) {
  const [open, setOpen] = useState(false);
  // Heurística leve até backend mandar tempo real do turno: ~1s a cada 200 chars
  // de thinking (curva grosseira do tokens-per-second). Quando tivermos
  // `usage.thinking_tokens` ou diff de timestamp, trocar.
  const seconds = useMemo(() => Math.max(1, Math.round((text?.length ?? 0) / 200)), [text]);
  return (
    <button
      type="button"
      className="msg-chip msg-chip-thinking"
      data-open={open ? '1' : '0'}
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      title={ts ? new Date(ts).toLocaleString('pt-BR') : undefined}
    >
      <span className="msg-chip-head">
        <span className="msg-chip-glyph">💭</span>
        <span className="msg-chip-label">pensou {seconds}s</span>
        <span className="msg-chip-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </span>
      {open && (
        <pre className="msg-chip-body mono"><code>{text}</code></pre>
      )}
    </button>
  );
}

// JP-13 F2: chip discreto pra meta-decisão filtrada. Reusa estilo do
// thinking-chip — colapsável, conteúdo mono na expansão. Glyph 🤐 sinaliza
// "agente decidiu silenciar". Se Rica reclamar de bubble legítima escondida,
// o texto fica acessível via expand.
function MetaDecisionChip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="msg-row msg-row-assistant">
      <button
        type="button"
        className="msg-chip msg-chip-thinking"
        data-open={open ? '1' : '0'}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="msg-chip-head">
          <span className="msg-chip-glyph">🤐</span>
          <span className="msg-chip-label">meta-decisão (silenciado)</span>
          <span className="msg-chip-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
        </span>
        {open && (
          <pre className="msg-chip-body mono"><code>{text}</code></pre>
        )}
      </button>
    </div>
  );
}

function ToolUseChip({
  name,
  input,
  result,
}: {
  name: string;
  input: unknown;
  result: { content: string; isError: boolean } | null;
}) {
  const [open, setOpen] = useState(false);
  const short = shortToolArg(name, input);
  return (
    <div className="msg-chip msg-chip-tool" data-open={open ? '1' : '0'} data-err={result?.isError ? '1' : '0'}>
      <button
        type="button"
        className="msg-chip-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="msg-chip-glyph">🔧</span>
        <span className="msg-chip-label">{name}</span>
        {short && <span className="msg-chip-arg mono">{short}</span>}
        <span className="msg-chip-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="msg-chip-body">
          <div className="msg-chip-section">
            <span className="msg-chip-section-head">input</span>
            <pre className="mono"><code>{JSON.stringify(input, null, 2)}</code></pre>
          </div>
          {result && (
            <div className="msg-chip-section">
              <span className="msg-chip-section-head">{result.isError ? 'erro' : 'resultado'}</span>
              <pre className="mono"><code>{result.content}</code></pre>
            </div>
          )}
          {!result && (
            <div className="msg-chip-section">
              <span className="msg-chip-section-head muted">— sem resultado capturado —</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Resolve o status efetivo do grupo de sidechain (F4-2): backend indexa por
// parent_uuid de CADA turn (que varia ao longo do subagent), então o front
// precisa varrer todos os parent_uuids do grupo + o rootUuid. Preferência:
// active > stalled > completed; em empate, last_seen_ms mais recente.
const STATUS_RANK: Record<SubagentStatusKind, number> = {
  active: 3,
  stalled: 2,
  completed: 1,
};

function resolveSidechainLiveStatus(
  rootUuid: string,
  parentUuids: string[],
  statusMap?: Map<string, SubagentStatusEntry>,
): SubagentStatusEntry | null {
  if (!statusMap) return null;
  let best: SubagentStatusEntry | null = null;
  const seen = new Set<string>();
  const candidates = [rootUuid, ...parentUuids];
  for (const u of candidates) {
    if (seen.has(u)) continue;
    seen.add(u);
    const entry = statusMap.get(u);
    if (!entry) continue;
    if (!best) { best = entry; continue; }
    const er = STATUS_RANK[entry.status];
    const br = STATUS_RANK[best.status];
    if (er > br) { best = entry; continue; }
    if (er === br) {
      const eLast = entry.last_seen_ms ?? entry.started_at_ms;
      const bLast = best.last_seen_ms ?? best.started_at_ms;
      if (eLast > bLast) best = entry;
    }
  }
  return best;
}

// Status ao vivo do subagent (F3-2). Backend emite via SSE `subagent_status`:
//  active    → rodando agora (spinner amarelo)
//  completed → tool_result chegou (azul, dur ms autoritativa)
//  stalled   → >30s sem evento (laranja, ms desde last_seen)
// `null` = ainda não vi status (sessão histórica pré-F3-2 ou backend off).
function SidechainChip({
  count,
  durMs,
  liveStatus,
  nowMs,
}: {
  count: number;
  durMs: number | null;
  liveStatus: SubagentStatusEntry | null;
  nowMs: number;
}) {
  let chipState: 'idle' | 'active' | 'completed' | 'stalled' = 'idle';
  let glyph = '🔧';
  let label = `launched ${count} subagent${count === 1 ? '' : 's'}`;
  let trailing: string | null = durMs !== null && durMs > 0 ? formatMs(durMs) : null;

  if (liveStatus) {
    // Cada chip = 1 subagent (parent_uuid único). `count` é # de turnos
    // internos do subagent, não tem leitura útil pro user no modo live.
    if (liveStatus.status === 'active') {
      chipState = 'active';
      glyph = '⏳';
      label = 'subagent rodando…';
      trailing = formatMs(Math.max(0, nowMs - liveStatus.started_at_ms));
    } else if (liveStatus.status === 'completed') {
      chipState = 'completed';
      glyph = '✓';
      label = 'subagent concluído';
      trailing = liveStatus.duration_ms != null
        ? formatMs(liveStatus.duration_ms)
        : (durMs !== null && durMs > 0 ? formatMs(durMs) : null);
    } else if (liveStatus.status === 'stalled') {
      chipState = 'stalled';
      glyph = '⚠';
      const sinceMs = liveStatus.last_seen_ms != null
        ? Math.max(0, nowMs - liveStatus.last_seen_ms)
        : 0;
      label = `subagent sem resposta há ${formatMs(sinceMs)}`;
      trailing = null;
    }
  }

  return (
    <div className="msg-row msg-row-assistant">
      <div
        className="msg-chip msg-chip-sidechain"
        data-live={chipState}
        aria-live="polite"
      >
        <span className="msg-chip-head">
          <span className="msg-chip-glyph" aria-hidden="true">{glyph}</span>
          <span className="msg-chip-label">{label}</span>
          {trailing && <span className="msg-chip-arg mono">{trailing}</span>}
        </span>
      </div>
    </div>
  );
}

// JP-13 F1: chip único pra N subagents consecutivos. Resolve status por
// subagent individualmente (via resolveSidechainLiveStatus por rootUuid)
// e agrega em (active|stalled|completed|idle). Quando há `active`, mostra
// "K rodando · Ts" com o tempo do active mais recente. Caso contrário,
// trailing = soma das durações dos subagents completos.
function SidechainClusterChip({
  groups,
  subagentCount,
  totalDurMs,
  statusMap,
  nowMs,
}: {
  groups: SidechainGroupRef[];
  subagentCount: number;
  totalDurMs: number | null;
  statusMap?: Map<string, SubagentStatusEntry>;
  nowMs: number;
}) {
  let activeN = 0;
  let completedN = 0;
  let stalledN = 0;
  let mostRecentActiveStart = 0;

  for (const g of groups) {
    const entry = resolveSidechainLiveStatus(g.rootUuid, g.parentUuids, statusMap);
    if (!entry) continue;
    if (entry.status === 'active') {
      activeN++;
      if (entry.started_at_ms > mostRecentActiveStart) {
        mostRecentActiveStart = entry.started_at_ms;
      }
    } else if (entry.status === 'completed') {
      completedN++;
    } else if (entry.status === 'stalled') {
      stalledN++;
    }
  }

  let chipState: 'idle' | 'active' | 'completed' | 'stalled' = 'idle';
  let glyph = '🔧';
  let label = `launched ${subagentCount} subagents`;
  let trailing: string | null = totalDurMs !== null && totalDurMs > 0 ? formatMs(totalDurMs) : null;

  if (activeN > 0) {
    chipState = 'active';
    glyph = '⏳';
    label = `${subagentCount} subagents · ${activeN} rodando`;
    trailing = mostRecentActiveStart > 0
      ? formatMs(Math.max(0, nowMs - mostRecentActiveStart))
      : null;
  } else if (stalledN > 0) {
    chipState = 'stalled';
    glyph = '⚠';
    label = `${subagentCount} subagents · ${stalledN} sem resposta`;
    trailing = null;
  } else if (completedN === subagentCount && subagentCount > 0) {
    chipState = 'completed';
    glyph = '✓';
    label = `${subagentCount} subagents concluídos`;
  }

  return (
    <div className="msg-row msg-row-assistant">
      <div
        className="msg-chip msg-chip-sidechain"
        data-live={chipState}
        aria-live="polite"
      >
        <span className="msg-chip-head">
          <span className="msg-chip-glyph" aria-hidden="true">{glyph}</span>
          <span className="msg-chip-label">{label}</span>
          {trailing && <span className="msg-chip-arg mono">{trailing}</span>}
        </span>
      </div>
    </div>
  );
}

const AssistantBubble = memo(function AssistantBubble({
  parts,
  toolResults,
  usage,
}: {
  parts: ContentPart[];
  toolResults: ToolResultLookup;
  usage: NonNullable<MessagePayload['message']>['usage'];
}) {
  const [railOpen, setRailOpen] = useState(false);
  const toolUses = useMemo(
    () => parts.filter((p): p is Extract<ContentPart, { type: 'tool_use' }> => p.type === 'tool_use'),
    [parts],
  );
  const files = useMemo(() => {
    const set = new Set<string>();
    for (const p of toolUses) {
      if (!p.input || typeof p.input !== 'object') continue;
      const fp = (p.input as Record<string, unknown>).file_path;
      if (typeof fp === 'string') set.add(fp);
    }
    return set;
  }, [toolUses]);
  const tokensOut = usage?.output_tokens ?? null;

  return (
    <div className="msg-row msg-row-assistant">
      <div className="msg-bubble msg-bubble-assistant">
        {parts.map((part, i) => {
          if (part.type === 'text') {
            return (
              <div key={i} className="msg-text">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                >
                  {part.text}
                </Markdown>
              </div>
            );
          }
          if (part.type === 'thinking') {
            return <ThinkingChip key={i} text={part.thinking} />;
          }
          if (part.type === 'tool_use') {
            return (
              <ToolUseChip
                key={i}
                name={part.name}
                input={part.input}
                result={toolResults.get(part.id) ?? null}
              />
            );
          }
          return null;
        })}
        {(toolUses.length > 0 || tokensOut !== null) && (
          <div className="msg-rail" data-open={railOpen ? '1' : '0'}>
            <button
              type="button"
              className="msg-rail-head"
              onClick={() => setRailOpen((v) => !v)}
              aria-expanded={railOpen}
            >
              {toolUses.length > 0 && (
                <>
                  <span>{toolUses.length} ferramenta{toolUses.length === 1 ? '' : 's'}</span>
                  <span className="msg-rail-sep" aria-hidden="true">·</span>
                </>
              )}
              {files.size > 0 && (
                <>
                  <span>{files.size} arquivo{files.size === 1 ? '' : 's'}</span>
                  <span className="msg-rail-sep" aria-hidden="true">·</span>
                </>
              )}
              {tokensOut !== null && (
                <>
                  <span>{formatTokens(tokensOut)} tok</span>
                  <span className="msg-rail-sep" aria-hidden="true">·</span>
                </>
              )}
              <span className="msg-rail-caret" aria-hidden="true">{railOpen ? '▴' : '▾'}</span>
            </button>
            {railOpen && (
              <ul className="msg-rail-list mono">
                {toolUses.map((p) => (
                  <li key={p.id}>
                    <span className="msg-rail-tool">{p.name}</span>
                    {shortToolArg(p.name, p.input) && (
                      <span className="msg-rail-arg"> · {shortToolArg(p.name, p.input)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// --- Container + auto-scroll -------------------------------------------------

export type ChatMessagesProps = {
  messages: MessagePayload[];
  /** Slug do agente — usado pra montar URLs de attachment do canal (F4-1). */
  slug: string;
  /** Status pra anunciar empty vs loading. */
  loading?: boolean;
  /** Render alternativo do empty state. */
  emptyLabel?: string;
  /** Status ao vivo dos subagents por parent_uuid (JP-11 F3-2). */
  subagentStatusByParentUuid?: Map<string, SubagentStatusEntry>;
};

export function ChatMessages({
  messages,
  slug,
  loading = false,
  emptyLabel,
  subagentStatusByParentUuid,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  const [hasNew, setHasNew] = useState(false);

  const toolResults = useMemo(() => buildToolResultLookup(messages), [messages]);
  const items = useMemo(() => coalesceSidechainGroups(buildRenderItems(messages)), [messages]);

  // Relógio só liga quando há subagent active — tick a cada 1s atualiza o
  // "rodando 12s". Para no ciclo seguinte quando nada mais está active.
  const hasActiveSubagent = useMemo(() => {
    if (!subagentStatusByParentUuid) return false;
    for (const entry of subagentStatusByParentUuid.values()) {
      if (entry.status === 'active') return true;
    }
    return false;
  }, [subagentStatusByParentUuid]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!hasActiveSubagent) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasActiveSubagent]);

  // Auto-scroll quando "grudado" no fim; senão acende pílula "↓ nova mensagem".
  // Durante replay (loading=true), suprime hasNew — senão a pílula pulsa
  // a cada um dos N eventos do dump histórico (UX ruim, falso "novo").
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stuck) {
      el.scrollTop = el.scrollHeight;
      setHasNew(false);
    } else if (!loading) {
      setHasNew(true);
    }
  }, [items.length, stuck, loading]);

  // Reset quando o slug muda (messages volta a 0).
  useEffect(() => {
    if (messages.length === 0) {
      setStuck(true);
      setHasNew(false);
    }
  }, [messages.length]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setStuck(atBottom);
    if (atBottom) setHasNew(false);
  }, []);

  const goBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setStuck(true);
    setHasNew(false);
  }, []);

  if (!loading && items.length === 0) {
    return (
      <div className="chat-messages-empty muted">
        {emptyLabel ?? '— ainda não há conversa nesta sessão —'}
      </div>
    );
  }

  return (
    <div className="chat-messages-wrap">
      <div
        ref={scrollRef}
        className="chat-messages-scroll"
        onScroll={onScroll}
        aria-live="polite"
        aria-busy={loading}
      >
        {items.map((item) => {
          if (item.kind === 'sidechain-group') {
            const liveStatus = resolveSidechainLiveStatus(
              item.rootUuid,
              item.parentUuids,
              subagentStatusByParentUuid,
            );
            return (
              <SidechainChip
                key={`sc:${item.rootUuid}`}
                count={item.count}
                durMs={item.durMs}
                liveStatus={liveStatus}
                nowMs={nowMs}
              />
            );
          }
          if (item.kind === 'sidechain-cluster') {
            return (
              <SidechainClusterChip
                key={`scc:${item.groups[0]?.rootUuid ?? 'x'}:${item.subagentCount}`}
                groups={item.groups}
                subagentCount={item.subagentCount}
                totalDurMs={item.totalDurMs}
                statusMap={subagentStatusByParentUuid}
                nowMs={nowMs}
              />
            );
          }
          // payload.uuid é único por evento JSONL — chave estável protege
          // estado dos chips abertos quando troca sessão / ordem deslizar.
          const key = item.payload.uuid;
          if (item.kind === 'user') return <UserBubble key={key} text={item.text} />;
          if (item.kind === 'user-internal') return <UserInternalBubble key={key} text={item.text} />;
          if (item.kind === 'meta-decision') return <MetaDecisionChip key={key} text={item.text} />;
          if (item.kind === 'chip') {
            // Slash/Skill/Tool — chip universal vindo do classifier (Tara,
            // JP-16). expandBody='' → chip não expansível (caret some).
            const row = item.classifierKind === 'slash' ? 'msg-row-user' : 'msg-row-assistant';
            return (
              <div key={key} className={`msg-row ${row}`}>
                <OneLineChip
                  icon={item.chip.icon}
                  label={item.chip.label}
                  summary={item.chip.summary}
                  expandBody={item.expandBody || null}
                  kind={item.classifierKind}
                />
              </div>
            );
          }
          if (item.kind === 'channel') {
            return (
              <div key={key} className="msg-row msg-row-user">
                <ChannelEnvelopeView raw={item.raw} slug={slug} />
              </div>
            );
          }
          return (
            <AssistantBubble
              key={key}
              parts={item.parts}
              toolResults={toolResults}
              usage={item.payload.message?.usage}
            />
          );
        })}
      </div>
      {!stuck && hasNew && !loading && (
        <button
          type="button"
          className="chat-messages-pill"
          onClick={goBottom}
          aria-label="Rolar pro fim da conversa"
        >
          ↓ nova mensagem
        </button>
      )}
    </div>
  );
}
