export function SseBanner() {
  return (
    <div className="sse-banner" id="sseBanner" role="status" aria-live="polite" aria-label="SSE connection status">
      <div className="sb-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1={12} y1={9} x2={12} y2={13} />
          <line x1={12} y1={17} x2="12.01" y2={17} />
        </svg>
      </div>
      <div className="sb-msg">
        <span className="strong">SSE DESCONECTADO</span>
        <span className="em">// tentando reconectar</span>
        <span className="attempt" id="sseAttempt">tentativa 03 / ∞</span>
      </div>
      <div className="sep" />
      <div className="sb-stat"><span>last ping</span><span className="v warn" id="ssePing">-2m14s</span></div>
      <div className="sep" />
      <div className="sb-stat"><span>backoff</span><span className="v" id="sseBackoff">4.0s</span></div>
      <div className="spacer" />
      <span className="sb-ts" id="sseTs">14:22:01 -03:00</span>
      <button type="button" className="sb-retry" id="sseRetry" aria-label="Reconnect SSE now">[ REINTENTAR ]</button>
    </div>
  );
}
