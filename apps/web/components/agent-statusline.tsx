'use client';

import type { Agent, AgentStatus } from '../lib/cockpit-types';
import {
  formatDuration,
  formatLastSeen,
  parseContextPct,
  parseModelFromPane,
  shortModelName,
} from '../lib/cockpit-types';

const STATUS_LABEL: Record<AgentStatus, string> = {
  ocioso: 'Ocioso',
  trabalhando: 'Trabalhando',
  aguardando: 'Aguardando',
  offline: 'Offline',
};

// Gradiente verde→amarelo→vermelho conforme ocupação de contexto.
// Usado nas células da ps-bar pra dar leitura imediata de risco.
function ctxTier(pct: number): 'low' | 'mid' | 'high' {
  if (pct < 50) return 'low';
  if (pct < 80) return 'mid';
  return 'high';
}

/**
 * Statusline compacta reutilizável (model · time · ctx%).
 *
 * Variant "card" — bloco do `agent-card.tsx` extraído ipsis literis (DS-2 sub A).
 *   Mesma marcação, mesmas classes CSS (`pane pane-session`, `ps-*`); ANSI/parse
 *   continuam vindo do `parseContextPct` / `parseModelFromPane` / Codex direto.
 *
 * Variant "modal" — expandida (DS-2 sub D): chips horizontais com status,
 *   executor_kind, model, time, ctx%, visto-em-rel. Usada na aba CHAT do
 *   AgentModal pra dar contexto vivo do agente sem ocupar a vertical.
 */
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
  const sessionStarted = isCodexExecutor
    ? (agent.session_started_at ?? agent.instances[0]?.started_at ?? null)
    : (agent.pane_session_started_at ?? agent.instances[0]?.started_at ?? null);
  const sessionSecs = sessionStarted !== null ? Math.max(0, serverNow - sessionStarted) : null;
  const contextPct = isCodexExecutor
    ? (agent.context_pct ?? null)
    : parseContextPct(agent.pane_excerpt);
  const paneModel = isCodexExecutor ? null : parseModelFromPane(agent.pane_excerpt);
  const modelLabel = paneModel ?? shortModelName(model);

  if (variant === 'modal') {
    // Dedupe: status chip mora no top-right do header do AgentModal (`.status-bar`);
    // model mora no <ModelSelector> da aba CHAT. Aqui não duplicamos — só info
    // adicional que o header/selector não mostram (executor, ctx, session, visto).
    return (
      <div className="pane-modal mono" role="group" aria-label="Statusline do agente">
        <span className="pm-chip pm-kind" title={`executor: ${agent.executor_kind ?? 'claude_code'}`}>
          {isCodexExecutor ? 'CODEX' : 'CC'}
        </span>
        <span className="pm-chip">
          <span className="pm-k">ctx</span>
          {contextPct !== null ? (
            <span className="pm-ctx">
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
              <span className="pm-v"> {contextPct}%</span>
            </span>
          ) : (
            <span className="pm-v">— %</span>
          )}
        </span>
        <span className="pm-chip">
          <span className="pm-k">session</span>
          <span className="pm-v">{sessionSecs !== null ? formatDuration(sessionSecs) : '—'}</span>
        </span>
        <span
          className="pm-chip pm-seen"
          title={agent.last_seen ? new Date(agent.last_seen * 1000).toISOString() : '—'}
        >
          <span className="pm-k">visto</span>
          <span className="pm-v">{formatLastSeen(agent.last_seen, serverNow)}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="pane pane-session" aria-hidden="true">
      <span className="ps-model">{modelLabel}</span>
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
