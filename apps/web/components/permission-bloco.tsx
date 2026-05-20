'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PainelPermission, PainelPermissionMode } from '../lib/cockpit-types';
import { patchAgentPermissionMode, postAgentClear } from '../lib/api';

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

const CLEAR_LONG_PRESS_MS = 2000;
const CLEAR_FIRED_FLASH_MS = 320;
const CLEAR_COOLDOWN_MS = 5000;

export function PermissionBloco({ data, slug, onChange }: PermissionBlocoProps) {
  const [saving, setSaving] = useState<PainelPermissionMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeMode: ToggleMode | null =
    data.mode === 'bypassPermissions' || data.mode === 'plan' ? data.mode : null;

  // Long-press do /clear — destrutivo, exige 2s de pressão. Padrão alinhado
  // com o send button do chat-panel (POST /destrava). Cooldown evita disparo
  // duplicado se o press tremeu.
  const [clearPressing, setClearPressing] = useState(false);
  const [clearFired, setClearFired] = useState(false);
  const [clearSending, setClearSending] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearFiredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCooldownUntilRef = useRef(0);

  const cancelClearLongPress = useCallback(() => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setClearPressing(false);
  }, []);

  useEffect(() => () => {
    cancelClearLongPress();
    if (clearFiredTimerRef.current) clearTimeout(clearFiredTimerRef.current);
  }, [cancelClearLongPress]);

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

  const startClearLongPress = useCallback(() => {
    if (clearSending) return;
    if (Date.now() < clearCooldownUntilRef.current) return;
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    setError(null);
    setClearPressing(true);
    clearTimerRef.current = setTimeout(() => {
      clearTimerRef.current = null;
      setClearPressing(false);
      setClearFired(true);
      if (clearFiredTimerRef.current) clearTimeout(clearFiredTimerRef.current);
      clearFiredTimerRef.current = setTimeout(() => {
        clearFiredTimerRef.current = null;
        setClearFired(false);
      }, CLEAR_FIRED_FLASH_MS);
      clearCooldownUntilRef.current = Date.now() + CLEAR_COOLDOWN_MS;
      setClearSending(true);
      void postAgentClear(slug)
        .then(() => {
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try { navigator.vibrate(40); } catch { /* iOS pode bloquear */ }
          }
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'falha no /clear');
        })
        .finally(() => {
          setClearSending(false);
        });
    }, CLEAR_LONG_PRESS_MS);
  }, [slug, clearSending]);

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
        <button
          type="button"
          className="painel-permission-chip painel-permission-clear"
          data-long-pressing={clearPressing || undefined}
          data-long-press-fired={clearFired || undefined}
          aria-label="Limpar contexto da sessão (segure 2s)"
          title="segure 2s pra mandar /clear no CC"
          disabled={clearSending}
          onPointerDown={(e) => {
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* iOS pode falhar */ }
            startClearLongPress();
          }}
          onPointerUp={cancelClearLongPress}
          onPointerCancel={cancelClearLongPress}
          onPointerLeave={cancelClearLongPress}
        >
          {clearSending ? 'limpando' : 'clear'}
        </button>
      </div>

      {error && (
        <div className="painel-inline-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
