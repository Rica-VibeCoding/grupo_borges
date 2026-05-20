import type { PainelContexto } from '../lib/cockpit-types';
import { clampPct, formatCompactNumber } from '../lib/painel-format';

type ContextoBlocoProps = {
  data: PainelContexto;
};

export function ContextoBloco({ data }: ContextoBlocoProps) {
  if (!data.available) {
    return (
      <section className="painel-bloco painel-bloco-muted" aria-label="Contexto">
        <div className="painel-empty">sem dados de contexto ainda</div>
      </section>
    );
  }

  const currentUsage = data.tokens;
  const total =
    currentUsage.total ||
    currentUsage.input + currentUsage.output + currentUsage.cache_creation + currentUsage.cache_read;
  const pct = clampPct(data.pct ?? 0);
  const segmentTotal = Math.max(total, 1);
  const segments = [
    { key: 'input', label: 'input', value: currentUsage.input, className: 'input' },
    { key: 'output', label: 'output', value: currentUsage.output, className: 'output' },
    { key: 'cache_creation', label: 'cache creation', value: currentUsage.cache_creation, className: 'cache-create' },
    { key: 'cache_read', label: 'cache read', value: currentUsage.cache_read, className: 'cache-read' },
  ];

  return (
    <section className="painel-bloco" aria-label="Contexto">
      <div className="painel-bloco-head">
        <div className="painel-bloco-title">Contexto</div>
        <div className="painel-chip-row">
          {data.model_family && <span className="painel-chip">{data.model_family}</span>}
          <span className="painel-chip">{formatCompactNumber(data.context_window ?? 0)}</span>
        </div>
      </div>

      <div className="painel-context-summary">
        <span>{formatCompactNumber(total)} tokens</span>
        <span>{Math.round(pct)}%</span>
      </div>

      <div
        className="painel-progress painel-progress-stacked"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`painel-progress-segment ${segment.className}`}
            style={{ width: `${(segment.value / segmentTotal) * pct}%` }}
            title={`${segment.label}: ${formatCompactNumber(segment.value)}`}
          />
        ))}
      </div>

      <dl className="painel-breakdown">
        {segments.map((segment) => (
          <div key={segment.key}>
            <dt>{segment.label}</dt>
            <dd>{formatCompactNumber(segment.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
