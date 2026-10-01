'use client';

/** Filtro e busca do Histórico (F9), tirados do painel para ele caber no teto. */
import { IconeBusca } from '../shell/icones';
import type { FiltroDeConversa } from './conversas';

export function Filtros({ filtro, escolhe, comPendencia }: { filtro: FiltroDeConversa; escolhe: (f: FiltroDeConversa) => void; comPendencia: boolean }) {
  const itens: { id: FiltroDeConversa; nome: string }[] = [
    { id: 'todas', nome: 'Todas' },
    { id: 'estrela', nome: 'Especiais' },
    ...(comPendencia ? [{ id: 'pendencia' as const, nome: '⚠︎ Pendentes' }] : []),
  ];
  return (
    <div role="radiogroup" aria-label="Filtro" className="ck-gv-segmento flex shrink-0" style={{ padding: '3px', borderRadius: 'var(--ck-radius-pill)' }}>
      {itens.map((f) => (
        <button
          key={f.id}
          type="button"
          role="radio"
          aria-checked={filtro === f.id}
          onClick={() => escolhe(f.id)}
          className="ck-gv-segmento-opcao flex flex-auto items-center justify-center"
          style={{ minHeight: '36px', padding: '0 var(--ck-space-3)', borderRadius: 'var(--ck-radius-pill)', fontSize: 'var(--ck-text-sm)', fontWeight: 500 }}
        >
          {f.nome}
        </button>
      ))}
    </div>
  );
}

export function Busca({ valor, muda }: { valor: string; muda: (v: string) => void }) {
  return (
    <label className="flex shrink-0 items-center" style={{ gap: 'var(--ck-space-2)', minHeight: 'var(--ck-touch-min)', padding: '0 var(--ck-space-4)', borderRadius: 'var(--ck-radius-pill)', background: 'var(--ck-gv-bloco)', color: 'var(--ck-text-secondary)' }}>
      <IconeBusca tamanho={15} />
      <input
        type="search"
        value={valor}
        onChange={(e) => muda(e.target.value)}
        placeholder="Buscar no título ou na nota"
        aria-label="Buscar no título ou na nota"
        className="min-w-0 flex-1 bg-transparent outline-none"
        style={{ fontSize: 'var(--ck-text-md)', color: 'var(--ck-text-primary)' }}
      />
    </label>
  );
}
