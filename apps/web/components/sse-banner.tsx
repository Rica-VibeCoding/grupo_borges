'use client';

import { useEffect, useRef, useState } from 'react';
import { useFleet } from '../lib/fleet-context';

function formatClock(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} -03:00`;
}

function formatBackoff(retryCount: number): string {
  const seconds = Math.min(2 ** Math.max(0, retryCount - 1), 60);
  return `${seconds.toFixed(1)}s`;
}

export function SseBanner() {
  const { sseStatus, fleet } = useFleet();
  const offline = sseStatus === 'closed';
  const [retryCount, setRetryCount] = useState(0);
  const lastSeenSyncRef = useRef<number | null>(null);

  useEffect(() => {
    if (offline) {
      const id = setInterval(() => setRetryCount((c) => c + 1), 4000);
      return () => clearInterval(id);
    }
    setRetryCount(0);
    return undefined;
  }, [offline]);

  useEffect(() => {
    if (sseStatus === 'open') lastSeenSyncRef.current = fleet.health.server_now;
  }, [sseStatus, fleet.health.server_now]);

  const pingDelta = (() => {
    const last = lastSeenSyncRef.current;
    if (last === null) return '—';
    const delta = Math.max(0, fleet.health.server_now - last);
    const m = Math.floor(delta / 60);
    const s = delta % 60;
    return m > 0 ? `-${m}m${String(s).padStart(2, '0')}s` : `-${s}s`;
  })();

  return (
    <div
      className="sse-banner"
      data-on={offline ? 'true' : 'false'}
      role="status"
      aria-label="Status da conexão SSE"
    >
      <div className="sb-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1={12} y1={9} x2={12} y2={13} />
          <line x1={12} y1={17} x2="12.01" y2={17} />
        </svg>
      </div>
      <div className="sb-msg" aria-live="polite">
        <span className="strong">SSE DESCONECTADO</span>
        <span className="em">// tentando reconectar</span>
        <span className="attempt" aria-hidden="true">tentativa {String(retryCount).padStart(2, '0')} / ∞</span>
      </div>
      <div className="sep" />
      <div className="sb-stat" aria-hidden="true"><span>último ping</span><span className="v warn">{pingDelta}</span></div>
      <div className="sep" />
      <div className="sb-stat" aria-hidden="true"><span>backoff</span><span className="v">{formatBackoff(retryCount)}</span></div>
      <div className="spacer" />
      <span className="sb-ts" aria-hidden="true">{formatClock(fleet.health.server_now)}</span>
      {/* TODO(etapa-5b/6): expor reconnect() no useFleetStream e remover reload */}
      <button
        type="button"
        className="sb-retry"
        aria-label="Reconectar SSE agora"
        onClick={() => window.location.reload()}
      >
        [ REINTENTAR ]
      </button>
    </div>
  );
}
