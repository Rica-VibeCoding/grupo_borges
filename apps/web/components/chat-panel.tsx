'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import type { Agent } from '../lib/cockpit-types';
import { safeUUID } from '../lib/ids';
import type { OptimisticEntry } from '../lib/messages-types';
import {
  formatDuration,
  parseContextPct,
} from '../lib/cockpit-types';
import {
  AgentInputError,
  postAgentDestrava,
  postAgentModel,
  toShortModelSlug,
  toCodexModelSlug,
  type ChatModelSlug,
  type CodexModelSlug,
  type AnyModelSlug,
} from '../lib/api';
import { formatCompactNumber } from '../lib/painel-format';
import { useAgentSend } from '../lib/use-agent-send';
import { useFleet } from '../lib/fleet-context';
import { useToast } from '../lib/toast-context';
import { useMessagesStream } from '../lib/use-messages-stream';
import { stripCockpitEnvelope } from '../lib/render-items';
import { ChatMessages } from './chat-messages';
import { CodexChat } from './codex-history';
import { McpPanel } from './mcp-panel';
import {
  SlashCommandPalette,
  applySlashSelection,
  detectSlashContext,
  filterSlashCommands,
  type SlashCommand,
} from './slash-command-palette';

const MODEL_OPTIONS: Array<{ value: ChatModelSlug; label: string }> = [
  { value: 'fable', label: 'Fable 5' },
  { value: 'opus', label: 'Opus 4.8' },
  { value: 'sonnet', label: 'Sonnet 5' },
  { value: 'haiku', label: 'Haiku 4.5' },
];

const MODEL_LABEL: Record<ChatModelSlug, string> = {
  fable: 'Fable 5',
  opus: 'Opus 4.8',
  sonnet: 'Sonnet 5',
  haiku: 'Haiku 4.5',
};

// DS-69 — opções Codex pra Tara (executor_kind=codex). Slugs canônicos casam
// com a allowlist do backend; o label é o nome amigável pro Rica.
const CODEX_MODEL_OPTIONS: Array<{ value: CodexModelSlug; label: string }> = [
  { value: 'codex-gpt-5-6-sol', label: 'GPT-5.6 Sol' },
  { value: 'codex-gpt-5-6-terra', label: 'GPT-5.6 Terra' },
  { value: 'codex-gpt-5-6-luna', label: 'GPT-5.6 Luna' },
  { value: 'codex-gpt-5-5', label: 'GPT-5.5' },
  { value: 'codex-gpt-5-4', label: 'GPT-5.4' },
  { value: 'codex-gpt-5-4-mini', label: 'GPT-5.4 Mini' },
  { value: 'codex-gpt-5-3-codex', label: 'GPT-5.3 Codex' },
  { value: 'codex-gpt-5-2', label: 'GPT-5.2' },
];

const CODEX_MODEL_LABEL: Record<CodexModelSlug, string> = {
  'codex-gpt-5-6-sol': 'GPT-5.6 Sol',
  'codex-gpt-5-6-terra': 'GPT-5.6 Terra',
  'codex-gpt-5-6-luna': 'GPT-5.6 Luna',
  'codex-gpt-5-5': 'GPT-5.5',
  'codex-gpt-5-4': 'GPT-5.4',
  'codex-gpt-5-4-mini': 'GPT-5.4 Mini',
  'codex-gpt-5-3-codex': 'GPT-5.3 Codex',
  'codex-gpt-5-2': 'GPT-5.2',
};

/**
 * Aba CHAT do AgentModal — DS-2.
 *
 * - statusline embarcada (variant="modal" expandida no commit seguinte)
 * - <ChatInput> textarea Enter envia; Shift+Enter quebra linha (desktop).
 *   Mobile (pointer:coarse): Enter quebra linha, só botão envia
 * - <ModelSelector> SelectField; Codex disabled+tooltip; modal de
 *   confirmação quando `status === 'trabalhando'` (não toast)
 */
