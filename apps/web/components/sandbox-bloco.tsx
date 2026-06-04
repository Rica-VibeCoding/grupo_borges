'use client';

import { useState } from 'react';
import type { PainelSandbox, PainelCodexSandbox } from '../lib/cockpit-types';
import { patchAgentCodexSandbox } from '../lib/api';

type SandboxBlocoProps = {
  data: PainelSandbox;
  slug: string;
  onChange?: (value: PainelCodexSandbox) => void;
};

// Rótulos curtos pros 3 sandboxes do Codex. danger-full-access é o default da
// Tara — mostrado como "full" pra não ocupar a linha inteira.
const LABELS: Record<PainelCodexSandbox, string> = {
  'read-only': 'leitura',
  'workspace-write': 'workspace',
  'danger-full-access': 'full',
};

export function SandboxBloco({ data, slug, onChange }: SandboxBlocoProps) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = data.value ?? 'unset';

  async function handleChange(value: PainelCodexSandbox) {
    if (saving || value === data.value) return;
    setSaving(value);
    setError(null);
    try {
      await patchAgentCodexSandbox(slug, value);
      onChange?.(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro ao salvar sandbox');
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="painel-bloco" aria-label="Sandbox">
      <div className="painel-bloco-head">
        <div className="painel-bloco-title">Sandbox</div>
        <div className="painel-effort-head">
          <span className="painel-effort-current">{LABELS[current as PainelCodexSandbox] ?? current}</span>
        </div>
      </div>

      <div className="painel-segmented" role="group" aria-label="Selecionar sandbox">
        {data.allowed.map((raw) => {
          const value = raw as PainelCodexSandbox;
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
              {isSaving ? 'salvando' : LABELS[value] ?? value}
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
