import type { PainelQuotaWindow, PainelQuotas } from '../lib/cockpit-types';

type QuotasBlocoProps = {
  data: PainelQuotas;
};

function clampPct(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatReset(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'reset pendente';
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `reset em ${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `reset em ${m}m${String(s).padStart(2, '0')}s`;
  return `reset em ${s}s`;
}

function QuotaRow({ label, window }: { label: string; window: PainelQuotaWindow | null | undefined }) {
  const pct = clampPct(window?.used_pct);

  return (
    <div className="painel-quota-row">
      <div className="painel-quota-meta">
        <span>{label}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="painel-progress" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <span className="painel-progress-fill quota" style={{ width: `${pct}%` }} />
      </div>
      <div className="painel-quota-reset">{formatReset(window?.remaining_seconds)}</div>
      {window?.raw && Object.keys(window.raw).length > 0 && (
        <details className="painel-raw">
          <summary>raw</summary>
          <pre>{JSON.stringify(window.raw, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export function QuotasBloco({ data }: QuotasBlocoProps) {
  if (data.status === 'unknown' || data.status === 'missing') {
    return (
      <section className="painel-bloco painel-bloco-muted" aria-label="Quotas">
        <div className="painel-empty">Quotas Max indisponíveis (statusline não enviou dados)</div>
      </section>
    );
  }

  return (
    <section className="painel-bloco" aria-label="Quotas">
      <div className="painel-bloco-head">
        <div className="painel-bloco-title">Quotas</div>
        {data.status === 'stale' && <span className="painel-chip painel-chip-warn">dados antigos</span>}
      </div>
      <div className="painel-quota-list">
        <QuotaRow label="5h" window={data.five_hour} />
        <QuotaRow label="7d" window={data.seven_day} />
      </div>
    </section>
  );
}
