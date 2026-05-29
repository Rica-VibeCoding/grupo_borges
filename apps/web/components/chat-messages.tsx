'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import type {
  AskUserEntry,
  ContentPart,
  MessagePayload,
  OptimisticEntry,
  SubagentStatusEntry,
  SubagentStatusKind,
  SyntheticKind,
} from '../lib/messages-types';
import { AskUserCard } from './ask-user-card';
import { ChannelEnvelopeView } from './channel-envelope';
import { CodeBlock } from './code-block';
import { OneLineChip } from './one-line-chip';
import {
  buildRenderItems,
  buildToolResultLookup,
  coalesceSidechainGroups,
  deriveSubagentStatusesFromMessages,
  mergeAskUserItems,
  type SidechainGroupRef,
  type ToolResultLookup,
} from '../lib/render-items';
import { prettifyToolName } from '../lib/tool-name';

const MD_COMPONENTS = { pre: CodeBlock };
// Sem ref estável aqui, cada `<Markdown remarkPlugins={[...]}>` cria array
// novo por render e força react-markdown a reconfigurar o pipeline remark+
// rehype toda vez — caro com rehype-highlight no caminho.
// `as const` aqui não passa: react-markdown tipa `Pluggable[]` mutável.
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

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

// Detecta payload de imagem do cockpit (agents.py:953):
//   "Imagem enviada via cockpit:\n<absolute_path>[\s*Caption: <text>]"
// Path em nova linha sempre — single-line fazia o CC auto-anexar e consumir
// o path. Separador após `:` é `\s+` (tolera newline, espaço, etc).
// Captura direto a partir de `/uploads/agents/` pra obter URL pública.
const COCKPIT_IMG_RE = /^Imagem enviada via cockpit:\s+\S*?(\/uploads\/agents\/[^\s]+?\.(?:jpe?g|png|gif|webp))\s*(?:Caption:\s*([\s\S]+))?$/i;

function parseCockpitImage(text: string): { url: string; caption: string | null } | null {
  const match = text.match(COCKPIT_IMG_RE);
  if (!match) return null;
  return {
    url: match[1],
    caption: match[2]?.trim() ?? null,
  };
}