export function ChatPanel({
  agent,
  serverNow,
  codexNextFresh,
  onCodexNextFreshChange,
}: {
  agent: Agent;
  serverNow: number;
  codexNextFresh?: boolean;
  onCodexNextFreshChange?: (armed: boolean) => void;
}) {
  // TK-25 — Tara (codex) não tem stream de pane Claude Code; desliga o SSE e
  // renderiza histórico read-only do Codex local.
  const isCodex = agent.executor_kind === 'codex';
  const messagesStream = useMessagesStream(agent.slug, !isCodex);

  // JP-18 R2: optimistic state lifted pro ChatPanel pra ChatInput poder
  // registrar a bolha antes do POST e ChatMessages poder renderizar.
  // Reconciliação por (text, janela 2s) — backend não propaga clientId hoje.
  const agentSend = useAgentSend(agent.slug, agent.name);
  const [optimistic, setOptimistic] = useState<OptimisticEntry[]>([]);
  const [uuidToClientId, setUuidToClientId] = useState<Map<string, string>>(new Map());

  const submitText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const clientId = safeUUID();
      const entry: OptimisticEntry = {
        clientId,
        text: trimmed,
        ts: Date.now(),
        status: 'pending',
      };
      setOptimistic((prev) => [...prev, entry]);
      try {
        await agentSend.sendText(trimmed);
        // sucesso: status='sent'. SSE vai trazer o real e reconciliar.
        setOptimistic((prev) =>
          prev.map((e) => (e.clientId === clientId ? { ...e, status: 'sent' } : e)),
        );
      } catch {
        // toast já disparado dentro do useAgentSend; só marca erro local.
        setOptimistic((prev) =>
          prev.map((e) => (e.clientId === clientId ? { ...e, status: 'error' } : e)),
        );
      }
    },
    [agentSend],
  );

  // Reconcile em useMemo (render-time), NÃO em useEffect. Antes: SSE chegava,
  // items.map renderizava o real + bloco optimistic ainda renderizava o
  // pending → 1 frame com 2 balões → useEffect limpava no frame seguinte.
  // Usuário via "piscadinha de encaixe". Memo deriva visivelOptimistic na
  // mesma fase do render do real — frame 1 já sai limpo.
  // setOptimistic em useEffect só persiste a limpeza pra próximas decisões.
  const reconciledView = useMemo(
    () => reconcileOptimistic(optimistic, messagesStream.messages),
    [optimistic, messagesStream.messages],
  );
  const visibleOptimistic = reconciledView.next;
  const mergedUuidToClientId = useMemo(() => {
    if (reconciledView.reconciled.size === 0) return uuidToClientId;
    return new Map([...uuidToClientId, ...reconciledView.reconciled]);
  }, [uuidToClientId, reconciledView.reconciled]);
  useEffect(() => {
    if (reconciledView.next !== optimistic) {
      setOptimistic(reconciledView.next);
    }
    if (reconciledView.reconciled.size > 0) {
      setUuidToClientId((current) => new Map([...current, ...reconciledView.reconciled]));
    }
  }, [reconciledView, optimistic]);

  // Limpa quando troca de agente (slug muda → messagesStream reseta também).
  useEffect(() => {
    setOptimistic([]);
    setUuidToClientId(new Map());
  }, [agent.slug]);

  if (isCodex) {
    // Tara (Codex): chat próprio com envio via `codex exec resume` + poll do
    // rollout. Sem o pipeline SSE/optimistic do Claude Code.
    return (
      <div className="chat-panel">
        <ChatHeader
          agent={agent}
          serverNow={serverNow}
          codexNextFresh={codexNextFresh ?? Boolean(agent.codex_next_fresh)}
        />
        <CodexChat
          slug={agent.slug}
          nextFresh={codexNextFresh ?? Boolean(agent.codex_next_fresh)}
          onFreshConsumed={() => onCodexNextFreshChange?.(false)}
        />
      </div>
    );
  }

  return (
    <div className="chat-panel">
      <ChatHeader agent={agent} serverNow={serverNow} />
      <ChatMessages
        messages={messagesStream.messages}
        slug={agent.slug}
        loading={messagesStream.status === 'connecting' || messagesStream.status === 'replaying'}
        subagentStatusByParentUuid={messagesStream.subagentStatusByParentUuid}
        askUserByRequestId={messagesStream.askUserByRequestId}
        optimistic={visibleOptimistic}
        uuidToClientId={mergedUuidToClientId}
      />
      <ChatInput
        slug={agent.slug}
        agentName={agent.name}
        sendText={submitText}
        sendImage={agentSend.sendImage}
        sendVoice={agentSend.sendVoice}
        sending={agentSend.sending}
      />
    </div>
  );
}

// useOptimistic não serve: estado base vem de SSE async, action precisaria
// segurar até evento real chegar (janela imprevisível). Reconcile manual:
// match por (text + janela -2s..+30s), TTL 10s descarta órfãos silenciosos.
const OPTIMISTIC_TTL_MS = 10_000;
const OPTIMISTIC_MAX_LAG_MS = 30_000;

function reconcileOptimistic(
  pending: OptimisticEntry[],
  realMessages: ReturnType<typeof useMessagesStream>['messages'],
): { next: OptimisticEntry[]; reconciled: Map<string, string> } {
  const reconciled = new Map<string, string>();
  if (pending.length === 0) return { next: pending, reconciled };
  const now = Date.now();
  const userMsgs = realMessages.filter(
    (m) => m.message?.role === 'user' && m.user_type === 'external',
  );
  const consumed = new Set<string>();
  const next = pending.filter((opt) => {
    if (opt.status === 'error') return true; // mantém pra retry visual
    if (now - opt.ts > OPTIMISTIC_TTL_MS) return false; // órfão silencioso
    const match = userMsgs.find((m) => {
      if (consumed.has(m.uuid)) return false;
      const content = m.message?.content;
      const rawTxt = typeof content === 'string' ? content : '';
      // Envelope <channel source="cockpit"> envolve o texto cru no backend
      // pro hook detectar. Pra reconcile bater, strip antes de comparar.
      const txt = stripCockpitEnvelope(rawTxt) ?? rawTxt;
      if (txt.trim() !== opt.text) return false;
      const realTs = Date.parse(m.timestamp);
      if (!Number.isFinite(realTs)) return false;
      const lag = realTs - opt.ts;
      return lag > -2000 && lag < OPTIMISTIC_MAX_LAG_MS;
    });
    if (match) {
      consumed.add(match.uuid);
      reconciled.set(match.uuid, opt.clientId);
      return false;
    }
    return true;
  });
  // Se nada mudou, retorna ref original pra não causar re-render do consumer.
  return { next: next.length === pending.length ? pending : next, reconciled };
}

