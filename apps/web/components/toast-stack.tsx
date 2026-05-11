'use client';

import { useToast } from '../lib/toast-context';
import { formatTimeMs as formatTime } from '../lib/format-time';

export function ToastStack() {
  const { toasts, dismiss } = useToast();

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast"
          data-kind={t.kind}
          role="status"
          onClick={() => dismiss(t.id)}
        >
          <span className="tdot" aria-hidden="true" />
          <div className="tmsg">
            <div>{t.msg}</div>
            {t.sub ? <div className="tsub">{t.sub}</div> : null}
          </div>
          <span className="ttime">{formatTime(t.createdAt)}</span>
          <button
            type="button"
            className="tx"
            aria-label="Dispensar aviso"
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
