'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AgentInputError,
  getCodexMessages,
  postAgentInput,
  postAgentImage,
  postAgentVoice,
  type CodexMessage,
} from '../lib/api';
import { safeUUID } from '../lib/ids';
import { useToast } from '../lib/toast-context';
import { useVoiceRecorder } from '../lib/use-voice-recorder';

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

function formatRecDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// TK-25 etapa 2 — chat da Tara (Codex) com ENVIO. Não usa o pipeline SSE do
// Claude Code: a Tara roda `codex exec`, o estado vive em ~/.codex. Mandamos via
// POST /input (backend ramifica codex → `codex exec resume` no mesmo rollout) e
// lemos a resposta pelo poll de /codex/messages, com bolha otimista + "digitando".

const POLL_IDLE_MS = 6000;
const POLL_ACTIVE_MS = 2200; // mais ágil enquanto espera resposta
const WAIT_TIMEOUT_MS = 180_000; // some o "digitando" se o turno travar

type Optimistic = { id: string; text: string };

export function CodexChat({ slug }: { slug: string }) {
  const { fire } = useToast();
  const [messages, setMessages] = useState<CodexMessage[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [optimistic, setOptimistic] = useState<Optimistic[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // Anexo de imagem pendente (envia no submit). "Nova conversa" mora no painel
  // (flag persistido codex_next_fresh), não aqui — o chat é só a mensagem.
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const waitingRef = useRef(false);
  const optimisticRef = useRef<Optimistic[]>([]);
  const baselineAssistantRef = useRef(0);
  const assistantCountRef = useRef(0);
  const waitStartRef = useRef(0);
  waitingRef.current = waiting;
  optimisticRef.current = optimistic;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await getCodexMessages(slug, signal);
        // visible + texto não-vazio (agent_message às vezes vem vazio → bolha fantasma).
        const visible = res.messages.filter((m) => m.visible && m.text.trim().length > 0);
        setMessages(visible);
        setHiddenCount(res.hidden_count);
        setStatus((s) => (visible.length ? 'ready' : s === 'loading' ? 'empty' : s));

        // Reconcilia bolha otimista que já virou mensagem real do usuário.
        setOptimistic((prev) =>
          prev.filter((o) => !visible.some((m) => m.role === 'user' && m.text.trim() === o.text)),
        );

        // Limpa "digitando" quando chega assistant novo depois do envio.
        const aCount = visible.filter((m) => m.role === 'assistant').length;
        if (waitingRef.current) {
          const grew = aCount > baselineAssistantRef.current;
          const timedOut = Date.now() - waitStartRef.current > WAIT_TIMEOUT_MS;
          if (grew || timedOut) setWaiting(false);
        }
        assistantCountRef.current = aCount;
      } catch {
        setStatus((s) => (s === 'loading' ? 'error' : s));
      }
    },
    [slug],
  );

  // Poll com cadência dinâmica: rápido enquanto espera/otimista pendente.
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      await load(ctrl.signal);
      if (!alive) return;
      const active = waitingRef.current || optimisticRef.current.length > 0;
      timer = setTimeout(tick, active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    };
    void tick();

    return () => {
      alive = false;
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [load]);

  // Cola no fim quando algo muda (read-only-ish, sem animação cronometrada).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, optimistic.length, waiting]);

  const afterSend = useCallback(() => {
    baselineAssistantRef.current = assistantCountRef.current;
    waitStartRef.current = Date.now();
    setWaiting(true);
    void load();
  }, [load]);

  const onSendError = useCallback(
    (err: unknown) => {
      const detail = err instanceof AgentInputError ? err.detail : null;
      if (detail === 'codex_turn_in_flight') {
        fire({ kind: 'warn', msg: 'Tara ainda está respondendo', sub: 'espere o turno terminar', ttlMs: 5000 });
      } else {
        fire({ kind: 'warn', msg: 'falha ao enviar pra Tara', sub: detail ?? String(err), ttlMs: 6000 });
      }
    },
    [fire],
  );

  const clearImage = useCallback(() => {
    setPendingImage(null);
    setThumbUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (sending) return;
    // Precisa de texto OU imagem.
    if (!trimmed && !pendingImage) return;
    setSending(true);
    try {
      if (pendingImage) {
        // Caption = texto digitado (opcional). Backend codex spawna `codex exec
        // resume <id> -i <path> "<caption|placeholder>"`.
        await postAgentImage(slug, pendingImage, trimmed || undefined);
        clearImage();
        setText('');
        afterSend();
        return;
      }
      const clientId = safeUUID();
      setOptimistic((o) => [...o, { id: clientId, text: trimmed }]);
      setText('');
      try {
        await postAgentInput(slug, trimmed);
        afterSend();
      } catch (err) {
        setOptimistic((o) => o.filter((e) => e.id !== clientId));
        setText(trimmed);
        throw err;
      }
    } catch (err) {
      onSendError(err);
    } finally {
      setSending(false);
    }
  }, [text, sending, pendingImage, slug, clearImage, afterSend, onSendError]);

  const onVoiceRecorded = useCallback(
    async (blob: Blob) => {
      setSending(true);
      try {
        await postAgentVoice(slug, blob);
        afterSend();
      } catch (err) {
        onSendError(err);
      } finally {
        setSending(false);
      }
    },
    [slug, afterSend, onSendError],
  );

  const { recording, audioLevels, durationSec, toggle, stopAndSend } = useVoiceRecorder({
    onRecorded: onVoiceRecorded,
    onWarn: (msg, sub) => fire({ kind: 'warn', msg, sub, ttlMs: 6000 }),
  });

  const attachImage = useCallback(
    (file: File | null) => {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        fire({ kind: 'warn', msg: 'só imagem', sub: file.type || 'tipo desconhecido', ttlMs: 5000 });
        return;
      }
      if (file.size > IMAGE_MAX_BYTES) {
        fire({ kind: 'warn', msg: 'imagem maior que 10MB', ttlMs: 5000 });
        return;
      }
      setThumbUrl((url) => {
        if (url) URL.revokeObjectURL(url);
        return URL.createObjectURL(file);
      });
      setPendingImage(file);
    },
    [fire],
  );

  // Revoga thumb no unmount.
  useEffect(() => () => {
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
  }, [thumbUrl]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="codex-history">
      <div className="codex-history-source" role="note">
        <span className="codex-source-dot" aria-hidden="true" />
        Codex local · thread contínua
      </div>

      <div ref={scrollRef} className="codex-history-scroll">
        {status === 'loading' && <div className="chat-messages-empty muted">carregando thread do Codex…</div>}
        {status === 'error' && <div className="chat-messages-empty muted">não consegui ler o estado local do Codex.</div>}
        {status === 'empty' && optimistic.length === 0 && (
          <div className="chat-messages-empty muted">sem conversa ainda — manda a primeira mensagem.</div>
        )}

        <div className="codex-history-list">
          {messages.map((m) =>
            m.item_type === 'function_call' ? (
              // Ação ao vivo: comando que a Tara rodou — linha discreta, NÃO bolha.
              <div key={m.id} className="codex-action-line" title={m.text}>
                <span className="codex-action-caret" aria-hidden="true">▸</span>
                <code>{m.text}</code>
              </div>
            ) : (
              <div key={m.id} className={`codex-bubble codex-bubble-${m.role}`}>
                <span className="codex-bubble-role">{m.role === 'user' ? 'Rica' : 'Tara'}</span>
                <p className="codex-bubble-text">{m.text}</p>
              </div>
            ),
          )}

          {optimistic.map((o) => (
            <div key={o.id} className="codex-bubble codex-bubble-user codex-bubble-pending">
              <span className="codex-bubble-role">Rica</span>
              <p className="codex-bubble-text">{o.text}</p>
            </div>
          ))}

          {waiting && (
            <div className="codex-bubble codex-bubble-assistant codex-typing" aria-label="Tara está digitando">
              <span className="codex-bubble-role">Tara</span>
              <span className="codex-typing-dots"><i /><i /><i /></span>
            </div>
          )}

          {hiddenCount > 0 && status === 'ready' && (
            <div className="codex-hidden-note muted">
              {hiddenCount} {hiddenCount === 1 ? 'item interno oculto' : 'itens internos ocultos'} (sistema/raciocínio/ferramentas)
            </div>
          )}
        </div>
      </div>

      <div className="chat-input-wrap">
        {thumbUrl && (
          <div className="chat-image-chip">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbUrl} alt="anexo" />
            <span className="chat-image-chip-name">{pendingImage?.name}</span>
            <button
              type="button"
              className="chat-image-chip-remove"
              onClick={clearImage}
              aria-label="Remover imagem"
              title="remover"
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
              stopAndSend();
              return;
            }
            void submit();
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              attachImage(e.target.files?.[0] ?? null);
            }}
          />
          <button
            type="button"
            className="chat-icon-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || recording}
            aria-label="Anexar imagem"
            title="anexar imagem"
          >
            <PaperclipIcon />
          </button>

          {recording ? (
            <div className="chat-waveform" aria-label="Gravando áudio">
              {audioLevels.map((lvl, i) => (
                <span
                  key={i}
                  className="chat-waveform-bar"
                  style={{ height: `${Math.max(8, lvl)}%` }}
                />
              ))}
              <span className="chat-recording-timer">{formatRecDuration(durationSec)}</span>
            </div>
          ) : (
            <textarea
              className="chat-input-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              maxLength={8192}
              placeholder={pendingImage ? 'legenda da imagem (opcional)…' : 'mensagem pra Tara (Codex)…'}
              aria-label="Mensagem pro agente Tara"
            />
          )}

          <button
            type="button"
            className="chat-icon-btn"
            onClick={() => void toggle()}
            disabled={sending}
            aria-label={recording ? 'Cancelar gravação' : 'Gravar áudio'}
            title={recording ? 'cancelar' : 'gravar áudio'}
          >
            {recording ? <span aria-hidden="true">✕</span> : <MicIcon />}
          </button>

          <button
            type="submit"
            className="chat-input-send"
            aria-disabled={sending || (!recording && text.trim().length === 0 && !pendingImage)}
            aria-label={sending ? 'Enviando…' : recording ? 'Parar e enviar' : 'Enviar mensagem'}
            title={sending ? 'enviando…' : recording ? 'parar e enviar' : 'enviar (Enter)'}
          >
            {sending ? <span aria-hidden="true">…</span> : recording ? <StopIcon /> : <ArrowUpIcon />}
          </button>
        </form>
      </div>
    </div>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