// ----- ChatHeader ---------------------------------------------------------
// DS-57: identidade do agente em 2 linhas + status-dot pulsante.
// Substitui AgentStatusline variant="modal" — dá presença ao agente como
// entidade, não apenas barra horizontal de tokens.

function ctxTier(pct: number): 'low' | 'mid' | 'high' {
  if (pct < 50) return 'low';
  if (pct < 80) return 'mid';
  return 'high';
}

function ChatHeader({
  agent,
  serverNow,
  codexNextFresh = false,
}: {
  agent: Agent;
  serverNow: number;
  codexNextFresh?: boolean;
}) {
  const isCodex = agent.executor_kind === 'codex';
  const sessionStarted = isCodex
    ? agent.session_started_at
    : agent.pane_session_started_at;
  const sessionSecs = sessionStarted !== null ? Math.max(0, serverNow - sessionStarted) : null;
  // Só mostra contexto de agente ativo — em offline/ocioso o header não deve
  // exibir % de agente parado (o excerpt fica stale). Codex não tem statusline.
  const contextIsRelevant = agent.status === 'trabalhando' || agent.status === 'aguardando';
  const contextPct = isCodex || !contextIsRelevant
    ? null
    : parseContextPct(agent.pane_excerpt);
  const codexTokens = isCodex ? agent.codex_tokens_used : null;
  const sessionLabel = sessionSecs !== null ? formatDuration(sessionSecs) : '—';

  return (
    <div className="chat-header" role="group" aria-label={`Cabeçalho do agente ${agent.name}`}>
      <span
        className="chat-header-dot"
        data-status={agent.status ?? 'ocioso'}
        aria-hidden="true"
        title={agent.status ?? 'ocioso'}
      />
      <div className="chat-header-meta mono">
        <span title="duração da sessão">{sessionLabel}</span>
        <span className="chat-header-sep" aria-hidden="true">·</span>
        {contextPct !== null ? (
          <span className="chat-header-ctx" title={`contexto ${contextPct}%`}>
            <span className="ps-bar" aria-hidden="true">
              {Array.from({ length: 10 }, (_, i) => (
                <span
                  key={i}
                  className="psb-cell"
                  data-on={i < Math.round(contextPct / 10) ? '1' : '0'}
                  data-tier={ctxTier(contextPct)}
                />
              ))}
            </span>
            <span>{contextPct}%</span>
          </span>
        ) : codexNextFresh ? (
          <span className="chat-header-dim">próxima thread nova</span>
        ) : codexTokens !== null ? (
          <span className="chat-header-dim">{formatCompactNumber(codexTokens)} tokens</span>
        ) : (
          <span className="chat-header-dim">ctx —</span>
        )}
      </div>
      <div className="chat-header-actions">
        <ModelChip agent={agent} />
      </div>
    </div>
  );
}

// ----- ChatInput ----------------------------------------------------------

