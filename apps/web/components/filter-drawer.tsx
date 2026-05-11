'use client';

import { useEffect, useRef, useState } from 'react';

type FilterDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const filters = [
  { key: 'STATUS', value: 'all', label: 'Status filter: all' },
  { key: 'MDL', value: 'all', label: 'Model filter: all' },
  { key: 'CLI', value: 'all', label: 'CLI filter: all' },
  { key: 'WIN', value: '24h', label: 'Window: 24h' },
];

export function FilterDrawer({ open, onOpenChange }: FilterDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
      requestAnimationFrame(() => setPanelOpen(true));
      return;
    }

    setPanelOpen(false);
    if (dialog.open) {
      closeTimerRef.current = setTimeout(() => dialog.close(), 180);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  return (
    <dialog
      id="filter-drawer"
      ref={dialogRef}
      aria-labelledby="filter-drawer-title"
      className="fixed inset-0 z-[120] m-0 h-full max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-black/50"
      onClose={() => {
        setPanelOpen(false);
        onOpenChange(false);
      }}
    >
      <div className="flex h-full justify-end">
        <section
          aria-label="Mobile filters"
          className={`h-full w-80 max-w-[85vw] border-l p-4 transition-transform duration-200 ease-out ${
            panelOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
          style={{
            background: 'var(--bg)',
            borderColor: 'var(--border)',
            color: 'var(--text)',
          }}
        >
          <div
            className="mb-4 flex items-center justify-between border-b pb-3"
            style={{ borderColor: 'var(--border)' }}
          >
            <h2 id="filter-drawer-title" className="text-[12px] font-semibold uppercase tracking-[0.2em]">Filtros</h2>
            <button
              type="button"
              aria-label="Close filters"
              className="inline-flex h-9 w-9 items-center justify-center border text-xl leading-none"
              style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
              onClick={() => onOpenChange(false)}
            >
              ×
            </button>
          </div>

          <div className="flex flex-col border-t" style={{ borderColor: 'var(--border)' }}>
            {filters.map((filter) => (
              <button
                key={filter.key}
                className="fb-drop min-h-11 w-full justify-between border-b border-r-0 px-4"
                type="button"
                aria-haspopup="listbox"
                aria-expanded="false"
                aria-label={filter.label}
              >
                <span className="dk">{filter.key}</span>
                <span className="dv">{filter.value}</span>
                <span className="caret">▾</span>
              </button>
            ))}
          </div>

          <button
            className="mt-4 min-h-11 w-full border px-4 text-[10px] uppercase tracking-[0.14em] opacity-35"
            type="button"
            disabled
            aria-label="Clear filters"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          >
            RESET ✕
          </button>
        </section>
      </div>
    </dialog>
  );
}
