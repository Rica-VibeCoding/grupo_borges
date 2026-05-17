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
import { ChannelEnvelopeView } from './channel-envelope';
import { OneLineChip } from './one-line-chip';
import {
  buildRenderItems,
  buildToolResultLookup,
  coalesceSidechainGroups,
  type SidechainGroupRef,
  type ToolResultLookup,
} from '../lib/render-items';
import { prettifyToolName } from '../lib/tool-name';

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

function shortToolArg(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const i = input as Record<string, unknown>;
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

// DS-71 — HH:MM compacto pro slot `timestamp` do OneLineChip. Localizado
// pt-BR, 24h, TZ-relative do browser. Retorna `undefined` quando o iso é
// inválido (chip não renderiza o slot).
const HH_MM_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
function formatHHMM(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return HH_MM_FORMATTER.format(d);
}

// --- Bubbles e chips ---------------------------------------------------------

// DS-71: helper pra primeira linha truncada — vira summary do chip.
function firstLineSummary(text: string, max = 80): string {
  const head = text.trim().split(/\r?\n/, 1)[0] ?? '';
  return head.length > max ? head.slice(0, max - 1) + '…' : head;
}

// DS-71 round 4: feedback Rica — input dele tem que ser bubble igual o
// output do agent, NÃO chip encapsulado. Volta pro msg-bubble-user clássico
// com markdown. Chip era confuso demais visualmente; bubble livre alinha
// input e output no mesmo padrão de leitura.
const UserBubble = memo(function UserBubble({ text }: { text: string; ts?: string }) {
  return (
    <div className="msg-row msg-row-user">
      <div className="msg-bubble msg-bubble-user">
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </div>
    </div>
  );
});

// DS-71 round 4: eventos internos (hook/sistema) viram chip discreto
// COM cor própria (preto/grafite) — Rica pediu distinção visual entre
// input real e injection automática. Mantém OneLineChip kind=user-internal
// mas com fundo `--graphite-deep` (override no CSS).
const UserInternalBubble = memo(function UserInternalBubble({ text, ts }: { text: string; ts?: string }) {
  return (
    <div className="msg-row msg-row-user">
      <OneLineChip
        kind="user-internal"
        icon="⚙️"
        label="Internal:"
        summary={firstLineSummary(text)}
        timestamp={formatHHMM(ts)}
        expandBody={
          <div className="one-line-chip-md">
            <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
          </div>
        }
      />
    </div>
  );
});

// DS-71: ThinkingChip migrado pra OneLineChip kind=thinking. Heurística de
// segundos (text.length / 200) mantida até backend mandar duração real do
// thinking via usage.
function ThinkingChip({ text, ts }: { text: string; ts?: string }) {
  const seconds = Math.max(1, Math.round((text?.length ?? 0) / 200));
  return (
    <OneLineChip
      kind="thinking"
      icon="⚙️"
      label={`Pensando: ${seconds}s`}
      timestamp={formatHHMM(ts)}
      expandBody={text}
    />
  );
}

// JP-13 F2 → DS-71: MetaDecisionChip migrado pra OneLineChip. Glyph 🤐
// sinaliza "agente decidiu silenciar". Texto completo no expand.
function MetaDecisionChip({ text, ts }: { text: string; ts?: string }) {
  return (
    <div className="msg-row msg-row-assistant">
      <OneLineChip
        kind="meta-decision"
        icon="⚙️"
        label="Meta: silenciado"
        timestamp={formatHHMM(ts)}
        expandBody={text}
      />
    </div>
  );
}

// DS-71: ToolUseChip migrado pra OneLineChip kind=tool. Expand combina
// input JSON + resultado (ou erro) em pre blocks via ReactNode.
function ToolUseChip({
  name,
  input,
  result,
  ts,
}: {
  name: string;
  input: unknown;
  result: { content: string; isError: boolean } | null;
  ts?: string;
}) {
  const short = shortToolArg(name, input);
  const expandBody = (
    <div className="one-line-chip-sections">
      <div className="one-line-chip-section">
        <span className="one-line-chip-section-head">input</span>
        <pre className="mono"><code>{JSON.stringify(input, null, 2)}</code></pre>
      </div>
      {result && (
        <div className="one-line-chip-section">
          <span className="one-line-chip-section-head">{result.isError ? 'erro' : 'resultado'}</span>
          <pre className="mono"><code>{result.content}</code></pre>
        </div>
      )}
      {!result && (
        <div className="one-line-chip-section">
          <span className="one-line-chip-section-head muted">— sem resultado capturado —</span>
        </div>
      )}
    </div>
  );
  // DS-71 round 9: tool sem result ainda → tone=active (breathing).
  // Quando o tool_result chega no JSONL, result deixa de ser null e o
  // chip para de pulsar. Pra MCP tools, label encurtado via
  // prettifyToolName (`mcp__plugin_telegram_telegram__reply` → `telegram.reply`).
  const tone = result === null ? 'active' : (result.isError ? 'error' : 'idle');
  return (
    <OneLineChip
      kind="tool"
      icon="⚙️"
      label={`Tool: ${prettifyToolName(name)}`}
      summary={short || undefined}
      trailing={result?.isError ? 'erro' : undefined}
      timestamp={formatHHMM(ts)}
      tone={tone}
      expandBody={expandBody}
    />
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
// DS-71: SidechainChip (single subagent) migrado pra OneLineChip kind=
// sidechain-cluster. Tone vem do liveStatus do backend (active/completed/
// stalled). Breathing animation aplicada automaticamente quando active.
function SidechainChip({
  count,
  durMs,
  liveStatus,
  nowMs,
  ts,
}: {
  count: number;
  durMs: number | null;
  liveStatus: SubagentStatusEntry | null;
  nowMs: number;
  ts?: string;
}) {
  let tone: 'idle' | 'active' | 'completed' | 'stalled' = 'idle';
  let label = `Subagent: ${count}x`;
  let trailing: string | undefined = durMs !== null && durMs > 0 ? formatMs(durMs) : undefined;

  if (liveStatus) {
    if (liveStatus.status === 'active') {
      tone = 'active';
      label = 'Subagent: rodando…';
      trailing = formatMs(Math.max(0, nowMs - liveStatus.started_at_ms));
    } else if (liveStatus.status === 'completed') {
      tone = 'completed';
      label = 'Subagent: concluído';
      trailing = liveStatus.duration_ms != null
        ? formatMs(liveStatus.duration_ms)
        : (durMs !== null && durMs > 0 ? formatMs(durMs) : undefined);
    } else if (liveStatus.status === 'stalled') {
      tone = 'stalled';
      const sinceMs = liveStatus.last_seen_ms != null
        ? Math.max(0, nowMs - liveStatus.last_seen_ms)
        : 0;
      label = `Subagent: sem resposta há ${formatMs(sinceMs)}`;
      trailing = undefined;
    }
  }

  return (
    <div className="msg-row msg-row-assistant">
      <OneLineChip
        kind="sidechain-cluster"
        icon="⚙️"
        label={label}
        trailing={trailing}
        timestamp={formatHHMM(ts)}
        tone={tone}
      />
    </div>
  );
}

// JP-13 F1: chip único pra N subagents consecutivos. Resolve status por
// subagent individualmente (via resolveSidechainLiveStatus por rootUuid)
// e agrega em (active|stalled|completed|idle). Quando há `active`, mostra
// "K rodando · Ts" com o tempo do active mais recente. Caso contrário,
// trailing = soma das durações dos subagents completos.
// DS-71: SidechainClusterChip migrado pra OneLineChip. Mesma lógica de
// agregação (active > stalled > completed) mas renderiza via OneLineChip
// pra estética unificada e breathing automático em active.
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

  let tone: 'idle' | 'active' | 'completed' | 'stalled' = 'idle';
  let label = `Subagent: ${subagentCount}x`;
  let trailing: string | undefined = totalDurMs !== null && totalDurMs > 0 ? formatMs(totalDurMs) : undefined;

  if (activeN > 0) {
    tone = 'active';
    label = `Subagent: ${subagentCount}x · ${activeN} rodando`;
    trailing = mostRecentActiveStart > 0
      ? formatMs(Math.max(0, nowMs - mostRecentActiveStart))
      : undefined;
  } else if (stalledN > 0) {
    tone = 'stalled';
    label = `Subagent: ${subagentCount}x · ${stalledN} sem resposta`;
    trailing = undefined;
  } else if (completedN === subagentCount && subagentCount > 0) {
    tone = 'completed';
    label = `Subagent: ${subagentCount}x concluídos`;
  }

  return (
    <div className="msg-row msg-row-assistant">
      <OneLineChip
        kind="sidechain-cluster"
        icon="⚙️"
        label={label}
        trailing={trailing}
        tone={tone}
      />
    </div>
  );
}

const AssistantBubble = memo(function AssistantBubble({
  parts,
  toolResults,
  ts,
}: {
  parts: ContentPart[];
  toolResults: ToolResultLookup;
  ts?: string;
}) {
  // DS-71 round 3: wrapper `msg-bubble msg-bubble-assistant` removido por
  // feedback Rica (msg 2894 — "componente dentro de componente"). Cada part
  // vira sua própria row no feed; chips de thinking/tool ficam soltos. Text
  // part mantém bubble pra legibilidade do markdown longo. Quando o turno
  // só tem chips (sem text), nada envolve nada.
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return (
            <div key={i} className="msg-row msg-row-assistant">
              <div className="msg-bubble msg-bubble-assistant">
                <div className="msg-text">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                  >
                    {part.text}
                  </Markdown>
                </div>
              </div>
            </div>
          );
        }
        if (part.type === 'thinking') {
          return (
            <div key={i} className="msg-row msg-row-assistant">
              <ThinkingChip text={part.thinking} ts={ts} />
            </div>
          );
        }
        if (part.type === 'tool_use') {
          return (
            <div key={i} className="msg-row msg-row-assistant">
              <ToolUseChip
                name={part.name}
                input={part.input}
                result={toolResults.get(part.id) ?? null}
                ts={ts}
              />
            </div>
          );
        }
        return null;
      })}
    </>
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
            // Pega timestamp do primeiro turn do grupo pra mostrar HH:MM.
            const groupTs = messages.find((m) => m.uuid === item.rootUuid)?.timestamp;
            return (
              <SidechainChip
                key={`sc:${item.rootUuid}`}
                count={item.count}
                durMs={item.durMs}
                liveStatus={liveStatus}
                nowMs={nowMs}
                ts={groupTs}
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
          const itemTs = item.payload.timestamp;
          if (item.kind === 'user') return <UserBubble key={key} text={item.text} ts={itemTs} />;
          if (item.kind === 'user-internal') return <UserInternalBubble key={key} text={item.text} ts={itemTs} />;
          if (item.kind === 'meta-decision') return <MetaDecisionChip key={key} text={item.text} ts={itemTs} />;
          if (item.kind === 'chip') {
            // Slash/Skill/Tool/Task/Sidechain — chip universal vindo do
            // classifier (Tara, JP-16). channel-envelope NÃO chega aqui
            // (render-items roteia pra kind='channel' via ChannelEnvelopeView).
            // Slash + Skill = user-side ("skills saem do meu lado", Rica);
            // demais = assistant-side.
            const userSide = (
              item.classifierKind === 'slash'
              || item.classifierKind === 'skill'
            );
            const row = userSide ? 'msg-row-user' : 'msg-row-assistant';
            return (
              <div key={key} className={`msg-row ${row}`}>
                <OneLineChip
                  icon={item.chip.icon}
                  label={item.chip.label}
                  summary={item.chip.summary}
                  expandBody={item.expandBody || null}
                  kind={item.classifierKind}
                  tone={item.tone}
                  timestamp={formatHHMM(itemTs)}
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
              ts={itemTs}
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
