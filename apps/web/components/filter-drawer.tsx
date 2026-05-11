'use client';

import { useEffect, useRef } from 'react';
import { COCKPIT_FILTERS } from '../lib/cockpit-filters';

type FilterDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FilterDrawer({ open, onOpenChange }: FilterDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
      return;
    }

    if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      id="filter-drawer"
      ref={dialogRef}
      aria-labelledby="filter-drawer-title"
      className="fixed inset-0 z-[120] m-0 h-full max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-black/50"
      onClose={() => {
        onOpenChange(false);
      }}
    >
      <div className="flex h-full justify-end">
        <section className="fb-drawer-panel">
          <div className="fb-drawer-surface mb-4 flex items-center justify-between border-b pb-3">
            <h2 id="filter-drawer-title" className="text-[12px] font-semibold uppercase tracking-[0.2em]">Filtros</h2>
            <button
              type="button"
              aria-label="Fechar filtros"
              className="fb-drawer-surface inline-flex h-9 w-9 items-center justify-center border text-xl leading-none"
              style={{ color: 'var(--accent)' }}
              onClick={() => onOpenChange(false)}
            >
              ×
            </button>
          </div>

          <div className="fb-drawer-surface flex flex-col border-t">
            {COCKPIT_FILTERS.map((filter) => (
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
            className="fb-drawer-surface mt-4 min-h-11 w-full border px-4 text-[10px] uppercase tracking-[0.14em] opacity-35 disabled:cursor-not-allowed"
            type="button"
            disabled
            aria-label="Limpar filtros"
            style={{ color: 'var(--muted)' }}
          >
            LIMPAR ✕
          </button>
        </section>
      </div>
    </dialog>
  );
}
