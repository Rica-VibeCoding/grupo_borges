'use client';

// Corpo de página publicada (G8 da matriz, 3 tool + 3 result — a família mais
// rara). Card com título, link externo e versão. Recebe o `tool_use_result`
// CRU por props; se não for da família, renderiza nada e o chamador cai pro
// corpo genérico.
//
// SEM Badge: revisão do Hiro em aberto (30/07) sobre possível violação de
// --ck-text-tertiary no Badge do G4 — aviso do Pavan no dispatch, evita até
// fechar. Por cautela o próprio token fica de fora daqui também: a régua dele
// ("NUNCA corpo: só ícone, separador, texto ≥20px", globals.css) já descarta
// usá-lo no texto pequeno que este card mostra.
//
// Sem cor fora de token: var(--ck-*) ou nada.

import { useMemo } from 'react';

// Extensão `.ts` explícita: sem ela, a resolução do bare specifier ficava
// ambígua com este próprio arquivo (mesmo nome, .tsx) e o build quebrava —
// mesma cautela que o corpo-do-item.tsx já usa pra importar daqui de fora.
import { normalizarPaginaPublicada } from './published-page.ts';

export function PublishedPage({ valor }: { valor: unknown }) {
  const dados = useMemo(() => normalizarPaginaPublicada(valor), [valor]);
  if (!dados) return null;

  return (
    <section className="max-w-full overflow-hidden rounded-[var(--ck-radius-frame)] border border-[var(--ck-edge-hairline)] bg-[var(--ck-surface-raised)]">
      <header className="flex min-h-[44px] min-w-0 items-center gap-[var(--ck-space-3)] border-b border-[var(--ck-edge-hairline)] px-[var(--ck-space-3)]">
        <span className="min-w-0 flex-1 truncate font-sans text-sm font-medium text-[var(--ck-text-primary)]">
          {dados.titulo}
        </span>
        <span className="shrink-0 font-mono text-sm text-[var(--ck-text-secondary)]">
          {dados.atualizado ? 'atualizado' : 'publicado'} · v{dados.versao}
        </span>
      </header>
      <div className="max-w-full overflow-x-auto p-[var(--ck-space-3)]">
        <a
          className="ck-link block min-w-0 truncate font-mono text-sm"
          href={dados.url}
          target="_blank"
          rel="noreferrer"
        >
          {dados.url}
        </a>
        {dados.caminho ? (
          <p className="mt-[var(--ck-space-1)] min-w-0 truncate font-mono text-[12px] text-[var(--ck-text-secondary)]">
            {dados.caminho}
          </p>
        ) : null}
      </div>
    </section>
  );
}
