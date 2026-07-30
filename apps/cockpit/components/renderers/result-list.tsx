'use client';

// Corpo de lista (G3 da matriz, 5 famílias, 199 ocorrências — WebSearch é a
// variante quente com 171 tool + 165 result). Um corpo, três variantes de
// linha: link, caminho, objeto nomeado. Recebe o `tool_use_result` CRU por
// props; se não for lista, renderiza nada e o chamador cai pro genérico.
//
// Sem cor fora de token: var(--ck-*) ou nada.

import { useMemo } from 'react';

import { normalizarListaResultado, type ItemDaLista } from './result-list';

function Linha({ item }: { item: ItemDaLista }) {
  switch (item.tipo) {
    case 'link':
      return (
        <a
          className="ck-link block min-w-0 truncate text-[13px]"
          href={item.url}
          target="_blank"
          rel="noreferrer"
          title={item.titulo}
        >
          {item.titulo}
        </a>
      );
    case 'caminho':
      return (
        <span className="block min-w-0 truncate font-mono text-[13px] text-[var(--ck-text-primary)]">
          {item.caminho}
        </span>
      );
    case 'objeto':
      return (
        <span className="flex min-w-0 items-baseline gap-[var(--ck-space-2)] text-[13px]">
          <span className="min-w-0 truncate text-[var(--ck-text-primary)]">{item.nome}</span>
          {item.detalhe ? (
            <span className="min-w-0 flex-1 truncate font-mono text-[var(--ck-text-tertiary)]">
              {item.detalhe}
            </span>
          ) : null}
        </span>
      );
    case 'texto':
      return (
        <span className="block min-w-0 truncate text-[13px] text-[var(--ck-text-secondary)]">
          {item.texto}
        </span>
      );
  }
}

export function ResultList({ valor }: { valor: unknown }) {
  const dados = useMemo(() => normalizarListaResultado(valor), [valor]);
  if (!dados || dados.itens.length === 0) return null;

  return (
    <section className="max-w-full overflow-hidden rounded-[var(--ck-radius-frame)] border border-[var(--ck-edge-hairline)] bg-[var(--ck-surface-raised)]">
      {dados.titulo ? (
        <header className="flex min-h-[44px] min-w-0 items-center gap-[var(--ck-space-2)] border-b border-[var(--ck-edge-hairline)] px-[var(--ck-space-3)]">
          <span className="min-w-0 flex-1 truncate font-sans text-[13px] text-[var(--ck-text-secondary)]">
            {dados.titulo}
          </span>
          {typeof dados.total === 'number' ? (
            <span className="ck-tabular shrink-0 font-mono text-[13px] text-[var(--ck-text-tertiary)]">
              {dados.total} {dados.total === 1 ? 'item' : 'itens'}
            </span>
          ) : null}
        </header>
      ) : null}
      <ul className="flex min-w-0 flex-col gap-[var(--ck-space-2)] p-[var(--ck-space-3)]">
        {dados.itens.map((item, indice) => (
          <li key={indice} className="min-w-0">
            <Linha item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}
