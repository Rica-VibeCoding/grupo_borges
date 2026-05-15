'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import type { Agent } from '../lib/cockpit-types';
import {
  AgentInputError,
  postAgentInput,
  postAgentModel,
  toShortModelSlug,
  type ChatModelSlug,
} from '../lib/api';
import { useFleet } from '../lib/fleet-context';
import { useIsMobile } from '../lib/use-is-mobile';
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

// Linhas compostas exclusivamente por caracteres de box-drawing/heavy/light
// (─ ━ ═ │ ┃ ╭ ╮ ╰ ╯ ╱ ╳ etc.) viram ruído visual no preview — o CC desenha
// containers ASCII que, em fonte mono, lêem como barras horizontais fantasmas
// entre blocos de conteúdo. Comprimir essas linhas em vazias preserva a
// estrutura semântica do excerpt sem poluir.
const BOX_DRAWING_LINE = /^[\s─-╿▀-▟]+$/u;

// Chrome do próprio Claude Code que vaza no fim do excerpt (statusline,
// bypass-permissions, Remote Control). Filtragem só aqui no display — o
// `agent.pane_excerpt` cru continua intacto pros parsers (parseContextPct,
// parseModelFromPane) extraírem ctx%/modelo/tempo da statusline.
const CC_CHROME_LINE = new RegExp(
  [
    String.raw`^(?:Opus|Sonnet|Haiku)\s+\d+\.\d+.*?\[.*?\]\s+\d+%\s*$`,
    String.raw`^Remote Control active.*$`,
    String.raw`^▶▶?\s+bypass permissions.*$`,
    String.raw`^>+\s*$`,
  ].join('|'),
);

function stripChrome(src: string): string {
  if (!src) return src;
  return src
    .split('\n')
    .map((line) => (BOX_DRAWING_LINE.test(line) || CC_CHROME_LINE.test(line) ? '' : line))
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

function ChatInput({
  slug,
  agentName,
  onFocusChange,
}: {
  slug: string;
  agentName: string;
  onFocusChange?: (focused: boolean) => void;
}) {
  const { fire } = useToast();
  const isMobile = useIsMobile();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const placeholder = isMobile
    ? `Mensagem pro ${agentName}…`
    : `mensagem pro ${agentName} (⌘+Enter envia)`;

  // Auto-grow: começa em 1 linha, cresce até max ~6 linhas (240px) com scroll.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const onSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const res = await postAgentInput(slug, trimmed);
      if (res.tmux_delivered) {
        setText('');
        fire({ kind: 'success', msg: `enviado pro ${agentName}` });
      } else {
        fire({ kind: 'warn', msg: 'envio não confirmado', sub: 'pane fora do CLI esperado' });
      }
    } catch (err) {
      const detail = err instanceof AgentInputError ? err.detail : null;
      if (err instanceof AgentInputError && err.status === 409 && detail === 'agent_pane_unavailable') {
        fire({
          kind: 'warn',
          msg: 'agente fora do CLI esperado',
          sub: 'verifique se ele tá no Claude/Codex e não em shell auxiliar',
          ttlMs: 6000,
        });
      } else {
        fire({ kind: 'warn', msg: 'falha ao enviar', sub: detail ?? String(err) });
      }
    } finally {
      setSending(false);
    }
  }, [agentName, fire, sending, slug, text]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // ⌘+Enter (Mac) / Ctrl+Enter (Linux/Win) envia. Enter sozinho quebra linha.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void onSubmit();
      }
    },
    [onSubmit],
  );

  return (
    <form
      className="chat-input"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <button
        type="button"
        className="chat-icon-btn"
        disabled
        aria-label="Anexar imagem (em breve)"
        title="anexar imagem — em breve (DS-54)"
      >
        <span aria-hidden="true">📷</span>
      </button>
      <textarea
        ref={textareaRef}
        className="chat-input-textarea mono"
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        placeholder={placeholder}
        rows={1}
        maxLength={8192}
        aria-label={`Mensagem pro agente ${agentName}`}
      />
      <button
        type="button"
        className="chat-icon-btn"
        disabled
        aria-label="Mensagem de voz (em breve)"
        title="mensagem de voz — em breve (DS-54)"
      >
        <span aria-hidden="true">🎤</span>
      </button>
      <button
        type="submit"
        className="chat-input-send"
        disabled={sending || text.trim().length === 0}
        aria-label={sending ? 'Enviando…' : 'Enviar mensagem'}
        title={sending ? 'enviando…' : 'enviar (⌘+Enter)'}
      >
        {sending ? '…' : '→'}
      </button>
    </form>
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