// DS-71 round 4: feedback Rica — input dele tem que ser bubble igual o
// output do agent, NÃO chip encapsulado. Volta pro msg-bubble-user clássico
// com markdown. Chip era confuso demais visualmente; bubble livre alinha
// input e output no mesmo padrão de leitura.
// JP-18 R2: aceita `optimisticStatus` opcional pra render local antes do SSE
// confirmar — adiciona classe + data-status que o CSS usa pra dim/error.
const UserBubble = memo(function UserBubble({
  text,
  optimisticStatus,
}: {
  text: string;
  ts?: string;
  optimisticStatus?: OptimisticEntry['status'];
}) {
  const image = parseCockpitImage(text);
  const optClass = optimisticStatus ? ' msg-bubble-optimistic' : '';
  const rowProps = optimisticStatus ? { 'data-optimistic': optimisticStatus } : {};
  if (image) {
    return (
      <div className="msg-row msg-row-user" {...rowProps}>
        <div
          className={`msg-bubble msg-bubble-user msg-bubble-image${optClass}`}
          data-status={optimisticStatus}
        >
          <a
            href={image.url}
            target="_blank"
            rel="noopener noreferrer"
            className="msg-image-link"
            aria-label="Abrir imagem em tamanho completo"
          >
            <img
              src={image.url}
              alt=""
              className="msg-image-thumb"
              loading="lazy"
              decoding="async"
            />
          </a>
          {image.caption && (
            <div className="msg-image-caption">
              <Markdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>{image.caption}</Markdown>
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="msg-row msg-row-user" {...rowProps}>
      <div
        className={`msg-bubble msg-bubble-user${optClass}`}
        data-status={optimisticStatus}
      >
        <Markdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>{text}</Markdown>
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
            <Markdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>{text}</Markdown>
          </div>
        }
      />
    </div>
  );
});

// Injeções do runtime CC que não são input real do user:
//   - wakeup-dynamic / wakeup-cron: sentinel re-emitido pelo ScheduleWakeup
//     pra retomar /loop. Chega como bolha de user crua `<<autonomous-loop...>>`.
//   - stt: áudio transcrito por `agents.py:1040` (prefixo `🎙 `).
// Back taga via `meta.kind`; aqui renderiza chip discreto em vez de bubble.
const SYNTHETIC_PRESENTATION: Record<
  SyntheticKind,
  { icon: string; label: string; summary: (raw: string) => string }
> = {
  'wakeup-dynamic': {
    icon: '⏰',
    label: 'Cutucada dinâmica',
    summary: () => 'ritmo do agente',
  },
  'wakeup-cron': {
    icon: '🗓',
    label: 'Cutucada agendada',
    summary: () => 'cron',
  },
  stt: {
    icon: '🎙',
    label: 'Áudio transcrito',
    summary: (raw) => firstLineSummary(raw.replace(/^🎙\s+/, '')),
  },
};

const UserSyntheticBubble = memo(function UserSyntheticBubble({
  syntheticKind,
  rawText,
  ts,
}: {
  syntheticKind: SyntheticKind;
  rawText: string;
  ts?: string;
}) {
  const preset = SYNTHETIC_PRESENTATION[syntheticKind];
  const isStt = syntheticKind === 'stt';
  const sttText = isStt ? rawText.replace(/^🎙\s+/, '') : rawText;
  return (
    <div className="msg-row msg-row-user">
      <OneLineChip
        kind="synthetic"
        icon={preset.icon}
        label={preset.label}
        summary={preset.summary(rawText)}
        timestamp={formatHHMM(ts)}
        expandBody={
          isStt ? (
            <div className="one-line-chip-md">
              <Markdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>{sttText}</Markdown>
            </div>
          ) : null
        }
      />
    </div>
  );
});

// DS-71: ThinkingChip migrado pra OneLineChip kind=thinking. Heurística de
// segundos (text.length / 200) mantida até backend mandar duração real do
// thinking via usage.
const ThinkingChip = memo(function ThinkingChip({ text, ts }: { text: string; ts?: string }) {
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
});

// JP-13 F2 → DS-71: MetaDecisionChip migrado pra OneLineChip. Glyph 🤐
// sinaliza "agente decidiu silenciar". Texto completo no expand.
const MetaDecisionChip = memo(function MetaDecisionChip({ text, ts }: { text: string; ts?: string }) {
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
});

// DS-71: ToolUseChip migrado pra OneLineChip kind=tool. Expand combina
// input JSON + resultado (ou erro) em pre blocks via ReactNode.
const ToolUseChip = memo(function ToolUseChip({
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
});

// Resolve o status efetivo do grupo de sidechain (F4-2): backend indexa por
// parent_uuid de CADA turn (que varia ao longo do subagent), então o front
// precisa varrer todos os parent_uuids do grupo + o rootUuid. Preferência:
// active > stalled > completed; em empate, last_seen_ms mais recente.
const STATUS_RANK: Record<SubagentStatusKind, number> = {
  active: 3,
  starting: 3,
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
// JP-18 R1: relógio interno — só liga quando liveStatus.status === 'active'.
// Antes o container ChatMessages mantinha um setInterval(1s) que re-renderizava
// items.map inteiro a cada tick; agora cada chip cuida do próprio "Xs".
function useTickingNow(enabled: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return nowMs;
}

function subagentName(entry: SubagentStatusEntry | null, fallback: string): string {
  if (!entry) return fallback;
  return entry.agent_type || entry.agent_slug || entry.session_name || fallback;
}

function subagentKind(entry: SubagentStatusEntry | null): string {
  if (!entry) return 'Claude Code';
  return entry.agent_type || (entry.spawned_by_tool ? 'subsessão MCP' : 'Claude Code');
}

function formatNumber(value?: number): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('pt-BR').format(value);
}

function subagentDetails(entry: SubagentStatusEntry | null, statusLabel: string, fallback: string) {
  const name = subagentName(entry, fallback);
  const rows: Array<[string, string]> = [
    ['nome', name],
    ['tipo', subagentKind(entry)],
    ['estado', statusLabel],
  ];
  if (entry?.description) rows.splice(2, 0, ['descrição', entry.description]);
  if (entry?.task_id) rows.push(['tarefa', entry.task_id]);
  if (entry?.current_tool) {
    rows.push([
      'ferramenta',
      entry.current_tool_summary ? `${entry.current_tool}: ${entry.current_tool_summary}` : entry.current_tool,
    ]);
  }
  if (entry?.total_tokens != null) rows.push(['tokens', formatNumber(entry.total_tokens)]);
  if (entry?.total_tool_use_count != null) rows.push(['ferramentas usadas', formatNumber(entry.total_tool_use_count)]);
  if (entry?.session_name) rows.push(['sessão', entry.session_name]);
  if (entry?.agent_id) rows.push(['agentId', entry.agent_id]);
  return (
    <div className="one-line-chip-sections">
      {rows.map(([label, value]) => (
        <div key={label} className="subagent-detail-row">
          <span className="one-line-chip-section-head">{label}</span>
          <span className="mono">{value}</span>
        </div>
      ))}
      {entry?.prompt && (
        <div className="one-line-chip-section">
          <span className="one-line-chip-section-head">prompt</span>
          <pre className="mono"><code>{entry.prompt}</code></pre>
        </div>
      )}
    </div>
  );
}

function SubagentIcon({ tone }: { tone: 'idle' | 'active' | 'completed' | 'stalled' }) {
  return <span className="subagent-status-icon" data-tone={tone} aria-hidden="true" />;
}

const SidechainChip = memo(function SidechainChip({
  count,
  durMs,
  liveStatus,
  ts,
}: {
  count: number;
  durMs: number | null;
  liveStatus: SubagentStatusEntry | null;
  ts?: string;
}) {
  const nowMs = useTickingNow(liveStatus?.status === 'active' || liveStatus?.status === 'starting');
  let tone: 'idle' | 'active' | 'completed' | 'stalled' = 'idle';
  let statusLabel = `${count}x`;
  let summary = subagentName(liveStatus, statusLabel);
  let trailing: string | undefined = durMs !== null && durMs > 0 ? formatMs(durMs) : undefined;

  if (liveStatus) {
    if (liveStatus.status === 'active' || liveStatus.status === 'starting') {
      tone = 'active';
      statusLabel = liveStatus.status === 'starting' ? 'iniciando' : 'rodando';
      summary = liveStatus.current_tool
        ? `${subagentName(liveStatus, statusLabel)} · ${liveStatus.current_tool}`
        : `${subagentName(liveStatus, statusLabel)} · ${statusLabel}`;
      trailing = formatMs(Math.max(0, nowMs - liveStatus.started_at_ms));
    } else if (liveStatus.status === 'completed') {
      tone = 'completed';
      statusLabel = 'concluído';
      summary = `${subagentName(liveStatus, 'subagente')} · concluído`;
      trailing = liveStatus.duration_ms != null
        ? formatMs(liveStatus.duration_ms)
        : (durMs !== null && durMs > 0 ? formatMs(durMs) : undefined);
    } else if (liveStatus.status === 'stalled') {
      tone = 'stalled';
      const sinceMs = liveStatus.last_seen_ms != null
        ? Math.max(0, nowMs - liveStatus.last_seen_ms)
        : 0;
      statusLabel = `sem resposta há ${formatMs(sinceMs)}`;
      summary = `${subagentName(liveStatus, 'subagente')} · ${statusLabel}`;
      trailing = undefined;
    }
  }

  return (
    <div className="msg-row msg-row-assistant">
      <OneLineChip
        kind="sidechain-cluster"
        icon={<SubagentIcon tone={tone} />}
        label="Subagent:"
        summary={summary}
        trailing={trailing}
        timestamp={formatHHMM(ts)}
        tone={tone}
        expandBody={subagentDetails(liveStatus, statusLabel, `${count}x`)}
      />
    </div>
  );
});

// JP-13 F1: chip único pra N subagents consecutivos. Resolve status por
// subagent individualmente (via resolveSidechainLiveStatus por rootUuid)
// e agrega em (active|stalled|completed|idle). Quando há `active`, mostra
// "K rodando · Ts" com o tempo do active mais recente. Caso contrário,
// trailing = soma das durações dos subagents completos.
// DS-71: SidechainClusterChip migrado pra OneLineChip. Mesma lógica de
// agregação (active > stalled > completed) mas renderiza via OneLineChip
// pra estética unificada e breathing automático em active.
const SidechainClusterChip = memo(function SidechainClusterChip({
  groups,
  subagentCount,
  totalDurMs,
  statusMap,
}: {
  groups: SidechainGroupRef[];
  subagentCount: number;
  totalDurMs: number | null;
  statusMap?: Map<string, SubagentStatusEntry>;
}) {
  const aggregated = useMemo(() => {
    let activeN = 0;
    let completedN = 0;
    let stalledN = 0;
    let mostRecentActiveStart = 0;
    for (const g of groups) {
      const entry = resolveSidechainLiveStatus(g.rootUuid, g.parentUuids, statusMap);
      if (!entry) continue;
      if (entry.status === 'active' || entry.status === 'starting') {
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
    return { activeN, completedN, stalledN, mostRecentActiveStart };
  }, [groups, statusMap]);

  const nowMs = useTickingNow(aggregated.activeN > 0);

  let tone: 'idle' | 'active' | 'completed' | 'stalled' = 'idle';
  let summary = `${subagentCount}x`;
  let statusLabel = `${subagentCount}x`;
  let trailing: string | undefined = totalDurMs !== null && totalDurMs > 0 ? formatMs(totalDurMs) : undefined;

  if (aggregated.activeN > 0) {
    tone = 'active';
    statusLabel = `${aggregated.activeN} rodando`;
    summary = `${subagentCount}x · ${statusLabel}`;
    trailing = aggregated.mostRecentActiveStart > 0
      ? formatMs(Math.max(0, nowMs - aggregated.mostRecentActiveStart))
      : undefined;
  } else if (aggregated.stalledN > 0) {
    tone = 'stalled';
    statusLabel = `${aggregated.stalledN} sem resposta`;
    summary = `${subagentCount}x · ${statusLabel}`;
    trailing = undefined;
  } else if (aggregated.completedN === subagentCount && subagentCount > 0) {
    tone = 'completed';
    statusLabel = 'concluídos';
    summary = `${subagentCount}x concluídos`;
  }

  return (
    <div className="msg-row msg-row-assistant">
      <OneLineChip
        kind="sidechain-cluster"
        icon={<SubagentIcon tone={tone} />}
        label="Subagent:"
        summary={summary}
        trailing={trailing}
        tone={tone}
        expandBody={subagentDetails(null, statusLabel, `${subagentCount} subagentes`)}
      />
    </div>
  );
});

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
                    remarkPlugins={REMARK_PLUGINS}
                    rehypePlugins={REHYPE_PLUGINS}
                    components={MD_COMPONENTS}
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
  /** Bolhas locais ainda não confirmadas pelo SSE. */
  optimistic?: OptimisticEntry[];
  /** ask-user MCP — entries pendentes/respondidas por request_id. */
  askUserByRequestId?: Map<string, AskUserEntry>;
};

export function ChatMessages({
  messages,
  slug,
  loading = false,
  emptyLabel,
  subagentStatusByParentUuid,
  optimistic,
  askUserByRequestId,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // `stuck` = sentinel está visível no viewport do scroller (Rica grudado no
  // fim). Decisão central pro bottom-stick: auto-scroll só quando true.
  // Inicializa true: feed novo sempre nasce no fim.
  const [stuck, setStuck] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  // Ref espelho do stuck — RO/IO callbacks leem sem precisar de deps.
  const stuckRef = useRef(true);
  stuckRef.current = stuck;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const toolResults = useMemo(() => buildToolResultLookup(messages), [messages]);
  const items = useMemo(
    () => mergeAskUserItems(
      coalesceSidechainGroups(buildRenderItems(messages)),
      askUserByRequestId,
    ),
    [messages, askUserByRequestId],
  );

  // POST resposta ask-user pro backend; backend re-emite o entry como answered.
  const submitAskUser = useCallback(
    async (requestId: string, answers: string[]) => {
      const res = await fetch(`/api/ask_user/answer/${encodeURIComponent(requestId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    },
    [],
  );
  const effectiveSubagentStatusByParentUuid = useMemo(() => {
    const derived = deriveSubagentStatusesFromMessages(messages);
    if (!subagentStatusByParentUuid || subagentStatusByParentUuid.size === 0) return derived;
    const next = new Map(derived);
    for (const [parentUuid, live] of subagentStatusByParentUuid) {
      next.set(parentUuid, { ...next.get(parentUuid), ...live });
    }
    return next;
  }, [messages, subagentStatusByParentUuid]);
  const optimisticLen = optimistic?.length ?? 0;

  // Callback refs (não useEffect): componente alterna entre empty-state e
  // scroller; useEffect de mount rodaria com refs null e nunca refaria setup.
  // Callback ref dispara no attach/detach — lifecycle correto pros observers.
  // RO observa o wrapper interno (scroller tem altura fixa via flex).
  const ioRef = useRef<IntersectionObserver | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const roRafIdRef = useRef(0);

  const scrollerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (ioRef.current) { ioRef.current.disconnect(); ioRef.current = null; }
    scrollRef.current = node;
    if (!node) return;
    // Callback refs disparam após commit do subtree → sentinelRef já existe.
    const target = sentinelRef.current;
    if (!target) return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setStuck(true);
          setHasNew(false);
        } else {
          setStuck(false);
        }
      },
      { root: node, rootMargin: '0px 0px 100px 0px', threshold: 0 },
    );
    io.observe(target);
    ioRef.current = io;
  }, []);

  const contentCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    if (roRafIdRef.current) {
      cancelAnimationFrame(roRafIdRef.current);
      roRafIdRef.current = 0;
    }
    contentRef.current = node;
    if (!node) return;
    // Tracking de altura — só reagimos a mudança vertical. Timers de chip
    // (`Subagent: 17s → 18s`) mudam LARGURA, acionariam pílula espúria.
    let lastHeight = node.getBoundingClientRect().height;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const h = entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      if (h === lastHeight) return;
      lastHeight = h;
      if (roRafIdRef.current) return;
      roRafIdRef.current = requestAnimationFrame(() => {
        roRafIdRef.current = 0;
        // Durante loading força grudado: user não interage com replay,
        // estabiliza no fim antes de assumir controle.
        if (loadingRef.current || stuckRef.current) {
          sentinelRef.current?.scrollIntoView({ block: 'end' });
        } else {
          setHasNew(true);
        }
      });
    });
    ro.observe(node);
    roRef.current = ro;
  }, []);

  // Reset em troca de agente — stuck/hasNew do feed anterior não valem aqui.
  // Sem isso, abrir agente cheio vindo de outro deixa stuck=false residual e
  // pílula acende antes do IO estabilizar.
  useEffect(() => {
    setStuck(true);
    setHasNew(false);
  }, [slug]);

  // Auto-stick em mudança de items/optimistic. Esse é o caminho previsível
  // pra "novos itens grudam no fim" — dep-based, dispara só quando length
  // muda (não quando stuck muda). O RO no content cobre mudança de altura
  // sem mudança de length (streaming dentro de uma msg, chip expand).
  // rAF dá 1 frame pro layout estabilizar antes do scroll — evita bolha
  // nascer escondida quando chat ocupa tela inteira no mobile.
  useEffect(() => {
    if (loadingRef.current || stuckRef.current) {
      const id = requestAnimationFrame(() => {
        sentinelRef.current?.scrollIntoView({ block: 'end' });
      });
      return () => cancelAnimationFrame(id);
    } else if (items.length > 0 || optimisticLen > 0) {
      setHasNew(true);
    }
  }, [items.length, optimisticLen]);

  const goBottom = useCallback(() => {
    sentinelRef.current?.scrollIntoView({ block: 'end' });
    setStuck(true);
    setHasNew(false);
  }, []);

  if (!loading && items.length === 0 && optimisticLen === 0) {
    return (
      <div className="chat-messages-empty muted">
        {emptyLabel ?? '— ainda não há conversa nesta sessão —'}
      </div>
    );
  }

  return (
    <div className="chat-messages-wrap">
      <div
        ref={scrollerCallbackRef}
        className="chat-messages-scroll"
        data-chat-scroller="1"
        aria-live="polite"
        aria-busy={loading}
      >
        <div ref={contentCallbackRef} className="chat-messages-content">
        {items.map((item) => {
          if (item.kind === 'sidechain-group') {
            const liveStatus = resolveSidechainLiveStatus(
              item.rootUuid,
              item.parentUuids,
              effectiveSubagentStatusByParentUuid,
            );
            // Pega timestamp do primeiro turn do grupo pra mostrar HH:MM.
            const groupTs = messages.find((m) => m.uuid === item.rootUuid)?.timestamp;
            return (
              <SidechainChip
                key={`sc:${item.rootUuid}`}
                count={item.count}
                durMs={item.durMs}
                liveStatus={liveStatus}
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
                statusMap={effectiveSubagentStatusByParentUuid}
              />
            );
          }
          if (item.kind === 'ask-user') {
            const reqId = item.entry.request_id;
            return (
              <div key={`ask:${reqId}`} className="msg-row msg-row-assistant">
                <AskUserCard
                  entry={item.entry}
                  onSubmit={(answers) => submitAskUser(reqId, answers)}
                />
              </div>
            );
          }
          // payload.uuid é único por evento JSONL — chave estável protege
          // estado dos chips abertos quando troca sessão / ordem deslizar.
          const key = item.payload.uuid;
          const itemTs = item.payload.timestamp;
          if (item.kind === 'user') return <UserBubble key={key} text={item.text} ts={itemTs} />;
          if (item.kind === 'user-internal') return <UserInternalBubble key={key} text={item.text} ts={itemTs} />;
          if (item.kind === 'synthetic') return (
            <UserSyntheticBubble
              key={key}
              syntheticKind={item.syntheticKind}
              rawText={item.rawText}
              ts={itemTs}
            />
          );
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
                  accent={item.chip.accent}
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
        {optimistic && optimistic.length > 0 && (
          <>
            {optimistic.map((entry) => (
              <UserBubble
                key={`opt:${entry.clientId}`}
                text={entry.text}
                optimisticStatus={entry.status}
              />
            ))}
          </>
        )}
        {/* SENTINEL — NÃO condicionalizar: callback ref do scroller assume sentinel presente no mount. */}
        <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
        </div>
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
