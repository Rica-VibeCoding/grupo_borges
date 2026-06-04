'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AgentInputError,
  getCodexMessages,
  postAgentInput,
  type CodexMessage,
} from '../lib/api';
import { safeUUID } from '../lib/ids';
import { useToast } from '../lib/toast-context';

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

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const clientId = safeUUID();
    setOptimistic((o) => [...o, { id: clientId, text: trimmed }]);
    setText('');
    setSending(true);
    try {
      await postAgentInput(slug, trimmed);
      baselineAssistantRef.current = assistantCountRef.current;
      waitStartRef.current = Date.now();
      setWaiting(true);
      void load();
    } catch (err) {
      const detail = err instanceof AgentInputError ? err.detail : null;
      if (detail === 'codex_turn_in_flight') {
        fire({ kind: 'warn', msg: 'Tara ainda está respondendo', sub: 'espere o turno terminar', ttlMs: 5000 });
      } else {
        fire({ kind: 'warn', msg: 'falha ao enviar pra Tara', sub: detail ?? String(err), ttlMs: 6000 });
      }
      setOptimistic((o) => o.filter((e) => e.id !== clientId));
      setText(trimmed);
    } finally {
      setSending(false);
    }
  }, [text, sending, slug, load, fire]);

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
          {messages.map((m) => (
            <div key={m.id} className={`codex-bubble codex-bubble-${m.role}`}>
              <span className="codex-bubble-role">{m.role === 'user' ? 'Rica' : 'Tara'}</span>
              <p className="codex-bubble-text">{m.text}</p>
            </div>
          ))}

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

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          className="chat-input-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={8192}
          placeholder="mensagem pra Tara (Codex)…"
          aria-label="Mensagem pro agente Tara"
        />
        <button
          type="submit"
          className="chat-input-send"
          aria-disabled={sending || text.trim().length === 0}
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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  );
}
