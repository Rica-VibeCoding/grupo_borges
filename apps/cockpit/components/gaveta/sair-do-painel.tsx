'use client';

/**
 * O SAIR do painel do cliente — o pé da gaveta, discreto de propósito: é o
 * gesto mais raro da tela e não pode disputar o dedo com o interruptor nem com
 * as Conversas. Só existe em modo cliente (`PECAS.sessaoDoPortao`).
 *
 * `POST /auth/logout` revoga a sessão no portão e apaga o cookie. Só depois do
 * 200 a tela vai para `/entrar`: indo antes, com o cookie ainda vivo, o
 * `/entrar` devolveria o cliente direto ao chat e o Sair pareceria não fazer
 * nada.
 */
import { useState } from 'react';

export function SairDoPainel({ usuario }: { usuario: string | null }) {
  const [fase, setFase] = useState<'ocioso' | 'saindo' | 'falhou'>('ocioso');

  async function sair() {
    if (fase === 'saindo') return;
    setFase('saindo');
    try {
      const resposta = await fetch('/auth/logout', { method: 'POST' });
      if (!resposta.ok) throw new Error(String(resposta.status));
      window.location.assign('/entrar');
    } catch {
      setFase('falhou');
    }
  }

  return (
    <div
      className="flex shrink-0 items-center justify-between"
      style={{ gap: 'var(--ck-space-3)', padding: '0 var(--ck-space-1) 0 var(--ck-space-3)' }}
    >
      <span
        role={fase === 'falhou' ? 'alert' : undefined}
        className="min-w-0 truncate"
        style={{
          fontSize: 'var(--ck-text-xs)',
          color: fase === 'falhou' ? 'var(--ck-state-attention)' : 'var(--ck-text-secondary)',
        }}
      >
        {fase === 'falhou' ? 'Não consegui sair. Tente de novo.' : usuario ? `Entrou como ${usuario}` : null}
      </span>
      <button
        type="button"
        onClick={() => void sair()}
        aria-busy={fase === 'saindo'}
        className="ck-veil flex shrink-0 items-center justify-center rounded-full"
        style={{
          minHeight: 'var(--ck-touch-min)',
          padding: '0 var(--ck-space-4)',
          fontSize: 'var(--ck-text-sm)',
          color: 'var(--ck-text-secondary)',
        }}
      >
        {fase === 'saindo' ? 'Saindo…' : 'Sair'}
      </button>
    </div>
  );
}
