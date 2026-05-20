'use client';

import { useState } from 'react';
import type { PainelEffort } from '../lib/cockpit-types';
import { patchAgentEffort } from '../lib/api';

type EffortBlocoProps = {
  data: PainelEffort;
  slug: string;
  onChange?: (value: string) => void;
};

export function EffortBloco({ data, slug, onChange }: EffortBlocoProps) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = data.value ?? 'unset';

  async function handleChange(value: string) {
    if (saving || value === data.value) return;
    setSaving(value);
    setError(null);
    try {
      await patchAgentEffort(slug, value);
      onChange?.(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro ao salvar effort');
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="painel-bloco" aria-label="Effort">
      <div className="painel-bloco-head">
        <div className="painel-bloco-title">Effort</div>
        <div className="painel-effort-head">
          <span className="painel-effort-current">{current}</span>
          {data.session_may_diverge && (
            <span
              className="painel-help"
              title="Settings global; pode divergir de /effort de sessão"
              aria-label="Settings global; pode divergir de /effort de sessão"
            >
              ?
            </span>
          )}
        </div>
      </div>

      <div className="painel-segmented" role="group" aria-label="Selecionar effort">
        {data.allowed.map((value) => {
          const isActive = value === data.value;
          const isSaving = saving === value;
          return (
            <button
              key={value}
              type="button"
              className="painel-segmented-button"
              data-active={isActive ? '1' : '0'}
              disabled={saving !== null}
              onClick={() => {
                void handleChange(value);
              }}
            >
              {isSaving ? 'salvando' : value}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="painel-inline-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
