'use client';

/**
 * Filtro e busca do Histórico (F9; rodada 2). Os filtros são *Todas*, ⭐ e
 * *Concluídas*; a ⭐ é só o ícone, para *Concluídas* caber sem apertar. O fundo
 * do escolhido é UM elemento que desliza entre eles (`layoutId`), não três
 * fundos que acendem e apagam.
 */
import { motion } from 'motion/react';

import { IconeBusca, IconeEstrela } from '../shell/icones';
import type { FiltroDeConversa } from './conversas';
import { CALMA } from './ritmo-do-historico';

const ITENS: { id: FiltroDeConversa; rotulo: string }[] = [
  { id: 'todas', rotulo: 'Todas' },
  { id: 'estrela', rotulo: 'Especiais' },
  { id: 'concluidas', rotulo: 'Concluídas' },
];

export function Filtros({ filtro, escolhe }: { filtro: FiltroDeConversa; escolhe: (f: FiltroDeConversa) => void }) {
  return (
    <div role="radiogroup" aria-label="Filtro" data-desliza className="ck-gv-segmento flex shrink-0" style={{ padding: '3px', borderRadius: 'var(--ck-radius-pill)' }}>
      {ITENS.map((f) => (
        <button
          key={f.id}
          type="button"
          role="radio"
          aria-checked={filtro === f.id}
          aria-label={f.rotulo}
          onClick={() => escolhe(f.id)}
          className="ck-gv-segmento-opcao relative flex items-center justify-center"
          style={{ flex: f.id === 'estrela' ? '0 0 64px' : '1 1 0', minHeight: '38px', borderRadius: 'var(--ck-radius-pill)', fontSize: 'var(--ck-text-sm)', fontWeight: 500 }}
        >
          {filtro === f.id ? (
            <motion.span
              aria-hidden
              layoutId="historico-filtro"
              layoutDependency={filtro}
              transition={CALMA}
              style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', background: 'var(--ck-gv-pilula)' }}
            />
          ) : null}
          <span className="relative flex items-center">{f.id === 'estrela' ? <IconeEstrela tamanho={16} /> : f.rotulo}</span>
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
        placeholder="Buscar"
        aria-label="Buscar no título ou na nota"
        className="min-w-0 flex-1 bg-transparent outline-none"
        style={{ fontSize: 'var(--ck-text-md)', color: 'var(--ck-text-primary)' }}
      />
    </label>
  );
}
