'use client';

import { useEffect, useRef, useState } from 'react';
import { getCodexMessages, type CodexMessage } from '../lib/api';

// TK-25 — histórico READ-ONLY da última thread Codex da Tara. Não usa o
// pipeline de SSE/ChatMessages (que é do Claude Code): a Tara roda `codex exec`
// e o estado real vive em `~/.codex`. Aqui só pintamos bolhas user/assistant
// já sanitizadas pelo backend, com selo "Codex local" e sem fingir contexto.

const POLL_MS = 6000;

export function CodexHistory({ slug }: { slug: string }) {
  const [messages, setMessages] = useState<CodexMessage[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();

    async function load() {
      try {
        const res = await getCodexMessages(slug, ctrl.signal);
        if (!alive) return;
        const visible = res.messages.filter((m) => m.visible);
        setMessages(visible);
        setHiddenCount(res.hidden_count);
        setStatus(visible.length ? 'ready' : 'empty');
      } catch {
        if (alive) setStatus((s) => (s === 'loading' ? 'error' : s));
      }
    }

    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      ctrl.abort();
      clearInterval(timer);
    };
  }, [slug]);

  // Cola no fim quando a contagem muda (read-only, sem animação cronometrada).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div className="codex-history">
      <div className="codex-history-source" role="note">
        <span className="codex-source-dot" aria-hidden="true" />
        Codex local · somente leitura
      </div>

      <div ref={scrollRef} className="codex-history-scroll">
        {status === 'loading' && <div className="chat-messages-empty muted">carregando thread do Codex…</div>}
        {status === 'error' && <div className="chat-messages-empty muted">não consegui ler o estado local do Codex.</div>}
        {status === 'empty' && <div className="chat-messages-empty muted">sem conversa visível na última thread.</div>}

        {status === 'ready' && (
          <div className="codex-history-list">
            {messages.map((m) => (
              <div key={m.id} className={`codex-bubble codex-bubble-${m.role}`}>
                <span className="codex-bubble-role">{m.role === 'user' ? 'Rica' : 'Tara'}</span>
                <p className="codex-bubble-text">{m.text}</p>
              </div>
            ))}
            {hiddenCount > 0 && (
              <div className="codex-hidden-note muted">
                {hiddenCount} {hiddenCount === 1 ? 'item interno oculto' : 'itens internos ocultos'} (sistema/raciocínio/ferramentas)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
