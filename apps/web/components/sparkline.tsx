'use client';

import { useMemo, useState } from 'react';
import type { SparklineBucket } from '../lib/cockpit-types';

/**
 * Sparkline 24h com leitura — DS-7 + DS-58 polish.
 *
 * DS-58: altura agora é SUM(tokens) da hora (input+output do payload do agente),
 * não count de events. Tooltip mostra ambos (tokens + msgs). Eixo X ganha label
 * por coluna (intercalado a cada 2h em desktop, 4h em mobile via CSS).
 *
 * Wrapper escolhe variant; hooks ficam dentro de SparklineFull (evita hook
 * condicional após early-return).
 */
export function Sparkline(props: {
  buckets: SparklineBucket[];
  label?: string;
  variant?: 'full' | 'pulse';
}) {
  if (props.variant === 'pulse') return <SparklinePulse buckets={props.buckets} />;
  return <SparklineFull buckets={props.buckets} label={props.label} />;
}

function SparklineFull({
  buckets,
  label = 'SPARKLINE · 24H',
}: {
  buckets: SparklineBucket[];
  label?: string;
}) {
  const { max, mean, peakIdx, total, nonZero } = useMemo(() => {
    const values = buckets.map((b) => b.tokens);
    const total = values.reduce((a, b) => a + b, 0);
    const max = Math.max(0, ...values);
    const nonZero = values.filter((v) => v > 0).length;
    const mean = buckets.length > 0 ? total / buckets.length : 0;
    let peakIdx = -1;
    for (let i = 0; i < values.length; i++) {
      if (values[i]! > 0 && (peakIdx === -1 || values[i]! > values[peakIdx]!)) peakIdx = i;
    }
    return { max, mean, peakIdx, total, nonZero };
  }, [buckets]);

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (buckets.length === 0) {
    return (
      <div className="sparkline" aria-label="Sem dados de atividade">
        <span className="missao-key">{label}</span>
        <span className="muted">— sem dados —</span>
      </div>
    );
  }

  const SVG_H = 80;
  const SVG_W = 600;
  const BAR_GAP = 2;
  const barWidth = (SVG_W - BAR_GAP * (buckets.length - 1)) / buckets.length;
  const plotTop = 10;
  const plotBottom = SVG_H - 16; // espaço pro eixo X
  const plotH = plotBottom - plotTop;
  const scale = max > 0 ? plotH / max : 0;
  const meanY = plotBottom - mean * scale;

  const peakBucket = peakIdx >= 0 ? buckets[peakIdx] : null;
  const peakHour = peakBucket ? formatHour(peakBucket.bucket) : null;
  const peakTokens = peakBucket ? peakBucket.tokens : 0;
  const meanPerHour = Math.round(mean);

  const hoverBucket = hoverIdx !== null ? buckets[hoverIdx]! : null;

  return (
    <div className="sparkline sparkline-v2" aria-label="Tokens das últimas 24 horas">
      <div className="sparkline-head">
        <span className="missao-key">{label}</span>
        <span className="sparkline-summary">
          <span className="sparkline-stat">
            <span className="ss-k">pico</span>
            <span className="ss-v">
              {peakBucket ? `${formatCount(peakTokens)} @ ${peakHour}` : '—'}
            </span>
          </span>
          <span className="sparkline-sep">·</span>
          <span className="sparkline-stat">
            <span className="ss-k">média</span>
            <span className="ss-v">{nonZero > 0 ? `${formatCount(meanPerHour)}/h` : '0/h'}</span>
          </span>
          <span className="sparkline-sep">·</span>
          <span className="sparkline-stat">
            <span className="ss-k">total</span>
            <span className="ss-v">{formatCount(total)}</span>
          </span>
        </span>
      </div>
      <div className="sparkline-plot">
        <div className="sparkline-axis-y" aria-hidden="true">
          <span className="sa-max">{formatCount(max)}</span>
          <span className="sa-min">0</span>
        </div>
        <svg
          className="sparkline-svg"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`24 horas em tokens, pico ${peakTokens} em ${peakHour ?? '—'}, média ${meanPerHour} tokens/h`}
        >
          {/* eixo X (linha base) */}
          <line
            x1={0}
            y1={plotBottom}
            x2={SVG_W}
            y2={plotBottom}
            className="sl-axis"
          />
          {/* linha de média */}
          {mean > 0 && (
            <line
              x1={0}
              y1={meanY}
              x2={SVG_W}
              y2={meanY}
              className="sl-mean"
              strokeDasharray="4 3"
            />
          )}
          {/* barras */}
          {buckets.map((b, i) => {
            const x = i * (barWidth + BAR_GAP);
            const tokens = b.tokens;
            const h = tokens > 0 ? Math.max(2, tokens * scale) : 0;
            const y = plotBottom - h;
            const isPeak = i === peakIdx;
            const isHover = i === hoverIdx;
            return (
              <g key={b.bucket}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={h}
                  className="sl-bar"
                  data-zero={tokens === 0 ? 'true' : 'false'}
                  data-peak={isPeak ? 'true' : 'false'}
                  data-hover={isHover ? 'true' : 'false'}
                >
                  <title>{`${formatHour(b.bucket)}: ${formatCount(tokens)} tokens · ${b.count} msg${b.count === 1 ? '' : 's'}`}</title>
                </rect>
                {/* hit area maior pra hover confiável em barras finas */}
                <rect
                  x={x - BAR_GAP / 2}
                  y={plotTop}
                  width={barWidth + BAR_GAP}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
                />
                {isPeak && (
                  <circle cx={x + barWidth / 2} cy={y - 4} r={2.2} className="sl-peak-marker" />
                )}
              </g>
            );
          })}
        </svg>
        {hoverBucket && (
          <div
            className="sparkline-tooltip mono"
            style={{
              left: `${((hoverIdx! + 0.5) / buckets.length) * 100}%`,
            }}
            role="tooltip"
          >
            <span className="sl-tt-hour">{formatHour(hoverBucket.bucket)}</span>
            <span className="sl-tt-count">
              {formatCount(hoverBucket.tokens)} tok · {hoverBucket.count} msg{hoverBucket.count === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>
      {/* DS-58: 1 span por barra; CSS decide quais labels mostrar via nth-child
          (a cada 2h em desktop, a cada 4h em mobile). Texto nunca é truncado
          no .tsx — render contínuo, visibilidade governada pela media query. */}
      <div className="sparkline-axis-x sparkline-axis-x-dense" aria-hidden="true">
        {buckets.map((b) => (
          <span key={b.bucket}>{formatHour(b.bucket)}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * Variant "pulse" — minimalista, sem pico/média/eixo. Renderiza só as barras
 * em ~30px de altura. Usada no topo da aba CHAT pra dar "pulso" do agente
 * sem competir com o preview do pane.
 */
function SparklinePulse({ buckets }: { buckets: SparklineBucket[] }) {
  if (buckets.length === 0) return null;
  const values = buckets.map((b) => b.tokens);
  const max = Math.max(0, ...values);
  return (
    <div className="sparkline-pulse" aria-label="Tokens 24h">
      <div className="sparkline-pulse-bars" role="img" aria-hidden="true">
        {buckets.map((b) => {
          const tokens = b.tokens;
          const h = max > 0 ? Math.max(2, Math.round((tokens / max) * 100)) : 2;
          return (
            <span
              key={b.bucket}
              className="splp-bar"
              data-zero={tokens === 0 ? 'true' : 'false'}
              style={{ height: `${h}%` }}
              title={`${formatHour(b.bucket)}: ${formatCount(tokens)} tokens · ${b.count} msg${b.count === 1 ? '' : 's'}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

function formatHour(bucket: string): string {
  // bucket vem como "YYYY-MM-DDTHH:00:00" ou similar; pega hora com fallback
  const m = bucket.match(/T(\d{2}):/);
  if (m) return `${m[1]}h`;
  // ISO sem T (`YYYY-MM-DD HH:00`)
  const m2 = bucket.match(/\b(\d{2}):\d{2}/);
  return m2 ? `${m2[1]}h` : bucket.slice(-5);
}
