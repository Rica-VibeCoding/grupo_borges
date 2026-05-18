'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import type { Agent } from '../lib/cockpit-types';
import {
  formatDuration,
  formatLastSeen,
  parseContextPct,
  parseModelFromPane,
  shortModelName,
} from '../lib/cockpit-types';
import {
  AgentInputError,
  postAgentModel,
  toShortModelSlug,
  type ChatModelSlug,
} from '../lib/api';
import { useAgentSend } from '../lib/use-agent-send';
import { useFleet } from '../lib/fleet-context';
import { useToast } from '../lib/toast-context';
import { usePaneStream } from '../lib/use-pane-stream';
import { useMessagesStream } from '../lib/use-messages-stream';
import {
  endsWithActiveSpinner,
  parseAnsi,
  stripChrome,
} from '../lib/pane-chrome';
import { ChatMessages } from './chat-messages';
import {
  SlashCommandPalette,
  applySlashSelection,
  detectSlashContext,
  filterSlashCommands,
  type SlashCommand,
} from './slash-command-palette';

const MODEL_OPTIONS: Array<{ value: ChatModelSlug; label: string }> = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

const MODEL_LABEL: Record<ChatModelSlug, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

/**
 * Aba CHAT do AgentModal — DS-2.
 *
 * - statusline embarcada (variant="modal" expandida no commit seguinte)
 * - <PanePreview> sticky-bottom com pílula "↓ novo" quando user destacou
 * - <ChatInput> textarea Enter envia; Shift+Enter quebra linha (desktop).
 *   Mobile (pointer:coarse): Enter quebra linha, só botão envia
 * - <ModelSelector> SelectField; Codex disabled+tooltip; modal de
 *   confirmação quando `status === 'trabalhando'` (não toast)
 */
export function ChatPanel({
  agent,
  serverNow,
  mode = 'pane',
}: {
  agent: Agent;
  serverNow: number;
  /** 'pane' = excerpt cru do tmux (debug). 'chat' = JSONL parseado (JP-11 Fase 2). */
  mode?: 'pane' | 'chat';
}) {
  // Mobile: enquanto user digita, preview fica imóvel (sem scroll involuntário).
  // Decisão de UX cravada pelo Rica — chat ocupando metade vertical em iOS Safari
  // é inviável quando o zoom dispara no focus do textarea.
  const [inputFocused, setInputFocused] = useState(false);
  const paneStream = usePaneStream(agent.slug, /* enabled */ mode === 'pane');
  const messagesStream = useMessagesStream(agent.slug, /* enabled */ mode === 'chat');
  const excerpt = paneStream.excerpt ?? agent.pane_excerpt ?? '';
  const executorKind = paneStream.executorKind ?? agent.executor_kind ?? 'claude_code';

  return (
    <div className="chat-panel">
      <ChatHeader agent={agent} serverNow={serverNow} />
      {mode === 'pane' ? (
        <PanePreview
          excerpt={excerpt}
          executorKind={executorKind}
          connectionStatus={paneStream.status}
          paused={inputFocused}
        />
      ) : (
        <ChatMessages
          messages={messagesStream.messages}
          slug={agent.slug}
          loading={messagesStream.status === 'connecting' || messagesStream.status === 'replaying'}
          subagentStatusByParentUuid={messagesStream.subagentStatusByParentUuid}
        />
      )}
      <ChatInput
        slug={agent.slug}
        agentName={agent.name}
        onFocusChange={setInputFocused}
      />
    </div>
  );
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

function ChatHeader({ agent, serverNow }: { agent: Agent; serverNow: number }) {
  const isCodex = agent.executor_kind === 'codex';
  const model = agent.state_model ?? agent.model_default;
  const sessionStarted = isCodex
    ? agent.session_started_at
    : agent.pane_session_started_at;
  const sessionSecs = sessionStarted !== null ? Math.max(0, serverNow - sessionStarted) : null;
  const contextPct = isCodex
    ? (agent.context_pct ?? null)
    : parseContextPct(agent.pane_excerpt);
  const paneModel = isCodex ? null : parseModelFromPane(agent.pane_excerpt);
  const modelLabel = paneModel ?? shortModelName(model);
  const sessionLabel = sessionSecs !== null ? formatDuration(sessionSecs) : '—';
  const seenLabel = formatLastSeen(agent.last_seen, serverNow);
  const seenTitle = agent.last_seen ? new Date(agent.last_seen * 1000).toISOString() : '—';

  return (
    <div className="chat-header" role="group" aria-label={`Cabeçalho do agente ${agent.name}`}>
      <span
        className="chat-header-dot"
        data-status={agent.status ?? 'ocioso'}
        aria-hidden="true"
        title={agent.status ?? 'ocioso'}
      />
      <div className="chat-header-meta mono">
        <span>{modelLabel}</span>
        <span className="chat-header-sep" aria-hidden="true">·</span>
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
        ) : (
          <span className="chat-header-dim">ctx —</span>
        )}
        <span className="chat-header-sep" aria-hidden="true">·</span>
        <span className="chat-header-dim" title={seenTitle}>visto {seenLabel.replace(/^há /, '')}</span>
      </div>
      <div className="chat-header-actions">
        <ModelChip agent={agent} />
      </div>
    </div>
  );
}

