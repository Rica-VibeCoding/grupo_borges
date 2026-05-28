'use client';

import type { ReactNode } from 'react';
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

// Família do modelo pra colorir o label (CSS lê via data-model). Casa por
// substring case-insensitive — funciona tanto pra "Opus 4.7" quanto pro
// slug bruto "claude-opus-4-7".
function modelFamilyOf(label: string, raw: string, isCodex: boolean): string {
  if (isCodex) return 'codex';
  const s = `${label} ${raw}`.toLowerCase();
  if (s.includes('opus')) return 'opus';
  if (s.includes('sonnet')) return 'sonnet';
  if (s.includes('haiku')) return 'haiku';
  if (s.includes('gpt')) return 'codex';
  return 'other';
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
  extra,
}: {
  agent: Agent;
  serverNow: number;
  variant?: 'card' | 'modal' | 'inline';
  extra?: ReactNode;
}) {
  const model = agent.state_model ?? agent.model_default;
  const isCodexExecutor = agent.executor_kind === 'codex';
  const sessionStarted = isCodexExecutor
    ? agent.session_started_at
    : agent.pane_session_started_at;
  const sessionSecs = sessionStarted !== null ? Math.max(0, serverNow - sessionStarted) : null;
  const contextPct = isCodexExecutor
    ? (agent.context_pct ?? null)
    : parseContextPct(agent.pane_excerpt);
  // Modelo REAL da sessão = pane_excerpt (tmux capture), alinhado com o %.
  // state_model é a última intenção persistida (POST /model) — pode estar
  // pendente de propagação no CC. Card reflete execução, não a seleção.
  const paneModel = isCodexExecutor ? null : parseModelFromPane(agent.pane_excerpt);
  const modelLabel = paneModel ?? shortModelName(model);
  const modelFamily = modelFamilyOf(modelLabel, model, isCodexExecutor);

  const barCells = variant === 'inline' ? 6 : 10;

  if (variant === 'inline') {
    // Compacta pro card-strip: wrapper .pane preto + barra fluida (estilo painel).
    const sev = contextPct === null ? 'unknown' : contextPct < 50 ? 'ok' : contextPct < 80 ? 'warn' : 'crit';
    return (
      <div className="pane pane-session pane-session-inline" aria-hidden="true">
        <span className="ps-model" data-model={modelFamily}>{modelLabel}</span>
        <span className="ps-sep">·</span>
        <span className="ps-time">{sessionSecs !== null ? formatDuration(sessionSecs, false) : '—'}</span>
        <span className="ps-sep">·</span>
        <span className="ps-ctx">
          {contextPct !== null ? (
            <>
              <span className="psi-bar" aria-hidden="true">
                <span className="psi-bar-fill" data-severity={sev} style={{ width: `${contextPct}%` }} />
              </span>
              <span className="psi-pct">{contextPct}%</span>
            </>
          ) : <span className="psi-pct">— %</span>}
        </span>
      </div>
    );
  }

  if (variant === 'modal') {
    // 1-linha (DS-2 polish): tokens separados por `·` em vez de chips empilhados.
    // Modelo entra como slot `extra` (chip clickable do ModelSelector inline);
    // status já mora no header `.status-bar`, executor_kind no `title`.
    const sessionLabel = sessionSecs !== null ? formatDuration(sessionSecs) : '—';
    const seenLabel = formatLastSeen(agent.last_seen, serverNow);
    const seenTitle = agent.last_seen ? new Date(agent.last_seen * 1000).toISOString() : '—';
    return (
      <div
        className="pm-line mono"
        role="group"
        aria-label="Statusline do agente"
        title={`executor: ${agent.executor_kind ?? 'claude_code'}`}
      >
        {extra && <span className="pm-slot">{extra}</span>}
        {extra && <span className="pm-sep" aria-hidden="true">·</span>}
        <span className="pm-tok pm-tok-ctx">
          {contextPct !== null ? (
            <>
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
              <span className="pm-v">{contextPct}%</span>
            </>
          ) : (
            <span className="pm-v pm-dim">ctx —</span>
          )}
        </span>
        <span className="pm-sep" aria-hidden="true">·</span>
        <span className="pm-tok" title="duração da sessão">
          <span className="pm-v">{sessionLabel}</span>
        </span>
        <span className="pm-sep" aria-hidden="true">·</span>
        <span className="pm-tok pm-dim" title={seenTitle}>
          visto {seenLabel.replace(/^há /, '')}
        </span>
      </div>
    );
  }

  return (
    <div className="pane pane-session" aria-hidden="true">
      <span className="ps-model" data-model={modelFamily}>{modelLabel}</span>
      <span className="ps-sep">·</span>
      <span className="ps-time">{sessionSecs !== null ? formatDuration(sessionSecs) : '—'}</span>
      <span className="ps-sep">·</span>
      <span className="ps-ctx">
        {contextPct !== null ? (
          <>
            <span className="ps-bar" aria-hidden="true">
              {Array.from({ length: barCells }, (_, i) => (
                <span
                  key={i}
                  className="psb-cell"
                  data-on={i < Math.round((contextPct * barCells) / 100) ? '1' : '0'}
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
