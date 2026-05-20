import type { PainelContexto } from '../lib/cockpit-types';

type ContextoBlocoProps = {
  data: PainelContexto;
};

function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function clampPct(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function ContextoBloco({ data }: ContextoBlocoProps) {
  if (!data.available) {
    return (
      <section className="painel-bloco painel-bloco-muted" aria-label="Contexto">
        <div className="painel-empty">sem dados de contexto ainda</div>
      </section>
    );
  }

  const tokens = data.tokens;
  const total = tokens.total || tokens.input + tokens.output + tokens.cache_creation + tokens.cache_read;
  const pct = clampPct(data.pct);
  const segmentTotal = Math.max(total, 1);
  const segments = [
    { key: 'input', label: 'input', value: tokens.input, className: 'input' },
    { key: 'output', label: 'output', value: tokens.output, className: 'output' },
    { key: 'cache_creation', label: 'cache creation', value: tokens.cache_creation, className: 'cache-create' },
    { key: 'cache_read', label: 'cache read', value: tokens.cache_read, className: 'cache-read' },
  ];

  return (
    <section className="painel-bloco" aria-label="Contexto">
      <div className="painel-bloco-head">
        <div className="painel-bloco-title">Contexto</div>
        <div className="painel-chip-row">
          {data.model_family && <span className="painel-chip">{data.model_family}</span>}
          <span className="painel-chip">{formatCompactNumber(data.context_window)}</span>
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
