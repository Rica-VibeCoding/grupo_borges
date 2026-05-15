'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import type { Agent } from '../lib/cockpit-types';
import {
  AgentInputError,
  postAgentModel,
  toShortModelSlug,
  type ChatModelSlug,
} from '../lib/api';
import { useFleet } from '../lib/fleet-context';
import { useToast } from '../lib/toast-context';
import { useAgentSend } from '../lib/use-agent-send';
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

function ChatInput({
  slug,
  agentName,
  onFocusChange,
}: {
  slug: string;
  agentName: string;
  onFocusChange?: (focused: boolean) => void;
}) {
  const { sending, sendText } = useAgentSend(slug, agentName);
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow: começa em 1 linha (42px box-border), cresce até ~6 linhas
  // (134px) com scroll. Cap bate com max-height do CSS pra evitar pixel
  // off-by-one que reabre scrollbar quando a 6ª linha completa.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 134)}px`;
  }, [text]);

  const onSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    await sendText(trimmed);
    setText('');
  }, [sending, sendText, text]);

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
        title={`anexar imagem pro ${agentName} — em breve (DS-54)`}
      >
        <PaperclipIcon />
      </button>
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
        aria-label={`Mensagem pro agente ${agentName}`}
      />
      <button
        type="button"
        className="chat-icon-btn"
        disabled
        aria-label="Mensagem de voz (em breve)"
        title="mensagem de voz — em breve (DS-54)"
      >
        <MicIcon />
      </button>
      <button
        type="submit"
        className="chat-input-send"
        disabled={sending || text.trim().length === 0}
        aria-label={sending ? 'Enviando…' : 'Enviar mensagem'}
        title={sending ? 'enviando…' : 'enviar (⌘+Enter)'}
      >
        {sending ? <span aria-hidden="true">…</span> : <ArrowUpIcon />}
      </button>
    </form>
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
