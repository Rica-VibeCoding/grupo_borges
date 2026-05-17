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

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
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
            // Slash/Skill/Tool/Task/Channel/Sidechain — chip universal vindo
            // do classifier (Tara, JP-16). expandBody='' → chip não expansível
            // (caret some). slash + channel-envelope = user-side; demais =
            // assistant-side.
            const userSide = (
              item.classifierKind === 'slash'
              || item.classifierKind === 'channel-envelope'
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
