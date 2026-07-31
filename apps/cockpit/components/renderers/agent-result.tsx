'use client';

// Corpo de resultado de subagente (G7 da matriz): lançamento assíncrono ou
// conclusão síncrona. Recebe o `tool_use_result` CRU por props; se não for da
// família, renderiza nada e o chamador cai pro genérico.
//
// Sem cor fora de token: var(--ck-*) ou nada.

import { useMemo, useState } from 'react';

// Extensão `.ts` explícita: sem ela, a resolução do bare specifier ficava
// ambígua com este próprio arquivo (mesmo nome, .tsx) e o build quebrava —
// mesma cautela que o corpo-do-item.tsx já usa pra importar daqui de fora.
import {
  classeDeCorDoStatus,
  normalizarAgentResult,
  type AgentResultConcluido,
  type ContentPartDoAgente,
} from './agent-result.ts';
import { AssistantMarkdown } from './markdown';

const LINHAS_DE_PRIMEIRA = 120;

function formatoDuracao(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const segundos = ms / 1000;
  if (segundos < 60) return `${segundos.toFixed(1).replace('.', ',')} s`;
  const minutos = Math.floor(segundos / 60);
  const resto = Math.round(segundos % 60);
  return `${minutos} min ${resto} s`;
}

function formatoNumero(valor: number): string {
  return new Intl.NumberFormat('pt-BR').format(valor);
}

function textoDaParte(parte: ContentPartDoAgente): string {
  if (typeof parte.text === 'string') return parte.text;
  return `[conteúdo ${parte.type} sem texto]`;
}

function Resumo({ dados }: { dados: AgentResultConcluido }) {
  const stats = dados.toolStats;
  const itens = [
    `${formatoNumero(dados.totalTokens)} tokens`,
    formatoDuracao(dados.totalDurationMs),
    `${formatoNumero(dados.totalToolUseCount)} tools`,
    `${formatoNumero(stats.readCount)} reads`,
    `${formatoNumero(stats.searchCount)} buscas`,
    `${formatoNumero(stats.bashCount)} bash`,
    `${formatoNumero(stats.editFileCount)} edições`,
    `+${formatoNumero(stats.linesAdded)}/−${formatoNumero(stats.linesRemoved)} linhas`,
    `${formatoNumero(stats.otherToolCount)} outras`,
  ];

  return (
    <ul className="flex flex-wrap gap-x-[var(--ck-space-3)] gap-y-[var(--ck-space-1)] border-b border-[var(--ck-edge-hairline)] px-[var(--ck-space-3)] py-[var(--ck-space-2)]">
      {itens.map((item) => (
        <li
          key={item}
          className="ck-tabular font-mono text-sm text-[var(--ck-text-secondary)]"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

export function AgentResult({ valor }: { valor: unknown }) {
  const dados = useMemo(() => normalizarAgentResult(valor), [valor]);
  const [expandidoPara, setExpandidoPara] = useState<string | null>(null);
  const chaveDoConteudo =
    dados?.variante === 'concluido'
      ? `${dados.agentId}:${dados.totalDurationMs}:${dados.totalTokens}`
      : null;
  const tudo = chaveDoConteudo !== null && expandidoPara === chaveDoConteudo;

  const conteudo = useMemo(() => {
    if (!dados || dados.variante !== 'concluido') {
      return { visivel: '', excedente: 0 };
    }
    const texto = dados.content.map(textoDaParte).join('\n\n');
    const linhas = texto.split('\n');
    const excedente = Math.max(0, linhas.length - LINHAS_DE_PRIMEIRA);
    return {
      visivel:
        excedente > 0 && !tudo ? linhas.slice(0, LINHAS_DE_PRIMEIRA).join('\n') : texto,
      excedente,
    };
  }, [dados, tudo]);

  if (!dados) return null;

  const tipo = dados.variante === 'concluido' ? dados.agentType : 'assíncrono';

  return (
    <section className="max-w-full overflow-hidden rounded-[var(--ck-radius-frame)] border border-[var(--ck-edge-hairline)] bg-[var(--ck-surface-composer)]">
      <header className="flex min-h-[44px] min-w-0 flex-wrap items-center gap-x-[var(--ck-space-3)] gap-y-[var(--ck-space-1)] border-b border-[var(--ck-edge-hairline)] px-[var(--ck-space-3)] py-[var(--ck-space-2)]">
        <span className="min-w-0 truncate font-mono text-sm font-medium text-[var(--ck-text-primary)]">
          {dados.agentId}
        </span>
        <span className="font-sans text-sm text-[var(--ck-text-secondary)]">{tipo}</span>
        <span className="font-mono text-sm text-[var(--ck-text-secondary)]">
          {dados.resolvedModel}
        </span>
        <span
          className={`font-mono text-sm ${classeDeCorDoStatus(dados.status)}`}
        >
          {dados.status}
        </span>
      </header>

      {dados.variante === 'assincrono' ? (
        <div className="flex min-w-0 flex-col gap-[var(--ck-space-2)] p-[var(--ck-space-3)]">
          <p className="font-sans text-sm text-[var(--ck-text-primary)]">
            {dados.description}
          </p>
          <p className="break-all font-mono text-sm text-[var(--ck-text-secondary)]">
            output: {dados.outputFile}
          </p>
          {!dados.canReadOutputFile ? (
            <p className="font-sans text-sm text-[var(--ck-state-attention)]">
              O arquivo de saída ainda não pode ser lido.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <Resumo dados={dados} />
          <div className="max-w-full overflow-x-auto p-[var(--ck-space-3)]">
            <AssistantMarkdown>{conteudo.visivel}</AssistantMarkdown>
            {conteudo.excedente > 0 ? (
              <button
                type="button"
                className="ck-veil mt-[var(--ck-space-2)] min-h-[44px] rounded-[var(--ck-radius-chip)] px-[var(--ck-space-3)] font-sans text-sm text-[var(--ck-text-secondary)]"
                aria-expanded={tudo}
                onClick={() =>
                  setExpandidoPara((valorAtual) =>
                    valorAtual === chaveDoConteudo ? null : chaveDoConteudo,
                  )
                }
              >
                {tudo ? 'recolher' : `ver tudo (+${conteudo.excedente} linhas)`}
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
