'use client';

import { useMemo, useState } from 'react';
import type { SparklineBucket } from '../lib/cockpit-types';

/**
 * Sparkline 24h com leitura — DS-7.
 *
 * Adiciona ao gráfico cru:
 *  · pico (count + hora) no header
 *  · média/h no header
 *  · eixo Y compacto (max + 0)
 *  · linha tracejada da média
 *  · hover por barra → tooltip flutuante com hora + valor
 */
export function Sparkline({
  buckets,
  label = 'SPARKLINE · 24H',
  variant = 'full',
}: {
  buckets: SparklineBucket[];
  label?: string;
  variant?: 'full' | 'pulse';
}) {
  if (variant === 'pulse') return <SparklinePulse buckets={buckets} />;
  const { max, mean, peakIdx, total, nonZero } = useMemo(() => {
    const counts = buckets.map((b) => b.count);
    const total = counts.reduce((a, b) => a + b, 0);
    const max = Math.max(0, ...counts);
    const nonZero = counts.filter((c) => c > 0).length;
    const mean = buckets.length > 0 ? total / buckets.length : 0;
    let peakIdx = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i]! > 0 && (peakIdx === -1 || counts[i]! > counts[peakIdx]!)) peakIdx = i;
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
  const peakCount = peakBucket ? peakBucket.count : 0;
  const meanPerHour = Math.round(mean);

  const hoverBucket = hoverIdx !== null ? buckets[hoverIdx]! : null;

  return (
    <div className="sparkline sparkline-v2" aria-label="Eventos das últimas 24 horas">
      <div className="sparkline-head">
        <span className="missao-key">{label}</span>
        <span className="sparkline-summary">
          <span className="sparkline-stat">
            <span className="ss-k">pico</span>
            <span className="ss-v">
              {peakBucket ? `${formatCount(peakCount)} @ ${peakHour}` : '—'}
            </span>
          </span>
          <span className="sparkline-sep">·</span>
          <span className="sparkline-stat">
            <span className="ss-k">média</span>
            <span className="ss-v">{nonZero > 0 ? `${meanPerHour}/h` : '0/h'}</span>
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
          aria-label={`24 horas, pico ${peakCount} em ${peakHour ?? '—'}, média ${meanPerHour} por hora`}
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
            const h = b.count > 0 ? Math.max(2, b.count * scale) : 0;
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
                  data-zero={b.count === 0 ? 'true' : 'false'}
                  data-peak={isPeak ? 'true' : 'false'}
                  data-hover={isHover ? 'true' : 'false'}
                >
                  <title>{`${formatHour(b.bucket)}: ${b.count} evento${b.count === 1 ? '' : 's'}`}</title>
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
              {hoverBucket.count} evento{hoverBucket.count === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>
      <div className="sparkline-axis-x" aria-hidden="true">
        <span>{formatHour(buckets[0]!.bucket)}</span>
        {buckets.length > 8 && (
          <span>{formatHour(buckets[Math.floor(buckets.length / 2)]!.bucket)}</span>
        )}
        <span>{formatHour(buckets[buckets.length - 1]!.bucket)}</span>
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
  const counts = buckets.map((b) => b.count);
  const max = Math.max(0, ...counts);
  return (
    <div className="sparkline-pulse" aria-label="Atividade 24h">
      <div className="sparkline-pulse-bars" role="img" aria-hidden="true">
        {buckets.map((b) => {
          const h = max > 0 ? Math.max(2, Math.round((b.count / max) * 100)) : 2;
          return (
            <span
              key={b.bucket}
              className="splp-bar"
              data-zero={b.count === 0 ? 'true' : 'false'}
              style={{ height: `${h}%` }}
              title={`${formatHour(b.bucket)}: ${b.count} evento${b.count === 1 ? '' : 's'}`}
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
