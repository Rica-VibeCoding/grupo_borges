'use client';

import type { Agent } from '../lib/cockpit-types';
import { formatDuration, parseContextPct, parseModelFromPane, shortModelName } from '../lib/cockpit-types';

/**
 * Statusline compacta reutilizável (model · time · ctx%).
 *
 * Variant "card" — bloco do `agent-card.tsx` extraído ipsis literis (DS-2 sub A).
 *   Mesma marcação, mesmas classes CSS (`pane pane-session`, `ps-*`); ANSI/parse
 *   continuam vindo do `parseContextPct` / `parseModelFromPane` / Codex direto.
 *
 * Variant "modal" — placeholder; Daniel desenha versão expandida em DS-2 sub D
 * (ctx%, model, time, status, executor_kind, last_event delta).
 */
// TODO: variant="modal" expandida — Daniel
export function AgentStatusline({
  agent,
  serverNow,
  variant = 'card',
}: {
  agent: Agent;
  serverNow: number;
  variant?: 'card' | 'modal';
}) {
  const model = agent.state_model ?? agent.model_default;
  const isCodexExecutor = agent.executor_kind === 'codex';
  // sessionStarted: Codex usa session_started_at (do evento); CC usa pane_session_started_at
  // pra refletir /clear (zera o transcript). instances[0].started_at é uptime do tmux,
  // que não muda no /clear — só como fallback quando o pane não tem statusline parseável.
  const sessionStarted = isCodexExecutor
    ? (agent.session_started_at ?? agent.instances[0]?.started_at ?? null)
    : (agent.pane_session_started_at ?? agent.instances[0]?.started_at ?? null);
  const sessionSecs = sessionStarted !== null ? Math.max(0, serverNow - sessionStarted) : null;
  // contextPct: Codex recebe campo direto do backend; CC faz parse do pane_excerpt
  const contextPct = isCodexExecutor
    ? (agent.context_pct ?? null)
    : parseContextPct(agent.pane_excerpt);
  // paneModel: CC extrai do statusline do pane; Codex usa null (cai no shortModelName(model))
  const paneModel = isCodexExecutor ? null : parseModelFromPane(agent.pane_excerpt);

  if (variant === 'modal') {
    // TODO: variant="modal" expandida — Daniel (DS-2 sub D)
    // Placeholder: por enquanto renderiza o mesmo conteúdo da variant "card"
    // pra não quebrar consumidores que já passem variant="modal".
  }

  return (
    <div className="pane pane-session" aria-hidden="true">
      <span className="ps-model">{paneModel ?? shortModelName(model)}</span>
      <span className="ps-sep">·</span>
      <span className="ps-time">{sessionSecs !== null ? formatDuration(sessionSecs) : '—'}</span>
      <span className="ps-sep">·</span>
      <span className="ps-ctx">
        {contextPct !== null ? (
          <>
            <span className="ps-bar" aria-hidden="true">
              {Array.from({ length: 10 }, (_, i) => (
                <span
                  key={i}
                  className="psb-cell"
                  data-on={i < Math.round(contextPct / 10) ? '1' : '0'}
                />
              ))}
            </span>
            {' '}{contextPct}%
          </>
        ) : '— %'}
      </span>
    </div>
  );
}