const WAVEFORM_BARS = 24;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function formatRecordingDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ChatInput({
  slug,
  agentName,
  onFocusChange,
  sendText,
  sendImage,
  sendVoice,
  sending,
}: {
  slug: string;
  agentName: string;
  onFocusChange?: (focused: boolean) => void;
  sendText: (text: string) => Promise<void>;
  sendImage: (file: File, caption?: string) => Promise<void>;
  sendVoice: (blob: Blob) => Promise<void>;
  sending: boolean;
}) {
  const { fire } = useToast();
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tabPressedRef = useRef(false);
  const tabPressedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- long-press do send button → /destrava (volta pro chat fechando modal /status/mcp/memory) ---
  // Long-press só ativa com input vazio (não conflita com envio). 2s de pressão dispara
  // POST /destrava → backend manda Escape via send-keys. Cooldown de 5s evita spam.
  const LONG_PRESS_MS = 2000;
  const LONG_PRESS_COOLDOWN_MS = 5000;
  const LONG_PRESS_FIRED_FLASH_MS = 320;
  const [longPressing, setLongPressing] = useState(false);
  const [longPressFired, setLongPressFired] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressCooldownUntilRef = useRef(0);
  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setLongPressing(false);
  }, []);
  useEffect(() => () => {
    cancelLongPress();
    if (longPressFiredTimerRef.current) clearTimeout(longPressFiredTimerRef.current);
  }, [cancelLongPress]);

  // --- image state ---
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  // --- recording state ---
  const [recording, setRecording] = useState(false);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(WAVEFORM_BARS).fill(0));

  // Em dispositivos com pointer coarse (mobile/tablet), Enter quebra linha em
  // vez de enviar — só o botão de send envia. Desktop intocado.
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(pointer: coarse)');
    setIsCoarsePointer(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsCoarsePointer(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // --- JP-25: painel /mcp inline (intercepta input `/mcp` puro antes do tmux) ---
  const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
  const closeMcpPanel = useCallback(() => setMcpPanelOpen(false), []);

  // --- slash palette state (DS-62) ---
  // `slashSliceStart` é o índice do "/" no texto; `null` = palette fechado.
  const [slashSliceStart, setSlashSliceStart] = useState<number | null>(null);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashSelectedValue, setSlashSelectedValue] = useState<string>('');
  const slashItems = useMemo(
    () => (slashSliceStart === null ? [] : filterSlashCommands(slashQuery, agentName)),
    [slashSliceStart, slashQuery, agentName],
  );
  const slashOpen = slashSliceStart !== null;
  // Ajusta selectedValue quando os items mudam pra evitar item órfão.
  useEffect(() => {
    if (!slashOpen) return;
    if (slashItems.length === 0) return;
    if (!slashItems.some((c) => c.value === slashSelectedValue)) {
      setSlashSelectedValue(slashItems[0].value);
    }
  }, [slashOpen, slashItems, slashSelectedValue]);

  // Refs for MediaRecorder / AudioContext — not reactive state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Cleanup thumb URL on unmount / image change
  useEffect(() => {
    return () => {
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    };
  }, [thumbUrl]);

  useEffect(() => {
    return () => {
      if (tabPressedTimeoutRef.current) clearTimeout(tabPressedTimeoutRef.current);
      if (sendFlashTimeoutRef.current) clearTimeout(sendFlashTimeoutRef.current);
    };
  }, []);

  // Auto-grow textarea. overflow-y gerenciado aqui — CSS default é hidden pra
  // evitar scrollbar durante medição de scrollHeight (reflow reduz largura →
  // texto vaza fora do contorno no WebKit/iOS). Só ativa auto quando bate no cap.
  // Shrink animado SÓ no send (text → ''), via WAAPI — coordena com .chat-send-flash
  // (150ms). Nunca anima em digitação pra evitar clipping com overflow-y: hidden.
  const prevTextRef = useRef(text);
  const shrinkAnimationRef = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    shrinkAnimationRef.current?.cancel();
    const from = el.offsetHeight;
    el.style.height = 'auto';
    // +2px de folga absorve leading interno do WebKit (iOS Safari) que faz
    // scrollHeight bater curto e clipar a última linha em branco quando o
    // texto tem `\n\n` no meio.
    const h = el.scrollHeight + 2;
    const next = Math.min(h, 180);
    el.style.height = `${next}px`;
    el.style.overflowY = h > 180 ? 'auto' : 'hidden';
    // NÃO animar a altura no send. `height` dispara layout a cada frame: o WAAPI
    // de 250ms fazia o textarea encolher DEPOIS do scroll da bolha (dispara em
    // ~32ms), o scroller crescia tarde e a bolha aterrissava ~meio cm acima da
    // posição final — só fechava quando a msg real chegava e re-disparava o
    // scroll (a "descida" que o Rica via). Altura síncrona = layout final já
    // pronto quando o scroll roda. Feedback de envio fica com .chat-send-flash.
    void from;
    prevTextRef.current = text;
  }, [text]);

  // --- slash palette helpers (DS-62) ---

  // Marca o sliceStart do `/` que foi descartado via Esc — enquanto o caret
  // permanecer no mesmo slash context, syncSlashFromCaret NÃO reabre. Limpa
  // quando o contexto some (caret sai do `/<...>` ou texto muda fora dele).
  const dismissedSliceStartRef = useRef<number | null>(null);

  const syncSlashFromCaret = useCallback((value: string, caret: number) => {
    const ctx = detectSlashContext(value, caret);
    if (ctx === null) {
      dismissedSliceStartRef.current = null;
      setSlashSliceStart(null);
      setSlashQuery('');
      return;
    }
    if (dismissedSliceStartRef.current === ctx.sliceStart) {
      // Mesmo slash context que o user descartou — fica fechado.
      setSlashSliceStart(null);
      setSlashQuery('');
      return;
    }
    dismissedSliceStartRef.current = null;
    setSlashSliceStart(ctx.sliceStart);
    setSlashQuery(ctx.query);
  }, []);

  const closeSlash = useCallback(() => {
    dismissedSliceStartRef.current = slashSliceStart;
    setSlashSliceStart(null);
    setSlashQuery('');
  }, [slashSliceStart]);

  // Radix Dialog escuta Esc com `capture: true` no document — pra ter
  // precedência, registramos *no window* em capture (window vem antes de
  // document na fase capture). Quando palette aberto, sequestra Esc.
  useEffect(() => {
    if (slashSliceStart === null) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeSlash();
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [slashSliceStart, closeSlash]);

  const insertSlashCommand = useCallback(
    (cmd: SlashCommand) => {
      const el = textareaRef.current;
      if (!el || slashSliceStart === null) return;
      const caret = el.selectionStart ?? el.value.length;
      const next = applySlashSelection(text, caret, slashSliceStart, cmd);
      setText(next.text);
      closeSlash();
      // Restaurar caret após render (texto controlado dispara render assíncrono).
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (!node) return;
        node.focus();
        node.setSelectionRange(next.caret, next.caret);
      });
    },
    [text, slashSliceStart, closeSlash],
  );

  const onTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.currentTarget.value;
      const caret = e.currentTarget.selectionStart ?? value.length;
      setText(value);
      syncSlashFromCaret(value, caret);
    },
    [syncSlashFromCaret],
  );

  // Reabrir/recalcular palette quando caret muda sem digitação (setas, click).
  const onTextareaKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt') return;
      const el = e.currentTarget;
      syncSlashFromCaret(el.value, el.selectionStart ?? el.value.length);
    },
    [syncSlashFromCaret],
  );

  // --- helpers ---

  const clearImage = useCallback(() => {
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    setThumbUrl(null);
    setPendingImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [thumbUrl]);

  const flashTextareaSend = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (sendFlashTimeoutRef.current) clearTimeout(sendFlashTimeoutRef.current);
    el.classList.add('chat-send-flash');
    sendFlashTimeoutRef.current = setTimeout(() => {
      textareaRef.current?.classList.remove('chat-send-flash');
      sendFlashTimeoutRef.current = null;
    }, 800);
  }, []);

  const attachFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      fire({ kind: 'warn', msg: 'só imagens são suportadas', sub: `tipo recebido: ${file.type}` });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      fire({ kind: 'warn', msg: 'imagem muito grande', sub: 'limite: 10 MB' });
      return;
    }
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    setThumbUrl(URL.createObjectURL(file));
    setPendingImage(file);
  }, [fire, thumbUrl]);

  const startLongPress = useCallback(() => {
    if (text.trim() !== '' || pendingImage) return;
    if (Date.now() < longPressCooldownUntilRef.current) return;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    setLongPressing(true);
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      setLongPressing(false);
      setLongPressFired(true);
      if (longPressFiredTimerRef.current) clearTimeout(longPressFiredTimerRef.current);
      longPressFiredTimerRef.current = setTimeout(() => {
        longPressFiredTimerRef.current = null;
        setLongPressFired(false);
      }, LONG_PRESS_FIRED_FLASH_MS);
      longPressCooldownUntilRef.current = Date.now() + LONG_PRESS_COOLDOWN_MS;
      void postAgentDestrava(slug)
        .then(() => {
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try { navigator.vibrate(40); } catch { /* iOS pode bloquear */ }
          }
          fire({ kind: 'success', msg: 'voltei pro chat', ttlMs: 1500 });
        })
        .catch((err) => {
          fire({
            kind: 'warn',
            msg: 'destrava falhou',
            sub: err instanceof Error ? err.message : String(err),
            ttlMs: 4000,
          });
        });
    }, LONG_PRESS_MS);
  }, [text, pendingImage, slug, fire]);

  // --- submit ---

  const onSubmit = useCallback(async () => {
    if (sending) return;
    if (pendingImage) {
      const caption = text.trim() || undefined;
      flashTextareaSend();
      setText('');
      clearImage();
      textareaRef.current?.focus();
      await sendImage(pendingImage, caption);
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;
    // JP-25: `/mcp` puro (sem args) abre painel inline em vez de mandar pro tmux.
    // Outros `/mcp <arg>` seguem normal.
    if (trimmed === '/mcp') {
      setText('');
      closeSlash();
      setMcpPanelOpen(true);
      return;
    }
    flashTextareaSend();
    setText('');
    await sendText(trimmed);
  }, [sending, pendingImage, text, sendImage, sendText, clearImage, flashTextareaSend, closeSlash]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Esc com palette aberto é interceptado em window-capture (useEffect
      // acima) pra ter precedência sobre Radix Dialog. ArrowLeft/Right ficam
      // livres — o keyUp recalcula contexto se o caret sair do slash.
      if (slashOpen && slashItems.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const idx = slashItems.findIndex((c) => c.value === slashSelectedValue);
          const next = slashItems[(idx + 1) % slashItems.length];
          setSlashSelectedValue(next.value);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          const idx = slashItems.findIndex((c) => c.value === slashSelectedValue);
          const prev = slashItems[(idx - 1 + slashItems.length) % slashItems.length];
          setSlashSelectedValue(prev.value);
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          const sel = slashItems.find((c) => c.value === slashSelectedValue) ?? slashItems[0];
          insertSlashCommand(sel);
          return;
        }
      }

      if (e.key === 'Tab') {
        tabPressedRef.current = true;
        if (tabPressedTimeoutRef.current) clearTimeout(tabPressedTimeoutRef.current);
        tabPressedTimeoutRef.current = setTimeout(() => {
          tabPressedRef.current = false;
          tabPressedTimeoutRef.current = null;
        }, 300);
        return;
      }

      if (e.key !== 'Enter') return;
      if (e.shiftKey || tabPressedRef.current) return;
      if (isCoarsePointer) return;

      if (!e.altKey) {
        e.preventDefault();
        void onSubmit();
      }
    },
    [onSubmit, slashOpen, slashItems, slashSelectedValue, insertSlashCommand, isCoarsePointer],
  );

  // --- paste ---

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files);
      const imageFile = files.find((f) => f.type.startsWith('image/'));
      if (imageFile) {
        e.preventDefault();
        attachFile(imageFile);
      }
    },
    [attachFile],
  );

  // --- mic / recording ---

  const stopWaveformLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanupRecording = useCallback(() => {
    stopWaveformLoop();
    stopTimer();
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setAudioLevels(Array(WAVEFORM_BARS).fill(0));
    setRecordedDuration(0);
  }, [stopWaveformLoop, stopTimer]);

  const startWaveformLoop = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      // Map full FFT bin range down to WAVEFORM_BARS buckets
      const step = Math.floor(data.length / WAVEFORM_BARS);
      const levels = Array.from({ length: WAVEFORM_BARS }, (_, i) => {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += data[i * step + j];
        return Math.round((sum / step / 255) * 100);
      });
      setAudioLevels(levels);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const handleMicClick = useCallback(async () => {
    // If already recording: CANCEL (second click = cancel without send)
    if (recording) {
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current?.stop();
      cleanupRecording();
      setRecording(false);
      return;
    }

    // Start recording
    let stream: MediaStream;
    try {
      // navigator.mediaDevices is undefined in non-secure contexts (plain HTTP).
      // On iOS Safari, permission must be triggered by a direct user gesture —
      // calling getUserMedia from an async chain loses that link on some versions.
      // Autoplay policy note: AudioContext must be created/resumed inside the
      // user gesture handler (same constraint).
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      fire({
        kind: 'warn',
        msg: 'permissão de microfone negada',
        sub: err instanceof Error ? err.message : String(err),
        ttlMs: 6000,
      });
      return;
    }

    // AudioContext + Analyser + MediaRecorder dentro de try/catch único — em iOS
    // Chrome (WebKit) qualquer um pode lançar silencioso e travar a UI em estado
    // "botão active mas sem gravação". Falhas reportadas via toast pra debug claro.
    let ctx: AudioContext;
    let analyser: AnalyserNode;
    let recorder: MediaRecorder;
    let mimeType = '';
    try {
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('MediaRecorder não existe nesse browser');
      }
      ctx = new AudioContext();
      // iOS: ctx pode nascer 'suspended' fora do gesture chain — força resume.
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);

      // Cascata explícita: opus (Chrome/FF) → mp4/AAC (iOS WebKit) → default.
      mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      } catch {
        // iOS edge: isTypeSupported retorna true mas construtor falha — fallback.
        recorder = new MediaRecorder(stream);
        mimeType = '';
      }
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      fire({
        kind: 'warn',
        msg: 'falha ao iniciar gravação',
        sub: err instanceof Error ? err.message : String(err),
        ttlMs: 8000,
      });
      return;
    }

    audioContextRef.current = ctx;
    analyserRef.current = analyser;
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };

    recorder.onstop = async () => {
      // recorder.mimeType vem populado em browsers modernos; fallback pro mimeType
      // que escolhemos acima (ou mp4, que iOS sempre suporta — webm como default
      // dava falso-positivo em iOS antigo: blob marcado webm sendo mp4).
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || mimeType || 'audio/mp4',
      });
      stream.getTracks().forEach((t) => t.stop());
      cleanupRecording();
      setRecording(false);
      // Only send if we actually have audio (cancelled path does its own cleanup)
      if (blob.size > 0) {
        await sendVoice(blob);
      }
    };

    // recorder.start(timeslice) lança em algumas builds iOS Chrome — fallback sem arg.
    try {
      recorder.start(100);
    } catch {
      try {
        recorder.start();
      } catch (err) {
        stream.getTracks().forEach((t) => t.stop());
        cleanupRecording();
        fire({
          kind: 'warn',
          msg: 'gravação não iniciou',
          sub: err instanceof Error ? err.message : String(err),
          ttlMs: 8000,
        });
        return;
      }
    }
    setRecording(true);
    startWaveformLoop(analyser);

    // Duration counter
    let secs = 0;
    timerRef.current = setInterval(() => {
      secs += 1;
      setRecordedDuration(secs);
    }, 1000);
  }, [recording, fire, cleanupRecording, startWaveformLoop, sendVoice]);

  const handleStopRecording = useCallback(() => {
    // ⏹ button: stop and send
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      // onstop handler sends the voice blob
    }
  }, []);

  // sendDisabled: no image, no text, and not recording
  const sendDisabled =
    sending || (recording ? false : pendingImage ? false : text.trim().length === 0);

  return (
    <div className="chat-input-wrap">
      {/* mousedown.preventDefault impede que o clique no item tire foco do
          textarea antes do onSelect disparar. */}
      {slashOpen && (
        <div
          className="slash-palette-anchor"
          onMouseDown={(e) => e.preventDefault()}
        >
          <SlashCommandPalette
            items={slashItems}
            selectedValue={slashSelectedValue}
            onActiveChange={setSlashSelectedValue}
            onSelect={insertSlashCommand}
          />
        </div>
      )}
      {mcpPanelOpen && <McpPanel slug={slug} onClose={closeMcpPanel} />}
      {/* Image chip */}
      {pendingImage && thumbUrl && !recording && (
        <div className="chat-image-chip">
          <img src={thumbUrl} alt="" aria-hidden="true" />
          <span className="chat-image-chip-name" title={pendingImage.name}>
            {pendingImage.name}
          </span>
          <button
            type="button"
            className="chat-image-chip-remove"
            onClick={clearImage}
            aria-label="Remover imagem"
          >
            ✕
          </button>
        </div>
      )}

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (recording) {
            handleStopRecording();
          } else {
            void onSubmit();
          }
        }}
        onPaste={onPaste}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) attachFile(file);
          }}
        />

        {recording ? (
          /* Waveform mode — replaces textarea + paperclip */
          <div className="chat-waveform" aria-label="Gravando áudio">
            {audioLevels.map((lvl, i) => (
              <span
                key={i}
                className="chat-waveform-bar"
                style={{ height: `${Math.max(4, Math.round(lvl * 0.36))}px` }}
                aria-hidden="true"
              />
            ))}
            <span
              className="chat-recording-timer mono"
              aria-live="polite"
              aria-label={`Duração: ${formatRecordingDuration(recordedDuration)}`}
            >
              {formatRecordingDuration(recordedDuration)}
            </span>
          </div>
        ) : (
          <>
            {/* Paperclip */}
            <button
              type="button"
              className="chat-icon-btn"
              aria-label="Anexar imagem"
              title={`anexar imagem pro ${agentName}`}
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon />
            </button>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              className="chat-input-textarea"
              value={text}
              onChange={onTextareaChange}
              onKeyDown={onKeyDown}
              onKeyUp={onTextareaKeyUp}
              onClick={(e) =>
                syncSlashFromCaret(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
              }
              onFocus={() => onFocusChange?.(true)}
              onBlur={() => onFocusChange?.(false)}
              rows={1}
              maxLength={8192}
              placeholder={pendingImage ? 'legenda opcional…' : undefined}
              aria-label={`Mensagem pro agente ${agentName}`}
              aria-haspopup="listbox"
              aria-expanded={slashOpen}
              aria-controls={slashOpen ? 'slash-palette-listbox' : undefined}
              aria-activedescendant={
                slashOpen && slashSelectedValue
                  ? `slash-item-${slashSelectedValue}`
                  : undefined
              }
            />
          </>
        )}

        {/* Mic / Stop */}
        <button
          type={recording ? 'submit' : 'button'}
          className={recording ? 'chat-icon-btn chat-stop-btn' : 'chat-icon-btn'}
          aria-label={recording ? 'Parar gravação' : 'Gravar mensagem de voz'}
          title={recording ? 'parar e enviar (⏹)' : 'gravar mensagem de voz'}
          onClick={recording ? undefined : () => void handleMicClick()}
        >
          {recording ? <StopIcon /> : <MicIcon />}
        </button>

        {/* Send (long-press com input vazio → /destrava: fecha modal /status, /mcp etc).
            Pointer Events unificados — separar mouse/touch é frágil em iOS (touchcancel
            automático em long-press pra exibir callout nativo). setPointerCapture
            garante que pointerup/cancel cheguem mesmo se o dedo sair do botão.
            aria-disabled em vez de disabled pra eventos passarem; onSubmit já no-op
            quando input vazio (linha ~660). */}
        <button
          type="submit"
          className="chat-input-send"
          aria-disabled={sendDisabled}
          aria-label={sending ? 'Enviando…' : 'Enviar mensagem'}
          title={sending ? 'enviando…' : 'enviar (Enter) · segure 2s pra voltar pro chat'}
          data-long-pressing={longPressing || undefined}
          data-long-press-fired={longPressFired || undefined}
          onPointerDown={(e) => {
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* iOS pode falhar */ }
            startLongPress();
          }}
          onPointerUp={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onPointerLeave={cancelLongPress}
        >
          {sending ? <span aria-hidden="true">…</span> : <ArrowUpIcon />}
        </button>
      </form>
    </div>
  );
}

function ArrowUpIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

// ----- ModelChip ---------------------------------------------------------
// Chip clickable inline na statusline (Pavan opção B). Visual: "Opus ▾".
// Lógica idêntica ao antigo <ModelSelector>: confirmação modal quando
// status === 'trabalhando', toast em sucesso/falha, Codex disabled+tooltip.

function ModelChip({ agent }: { agent: Agent }) {
  const { mutate } = useFleet();
  const { fire } = useToast();
  // DS-69 — Codex (Tara) usa allowlist e fluxo próprios: troca não vale em
  // runtime, só na próxima execução. Claude Code segue o /model de sempre.
  const isCodex = agent.executor_kind === 'codex';
  const options = isCodex ? CODEX_MODEL_OPTIONS : MODEL_OPTIONS;
  const fallbackSlug: AnyModelSlug = isCodex ? 'codex-gpt-5-6-sol' : 'opus';
  const labelOf = useCallback(
    (slug: AnyModelSlug): string =>
      isCodex
        ? CODEX_MODEL_LABEL[slug as CodexModelSlug] ?? slug
        : MODEL_LABEL[slug as ChatModelSlug] ?? slug,
    [isCodex],
  );
  const currentSlug: AnyModelSlug | null = useMemo(
    () =>
      isCodex
        ? toCodexModelSlug(agent.state_model ?? agent.model_default)
        : toShortModelSlug(agent.state_model ?? agent.model_default),
    [isCodex, agent.state_model, agent.model_default],
  );

  const [pending, setPending] = useState<AnyModelSlug | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<AnyModelSlug | null>(null);

  const sendChange = useCallback(
    async (target: AnyModelSlug, force: boolean) => {
      setBusy(true);
      setPending(target);
      try {
        const res = await postAgentModel(agent.slug, target, { force });
        if (!res.runtime_switch) {
          // Codex: persistido, vale na próxima execução da Tara.
          fire({ kind: 'success', msg: `Tara usa ${labelOf(target)} na próxima execução` });
        } else if (!res.tmux_delivered) {
          fire({ kind: 'warn', msg: 'troca não entregue', sub: 'pane fora do CLI esperado', ttlMs: 6000 });
        } else if (!res.confirmed) {
          fire({ kind: 'warn', msg: 'troca enviada, não confirmada', sub: 'verifique a statusline', ttlMs: 6000 });
        } else {
          fire({ kind: 'success', msg: `modelo trocado pra ${labelOf(target)}` });
        }
        await mutate();
      } catch (err) {
        const detail = err instanceof AgentInputError ? err.detail : null;
        fire({ kind: 'warn', msg: 'falha ao trocar modelo', sub: detail ?? String(err), ttlMs: 6000 });
      } finally {
        setBusy(false);
        setPending(null);
      }
    },
    [agent.slug, fire, labelOf, mutate],
  );

  const onSelect = useCallback(
    (next: string) => {
      const slug = next as AnyModelSlug;
      if (busy) return;
      if (slug === currentSlug) return;
      // Codex não toca a sessão viva — sem modal de "trabalhando", persiste direto.
      if (!isCodex && agent.status === 'trabalhando') {
        setConfirmTarget(slug);
        return;
      }
      void sendChange(slug, false);
    },
    [agent.status, busy, currentSlug, isCodex, sendChange],
  );

  const displaySlug = pending ?? currentSlug ?? fallbackSlug;
  const displayLabel = labelOf(displaySlug);
  const disabled = busy;

  return (
    <>
      <Select.Root
        value={displaySlug}
        onValueChange={onSelect}
        disabled={disabled}
      >
        <Select.Trigger
          className="model-chip"
          aria-label="Modelo"
          aria-busy={busy}
          title={isCodex ? 'Modelo da próxima execução da Tara' : 'Trocar modelo'}
        >
          <Select.Value>{displayLabel}</Select.Value>
          <Select.Icon className="model-chip-caret" aria-hidden="true">▾</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="select-content" position="popper" sideOffset={4}>
            {isCodex && (
              <div className="select-hint" role="note">
                vale na próxima execução
              </div>
            )}
            <Select.Viewport>
              {options.map((opt) => (
                <Select.Item key={opt.value} value={opt.value} className="select-item">
                  <Select.ItemText>{opt.label}</Select.ItemText>
                  <Select.ItemIndicator className="select-indicator">✓</Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      <Dialog.Root
        open={confirmTarget !== null}
        onOpenChange={(o) => { if (!o) setConfirmTarget(null); }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="agent-modal-overlay" />
          <Dialog.Content
            className="chat-confirm-frame mono"
            aria-describedby="chat-confirm-desc"
          >
            <Dialog.Title className="chat-confirm-title">
              Trocar modelo com o agente trabalhando?
            </Dialog.Title>
            <p id="chat-confirm-desc" className="chat-confirm-body">
              {agent.name} está em um turno ativo. Mandar <code>/model {confirmTarget}</code>{' '}
              agora pode entrar como prompt do turno em vez de trocar o modelo.
            </p>
            <div className="chat-confirm-actions">
              <button
                type="button"
                className="form-submit"
                onClick={() => {
                  const t = confirmTarget;
                  setConfirmTarget(null);
                  if (t) void sendChange(t, true);
                }}
              >
                TROCAR MESMO ASSIM
              </button>
              <Dialog.Close asChild>
                <button type="button" className="handoff-toggle">cancelar</button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
