import type { PainelQuotaWindow, PainelQuotas } from '../lib/cockpit-types';
import { clampPct, formatRemainingShort } from '../lib/painel-format';

type QuotasBlocoProps = {
  data: PainelQuotas;
};

function QuotaRow({ label, window }: { label: string; window: PainelQuotaWindow | null | undefined }) {
  if (!window) {
    return (
      <div className="painel-quota-row">
        <span className="painel-quota-label">{label}</span>
        <span className="painel-quota-reset">sem dados</span>
      </div>
    );
  }

  const pct = clampPct(window.used_percentage ?? 0);
  const resetLabel =
    window.remaining_seconds === null || window.remaining_seconds === undefined
      ? 'reset pendente'
      : `reset em ${formatRemainingShort(window.remaining_seconds)}`;

  return (
    <div className="painel-quota-row">
      <span className="painel-quota-label">{label}</span>
      <div className="painel-quota-bar">
        <div
          className="painel-progress"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <span className="painel-progress-fill quota" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className="painel-quota-pct">{Math.round(pct)}%</span>
      <span className="painel-quota-reset">· {resetLabel}</span>
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
