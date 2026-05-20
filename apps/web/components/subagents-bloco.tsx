import type { PainelSubagentEntry, PainelSubagents } from '../lib/cockpit-types';
import { clampPct, formatCwdShort, formatElapsedShort } from '../lib/painel-format';

type SubagentsBlocoProps = {
  data: PainelSubagents;
};

function severity(pct: number | null): 'ok' | 'warn' | 'crit' | 'unknown' {
  if (pct === null || !Number.isFinite(pct)) return 'unknown';
  if (pct >= 80) return 'crit';
  if (pct >= 50) return 'warn';
  return 'ok';
}

function SubagentCard({ entry, nowSeconds }: { entry: PainelSubagentEntry; nowSeconds: number }) {
  const state = entry.state ?? 'idle';
  const isWorking = state === 'working';
  const sev = severity(entry.context_pct);
  const pctValue = entry.context_pct === null ? null : clampPct(entry.context_pct);
  const pctLabel = pctValue === null ? '—' : `${Math.round(pctValue)}%`;
  const name = entry.name ?? entry.sessionId?.slice(0, 8) ?? 'subagent';
  const elapsedLabel = entry.started_at === null ? '—' : formatElapsedShort(nowSeconds - entry.started_at);
  const repo = entry.cwd ? formatCwdShort(entry.cwd) : null;
  const model = entry.model ?? null;

  return (
    <div className="painel-subagent-card" data-state={state} data-severity={sev}>
      <div className="painel-subagent-row-top">
        {isWorking ? (
          <span className="subagent-status-icon" data-tone="active" aria-label="working" />
        ) : (
          <span className="painel-subagent-state-dot" data-state={state} aria-hidden="true" />
        )}
        <span className="painel-subagent-name" title={name}>{name}</span>
        {repo && <span className="painel-subagent-repo" title={entry.cwd ?? ''}>{repo}</span>}
      </div>
      <div className="painel-subagent-row-bottom">
        {model && <span className="painel-subagent-model" title={model}>{model}</span>}
        <div className="painel-subagent-bar" role="progressbar" aria-valuenow={pctValue ?? 0} aria-valuemin={0} aria-valuemax={100}>
          <div
            className="painel-subagent-bar-fill"
            data-severity={sev}
            style={{ width: pctValue === null ? '0%' : `${pctValue}%` }}
          />
        </div>
        <span className="painel-subagent-pct" data-severity={sev}>{pctLabel}</span>
        <span className="painel-subagent-elapsed">{elapsedLabel}</span>
      </div>
    </div>
  );
}

export function SubagentsBloco({ data }: SubagentsBlocoProps) {
  const items = Array.isArray(data.items) ? data.items : [];
  const overflow = Math.max(0, data.active_count - items.length);
  const nowSeconds = Math.floor(Date.now() / 1000);

  return (
    <section className="painel-bloco" aria-label="Subagents">
      <div className="painel-bloco-head">
        <div className="painel-bloco-title">Subagents</div>
        <div className="painel-chip-row">
          <span className="painel-chip">{data.active_count}</span>
          {overflow > 0 && <span className="painel-chip painel-chip-warn">+{overflow}</span>}
        </div>
      </div>
      <div className="painel-subagents-row">
        {items.length === 0 ? (
          <div className="painel-empty">Nenhum subagent ativo nos últimos 15 min</div>
        ) : (
          items.map((entry, idx) => (
            <SubagentCard
              key={entry.id ?? entry.sessionId ?? `${entry.name ?? 'subagent'}-${idx}`}
              entry={entry}
              nowSeconds={nowSeconds}
            />
          ))
        )}
      </div>
    </section>
  );
}
