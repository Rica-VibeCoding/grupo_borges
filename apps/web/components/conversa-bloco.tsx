'use client';

import { useState } from 'react';
import { patchAgentCodexNewThread } from '../lib/api';

type ConversaBlocoProps = {
  slug: string;
  armed: boolean;
  onChange?: () => void;
};

// Bloco "Conversa" do painel Codex — comando "nova conversa" (no lugar do /clear
// do CC). Arma um flag persistido (codex_next_fresh); o próximo turno da Tara
// começa thread fresh e o backend zera o flag.
export function ConversaBloco({ slug, armed, onChange }: ConversaBlocoProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await patchAgentCodexNewThread(slug, !armed);
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro ao armar nova conversa');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="painel-bloco" aria-label="Conversa">
      <div className="painel-bloco-head">
        <div className="painel-bloco-title">Conversa</div>
        {armed && <span className="painel-effort-current">nova armada</span>}
      </div>

      <div className="painel-segmented" role="group" aria-label="Nova conversa">
        <button
          type="button"
          className="painel-segmented-button"
          data-active={armed ? '1' : '0'}
          disabled={saving}
          onClick={() => void toggle()}
          title="próxima mensagem começa uma thread nova (sem retomar a atual)"
        >
          {saving ? 'salvando' : armed ? 'desarmar nova conversa' : 'nova conversa'}
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
