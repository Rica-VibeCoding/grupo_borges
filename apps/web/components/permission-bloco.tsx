'use client';

import { useState } from 'react';
import type { PainelPermission, PainelPermissionMode } from '../lib/cockpit-types';
import { patchAgentPermissionMode } from '../lib/api';

type PermissionBlocoProps = {
  data: PainelPermission;
  slug: string;
  onChange: () => void;
};

type ToggleMode = 'bypassPermissions' | 'plan';

const TOGGLES: Array<{ mode: ToggleMode; label: string }> = [
  { mode: 'bypassPermissions', label: 'bypass' },
  { mode: 'plan', label: 'plan' },
];

export function PermissionBloco({ data, slug, onChange }: PermissionBlocoProps) {
  const [saving, setSaving] = useState<PainelPermissionMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeMode: ToggleMode | null =
    data.mode === 'bypassPermissions' || data.mode === 'plan' ? data.mode : null;

  async function handleToggle(mode: ToggleMode) {
    if (saving !== null) return;
    const nextMode: PainelPermissionMode = activeMode === mode ? 'ask' : mode;
    setSaving(nextMode);
    setError(null);
    try {
      await patchAgentPermissionMode(slug, nextMode);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro ao salvar permissão');
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="painel-bloco" aria-label="Permissão">
      <div className="painel-bloco-head">
        <div className="painel-bloco-title">Permissão</div>
        {data.session_may_diverge && (
          <span
            className="painel-help"
            title="Settings global; pode divergir da sessão atual"
            aria-label="Settings global; pode divergir da sessão atual"
          >
            ?
          </span>
        )}
      </div>

      <div className="painel-permission-row" role="group" aria-label="Modo de permissão">
        {TOGGLES.map(({ mode, label }) => {
          const isActive = activeMode === mode;
          const isSaving = saving === mode || (saving === 'ask' && isActive);
          return (
            <button
              key={mode}
              type="button"
              className="painel-permission-chip"
              data-active={isActive ? '1' : '0'}
              disabled={saving !== null}
              onClick={() => {
                void handleToggle(mode);
              }}
            >
              {isSaving ? 'salvando' : label}
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
