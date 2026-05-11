'use client';

import { useState } from 'react';
import { FilterDrawer } from './filter-drawer';

export function FilterBar() {
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  return (
    <div className="filterbar mono" role="search">
      <div className="fb-label" aria-hidden="true"><span className="num">02</span><span>FILTRO</span></div>
      <div className="fb-search">
        <input id="fbSearch" type="text" placeholder="buscar agente · slug · tarefa · caminho" autoComplete="off" aria-label="Buscar agentes e tarefas" suppressHydrationWarning />
        <span className="kbd" aria-hidden="true">/</span>
      </div>
      <button
        className="fb-mobile-trigger border-l px-3 text-[10px] uppercase tracking-[0.14em] sm:hidden"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={filterDrawerOpen}
        aria-controls="filter-drawer"
        onClick={() => setFilterDrawerOpen(true)}
        style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
      >
        FILTROS
      </button>
      <FilterDrawer open={filterDrawerOpen} onOpenChange={setFilterDrawerOpen} />
      <div className="fb-drops">
        <button className="fb-drop" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Filtro de status: todos"><span className="dk">STATUS</span><span className="dv">todos</span><span className="caret">▾</span></button>
        <button className="fb-drop" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Filtro de modelo: todos"><span className="dk">MDL</span><span className="dv">todos</span><span className="caret">▾</span></button>
        <button className="fb-drop" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Filtro de CLI: todos"><span className="dk">CLI</span><span className="dv">todos</span><span className="caret">▾</span></button>
        <button className="fb-drop" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Janela: 24h"><span className="dk">WIN</span><span className="dv">24h</span><span className="caret">▾</span></button>
      </div>
      <button className="fb-clear" type="button" disabled aria-label="Limpar filtros">LIMPAR ✕</button>
    </div>
  );
}
