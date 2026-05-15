'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import type { Agent } from '../lib/cockpit-types';
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
import { AgentStatusline } from './agent-statusline';

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
 * - <ChatInput> textarea ⌘+Enter / Ctrl+Enter
 * - <ModelSelector> SelectField; Codex disabled+tooltip; modal de
 *   confirmação quando `status === 'trabalhando'` (não toast)
 */
export function ChatPanel({ agent, serverNow }: { agent: Agent; serverNow: number }) {
  const stream = usePaneStream(agent.slug, /* enabled */ true);
  // Mobile: enquanto user digita, preview fica imóvel (sem scroll involuntário).
  // Decisão de UX cravada pelo Rica — chat ocupando metade vertical em iOS Safari
  // é inviável quando o zoom dispara no focus do textarea.
  const [inputFocused, setInputFocused] = useState(false);

  const excerpt = stream.excerpt ?? agent.pane_excerpt ?? '';
  const executorKind = stream.executorKind ?? agent.executor_kind ?? 'claude_code';

  return (
    <div className="chat-panel">
      <AgentStatusline
        agent={agent}
        serverNow={serverNow}
        variant="modal"
        extra={<ModelChip agent={agent} />}
      />
      <PanePreview
        excerpt={excerpt}
        executorKind={executorKind}
        connectionStatus={stream.status}
        paused={inputFocused}
      />
      <ChatInput
        slug={agent.slug}
        agentName={agent.name}
        onFocusChange={setInputFocused}
      />
    </div>
  );
}

// ----- PanePreview --------------------------------------------------------

// Chrome do próprio Claude Code que vaza no excerpt (não é conteúdo do
// agente). Filtragem só aqui no display — `agent.pane_excerpt` continua
// intacto pros parsers (parseContextPct, parseModelFromPane) extraírem
// ctx%/modelo/tempo da linha de statusline.
//
// Validado contra 19 fixtures reais de tmux capture (DS-2 polish v2).
const CC_CHROME_PATTERNS: RegExp[] = [
  // Statusline: HH:MM ou HH:MM:SS, bar opcional, % no meio/fim, sufixo livre.
  // Pega tanto "Opus 4.7 - 32:13 - [█░] 16%" quanto a versão concatenada
  // com "Remote Control active" no fim da mesma linha.
  /^.*?\b(?:Opus|Sonnet|Haiku)\s+\d+\.\d+\b.*?\d+%/,
  // "Verb for Nm Ns" — spinner finalizado: ✻ Brewed, * Cogitated,
  // Considering, Thinking, Sautéed, Osmosing, Boogieing, Flibbertigibbeting…
  /^[\W]*\w+\s+for\s+\d+m?\s*\d*s?(\s*[·•].*)?\s*$/u,
  // Spinner ATIVO com contador de tokens:
  // "· Boogieing… (1m 8s · ↓ 2.7k tokens · thought for 33s)"
  /^[\s·•⏺]+\w+(?:ing|ed|aed)\.?…?\s*\(.*tokens.*\)$/u,
  // "Remote Control active" / "Remote Control connecting…" (qualquer estado).
  /Remote Control\s+\w+/,
  // "⏵⏵ bypass permissions on …" / "▶▶ bypass permissions …" — char varia
  // (U+23F5 vs U+25B6), catch por substring é mais seguro.
  /bypass permissions/,
];

// Separador horizontal: 8+ chars consecutivos de box-drawing/block elements.
// Captura tanto "──────" puro quanto "── Daniel ──" (texto curto entre regras).
const SEPARATOR_RULE = /[─━═│┃╭╮╰╯╱╳─-╿▀-▟]{8,}/u;

function isChromeLine(line: string): boolean {
  if (!line) return false;
  if (SEPARATOR_RULE.test(line)) return true;
  return CC_CHROME_PATTERNS.some((re) => re.test(line));
}

function stripChrome(src: string): string {
  if (!src) return src;
  return src
    .split('\n')
    .map((line) => (isChromeLine(line) ? '' : line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+$/, '');
}

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

  useLayoutEffect(() => {
    const el = preRef.current;
    if (!el || !stuck) return;
    // paused (user digitando): chat fica imóvel — sem scroll involuntário.
    // Quando paused vira false (blur), efeito roda de novo e segue stuck-bottom.
    if (paused) return;
    el.scrollTop = el.scrollHeight;
  }, [excerpt, stuck, paused]);

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

  const cleaned = useMemo(() => stripChrome(excerpt), [excerpt]);
  const empty = !cleaned;

  return (
    <div className="chat-preview-wrap">
      <pre
        ref={preRef}
        className="chat-preview mono"
        onScroll={onScroll}
        aria-live="polite"
        aria-busy={connectionStatus === 'connecting'}
      >
        {empty ? '— sem saída capturada —' : cleaned}
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

function formatDuration(seconds: number): string {
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

  // --- image state ---
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  // --- recording state ---
  const [recording, setRecording] = useState(false);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(WAVEFORM_BARS).fill(0));

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

  // Auto-grow textarea
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 134)}px`;
  }, [text]);

  // --- helpers ---

  const clearImage = useCallback(() => {
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    setThumbUrl(null);
    setPendingImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [thumbUrl]);

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
      await sendImage(pendingImage, caption);
      clearImage();
      setText('');
      textareaRef.current?.focus();
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;
    await sendText(trimmed);
    setText('');
  }, [sending, pendingImage, text, sendImage, sendText, clearImage]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void onSubmit();
      }
    },
    [onSubmit],
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
              aria-label={`Duração: ${formatDuration(recordedDuration)}`}
            >
              {formatDuration(recordedDuration)}
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
              className="chat-input-textarea mono"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              onFocus={() => onFocusChange?.(true)}
              onBlur={() => onFocusChange?.(false)}
              rows={1}
              maxLength={8192}
              placeholder={pendingImage ? 'legenda opcional…' : undefined}
              aria-label={`Mensagem pro agente ${agentName}`}
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
          title={sending ? 'enviando…' : 'enviar (⌘+Enter)'}
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
      width="18"
      height="18"
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