// ----- PanePreview --------------------------------------------------------
//
// Chrome do próprio Claude Code (statusline, spinner, separadores) é
// filtrado no display via `stripChrome` — `agent.pane_excerpt` continua
// intacto pros parsers (parseContextPct, parseModelFromPane) extraírem
// ctx%/modelo/tempo da linha de statusline.
//
// Frame parcial: quando o excerpt termina com spinner ATIVO, CC ainda está
// escrevendo — renderizar o tick atual produz meio-frame flickerando.
// `lastGoodFrameRef` segura o último frame estável; só atualiza quando
// `endsWithActiveSpinner` é false (pattern via context7 React 19 — derive
// no render, persiste em useLayoutEffect).
//
// Lógica isolada e testada em `lib/pane-chrome.ts` + `tests/pane-chrome.test.ts`.

function PanePreview({
  excerpt,
  executorKind: _executorKind,
  connectionStatus,
  paused = false,
}: {
  excerpt: string;
  executorKind: string;
  connectionStatus: string;
  paused?: boolean;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const [stuck, setStuck] = useState(true);

  const isPartial = useMemo(() => endsWithActiveSpinner(excerpt), [excerpt]);
  const cleanedNow = useMemo(() => stripChrome(excerpt), [excerpt]);
  const lastGoodFrameRef = useRef<string>('');

  useLayoutEffect(() => {
    if (!isPartial) {
      lastGoodFrameRef.current = cleanedNow;
    }
  }, [cleanedNow, isPartial]);

  // Fallback: primeira render com isPartial=true (sessão CC abriu com spinner
  // ativo) — ref ainda vazia. Mostrar cleanedNow evita "tela vazia" inicial.
  const display = isPartial && lastGoodFrameRef.current
    ? lastGoodFrameRef.current
    : cleanedNow;
  const segments = useMemo(() => parseAnsi(display), [display]);
  const empty = segments.length === 0;

  useLayoutEffect(() => {
    const el = preRef.current;
    if (!el || !stuck) return;
    if (paused) return;
    el.scrollTop = el.scrollHeight;
  }, [display, stuck, paused]);

  const onScroll = useCallback(() => {
    const el = preRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setStuck(atBottom);
  }, []);

  const goBottom = useCallback(() => {
    const el = preRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setStuck(true);
  }, []);

  return (
    <div className="chat-preview-wrap">
      <pre
        ref={preRef}
        className="chat-preview mono"
        onScroll={onScroll}
        aria-live="polite"
        aria-busy={connectionStatus === 'connecting'}
      >
        {empty ? (
          '— sem saída capturada —'
        ) : (
          segments.map((seg, i) => (
            <span
              key={i}
              style={{
                color: seg.color,
                fontWeight: seg.bold ? 700 : undefined,
              }}
            >
              {seg.text}
            </span>
          ))
        )}
      </pre>
      {!stuck && (
        <button
          type="button"
          className="chat-preview-pill"
          onClick={goBottom}
          aria-label="Rolar pro fim do pane"
        >
          ↓ novo conteúdo
        </button>
      )}
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
}: {
  slug: string;
  agentName: string;
  onFocusChange?: (focused: boolean) => void;
}) {
  const { sending, sendText, sendImage, sendVoice } = useAgentSend(slug, agentName);
  const { fire } = useToast();
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tabPressedRef = useRef(false);
  const tabPressedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const h = el.scrollHeight;
    el.style.height = `${Math.min(h, 134)}px`;
    el.style.overflowY = h > 134 ? 'auto' : 'hidden';
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
    }, 150);
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

  // --- submit ---

  const onSubmit = useCallback(async () => {
    if (sending) return;
    if (pendingImage) {
      const caption = text.trim() || undefined;
      flashTextareaSend();
      await sendImage(pendingImage, caption);
      clearImage();
      setText('');
      textareaRef.current?.focus();
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;
    flashTextareaSend();
    await sendText(trimmed);
    setText('');
  }, [sending, pendingImage, text, sendImage, sendText, clearImage, flashTextareaSend]);

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

    // AudioContext + Analyser for waveform
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    audioContextRef.current = ctx;
    analyserRef.current = analyser;

    // MediaRecorder — prefer webm/opus, fallback to browser default
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : '';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      stream.getTracks().forEach((t) => t.stop());
      cleanupRecording();
      setRecording(false);
      // Only send if we actually have audio (cancelled path does its own cleanup)
      if (blob.size > 0) {
        await sendVoice(blob);
      }
    };

    recorder.start(100); // collect chunks every 100ms
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

        {/* Send */}
        <button
          type="submit"
          className="chat-input-send"
          disabled={sendDisabled}
          aria-label={sending ? 'Enviando…' : 'Enviar mensagem'}
          title={sending ? 'enviando…' : 'enviar (Enter)'}
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
  const isCodex = agent.executor_kind === 'codex';
  const currentSlug: ChatModelSlug | null = useMemo(
    () => toShortModelSlug(agent.state_model ?? agent.model_default),
    [agent.state_model, agent.model_default],
  );

  const [pending, setPending] = useState<ChatModelSlug | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<ChatModelSlug | null>(null);

  const sendChange = useCallback(
    async (target: ChatModelSlug, force: boolean) => {
      setBusy(true);
      setPending(target);
      try {
        const res = await postAgentModel(agent.slug, target, { force });
        if (!res.tmux_delivered) {
          fire({ kind: 'warn', msg: 'troca não entregue', sub: 'pane fora do CLI esperado', ttlMs: 6000 });
        } else if (!res.confirmed) {
          fire({ kind: 'warn', msg: 'troca enviada, não confirmada', sub: 'verifique a statusline', ttlMs: 6000 });
        } else {
          fire({ kind: 'success', msg: `modelo trocado pra ${target}` });
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
    [agent.slug, fire, mutate],
  );

  const onSelect = useCallback(
    (next: string) => {
      const slug = next as ChatModelSlug;
      if (busy) return;
      if (slug === currentSlug) return;
      if (agent.status === 'trabalhando') {
        setConfirmTarget(slug);
        return;
      }
      void sendChange(slug, false);
    },
    [agent.status, busy, currentSlug, sendChange],
  );

  const displaySlug = (pending ?? currentSlug ?? 'opus') as ChatModelSlug;
  const displayLabel = MODEL_LABEL[displaySlug];
  const disabled = busy || isCodex;

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
          title={isCodex ? 'Codex não troca modelo em runtime' : 'Trocar modelo'}
        >
          <Select.Value>{displayLabel}</Select.Value>
          <Select.Icon className="model-chip-caret" aria-hidden="true">▾</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="select-content" position="popper" sideOffset={4}>
            <Select.Viewport>
              {MODEL_OPTIONS.map((opt) => (
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
