'use client';

// Corpo de conteúdo de arquivo (G5 da matriz, 83 tool + 85 result). Cabeçalho
// com caminho + nº de linhas, corpo no `code-block.tsx` — o substrato já
// existe (auditoria-tema-30-07.md), essa é só a forma que faltava. Recebe o
// `tool_use_result` CRU por props; se não for da família, renderiza nada e o
// chamador cai pro corpo genérico.
//
// CodeBlock não tem seção/borda própria (ordem do Rica, 30/07 — sem caixa
// isolada dentro do fluxo). A borda aqui é UMA só, do card G5 inteiro, no
// mesmo padrão de fetch-result.tsx/agent-result.tsx. Conteúdo cru, não
// markdown: passar por AssistantMarkdown interpretaria `#`/`*`/`_` do próprio
// arquivo como formatação — texto teria que ser verbatim.
//
// Sem cor fora de token: var(--ck-*) ou nada.

import { useMemo, useState } from 'react';

import { CodeBlock } from './code-block';
// Extensão `.ts` explícita: sem ela, a resolução do bare specifier ficava
// ambígua com este próprio arquivo (mesmo nome, .tsx) e o build quebrava —
// mesma cautela que o corpo-do-item.tsx já usa pra importar daqui de fora.
import { normalizarConteudoDeArquivo } from './file-content.ts';

/** Mesmo teto do `Saida` da linha de execução: página inteira aberta de uma
 *  vez no celular é rolagem dentro de rolagem. */
const LINHAS_DE_PRIMEIRA = 120;

export function FileContent({ valor }: { valor: unknown }) {
  const dados = useMemo(() => normalizarConteudoDeArquivo(valor), [valor]);
  // Chave pelo caminho, não boolean solto: o feed é virtualizado e a mesma
  // instância do componente pode ser reaproveitada pra um item diferente
  // conforme rola — um boolean vazaria "expandido" de um arquivo pro outro.
  const [expandidoPara, setExpandidoPara] = useState<string | null>(null);
  const tudo = dados !== null && expandidoPara === dados.caminho;

  const { visivel, excedente } = useMemo(() => {
    if (!dados || dados.binario) return { visivel: '', excedente: 0 };
    const linhas = dados.conteudo.split('\n');
    const resto = linhas.length - LINHAS_DE_PRIMEIRA;
    return {
      visivel: resto > 0 && !tudo ? linhas.slice(0, LINHAS_DE_PRIMEIRA).join('\n') : dados.conteudo,
      excedente: resto > 0 ? resto : 0,
    };
  }, [dados, tudo]);

  if (!dados) return null;

  return (
    <section className="max-w-full overflow-hidden rounded-[var(--ck-radius-frame)] border border-[var(--ck-edge-hairline)] bg-[var(--ck-surface-raised)]">
      <header className="flex min-h-[44px] min-w-0 items-center gap-[var(--ck-space-3)] border-b border-[var(--ck-edge-hairline)] px-[var(--ck-space-3)]">
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--ck-text-primary)]">
          {dados.caminho}
        </span>
        {!dados.binario ? (
          <span className="shrink-0 font-mono text-sm text-[var(--ck-text-secondary)]">
            {dados.totalDeLinhas} {dados.totalDeLinhas === 1 ? 'linha' : 'linhas'}
          </span>
        ) : null}
      </header>
      <div className="max-w-full overflow-x-auto p-[var(--ck-space-3)]">
        {dados.binario ? (
          <p className="font-sans text-sm text-[var(--ck-text-secondary)]">
            Conteúdo binário — não exibido.
          </p>
        ) : (
          <>
            <CodeBlock>{visivel}</CodeBlock>
            {excedente > 0 ? (
              <button
                type="button"
                className="ck-veil mt-[var(--ck-space-2)] min-h-[44px] rounded-[var(--ck-radius-chip)] px-[var(--ck-space-3)] font-sans text-sm text-[var(--ck-text-secondary)]"
                aria-expanded={tudo}
                onClick={() =>
                  setExpandidoPara((atual) => (atual === dados.caminho ? null : dados.caminho))
                }
              >
                {tudo ? 'recolher' : `ver tudo (+${excedente} linhas)`}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
