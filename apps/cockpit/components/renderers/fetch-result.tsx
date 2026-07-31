'use client';

// Corpo de resultado do WebFetch (G6 da matriz, 255 tool + 245 result).
// Cabeçalho com status HTTP + tamanho + tempo, corpo em markdown — a forma que
// a matriz pede, alimentada pelo `tool_use_result` rico que o pipeline ainda
// não entrega (pré-requisito em docs/cockpit-v2-plano-tool-use-result.md).
//
// Recebe o payload CRU: se não for um fetch, renderiza nada e o chamador cai
// pro corpo genérico. Sem cor fora de token: var(--ck-*) ou nada.

import { useMemo, useState } from 'react';

import { AssistantMarkdown } from './markdown';
// Extensão `.ts` explícita: sem ela, a resolução do bare specifier ficava
// ambígua com este próprio arquivo (mesmo nome, .tsx) e o build quebrava —
// mesma cautela que o corpo-do-item.tsx já usa pra importar daqui de fora.
import {
  formatoBytes,
  formatoDuracao,
  normalizarFetchResult,
  tomDoStatus,
} from './fetch-result.ts';

/** Mesmo teto do `Saida` da linha de execução: página inteira aberta de uma
 *  vez no celular é rolagem dentro de rolagem. */
const LINHAS_DE_PRIMEIRA = 120;

const TOM_COR = {
  ok: 'var(--ck-state-ok)',
  neutro: 'var(--ck-text-secondary)',
  erro: 'var(--ck-state-fail)',
} as const;

export function FetchResult({ valor }: { valor: unknown }) {
  const dados = useMemo(() => normalizarFetchResult(valor), [valor]);
  const [tudo, setTudo] = useState(false);

  const { visivel, excedente } = useMemo(() => {
    if (!dados) return { visivel: '', excedente: 0 };
    const linhas = dados.corpo.split('\n');
    const resto = linhas.length - LINHAS_DE_PRIMEIRA;
    return {
      visivel: resto > 0 && !tudo ? linhas.slice(0, LINHAS_DE_PRIMEIRA).join('\n') : dados.corpo,
      excedente: resto > 0 ? resto : 0,
    };
  }, [dados, tudo]);

  if (!dados) return null;

  const tom = tomDoStatus(dados.codigo);

  return (
    <section className="max-w-full overflow-hidden rounded-[var(--ck-radius-frame)] border border-[var(--ck-edge-hairline)] bg-[var(--ck-surface-raised)]">
      <header className="flex min-h-[44px] min-w-0 items-center gap-[var(--ck-space-3)] border-b border-[var(--ck-edge-hairline)] px-[var(--ck-space-3)]">
        <span
          className="shrink-0 font-mono text-[13px] font-medium"
          style={{ color: TOM_COR[tom] }}
        >
          {dados.codigo}
          {dados.textoDoCodigo ? ` ${dados.textoDoCodigo}` : ''}
        </span>
        <span className="shrink-0 font-mono text-[13px] text-[var(--ck-text-secondary)]">
          {formatoBytes(dados.bytes)} · {formatoDuracao(dados.duracaoMs)}
        </span>
        <a
          className="ck-link min-w-0 flex-1 truncate font-mono text-[13px]"
          href={dados.url}
          target="_blank"
          rel="noreferrer"
        >
          {dados.url}
        </a>
      </header>
      <div className="max-w-full overflow-x-auto p-[var(--ck-space-3)]">
        <AssistantMarkdown>{visivel}</AssistantMarkdown>
        {excedente > 0 ? (
          <button
            type="button"
            className="ck-veil mt-[var(--ck-space-2)] min-h-[44px] rounded-[var(--ck-radius-chip)] px-[var(--ck-space-3)] font-sans text-[13px] text-[var(--ck-text-secondary)]"
            onClick={() => setTudo((v) => !v)}
          >
            {tudo ? 'recolher' : `ver tudo (+${excedente} linhas)`}
          </button>
        ) : null}
      </div>
    </section>
  );
}
