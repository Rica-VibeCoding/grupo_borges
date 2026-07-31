'use client';

// Corpo da saída de shell (G1 da matriz, 738 tool + 700 result). stdout e
// stderr têm a mesma força; estrutura, e não cor de falha, distingue os canais.
// O componente recebe o `tool_use_result` cru e não inventa caixa para silêncio.

import { useId, useMemo, useState } from 'react';

import { CodeBlock } from './code-block';
import {
  formatoBytesDeShell,
  normalizarSaidaDeShell,
  separarCaminhoDeShell,
  separarLinksDeShell,
  temCorpoDeShell,
} from './shell-output.ts';

const LINHAS_DE_PRIMEIRA = 120;

function trecho(texto: string, tudo: boolean) {
  const linhas = texto.replace(/\n+$/, '').split('\n');
  const excedente = Math.max(0, linhas.length - LINHAS_DE_PRIMEIRA);
  return {
    visivel:
      excedente > 0 && !tudo ? linhas.slice(0, LINHAS_DE_PRIMEIRA).join('\n') : texto,
    excedente,
  };
}

function Canal({
  nome,
  texto,
  tudo,
  aoAlternar,
}: {
  nome: 'stdout' | 'stderr';
  texto: string;
  tudo: boolean;
  aoAlternar: () => void;
}) {
  const id = useId();
  const conteudo = useMemo(() => trecho(texto, tudo), [texto, tudo]);
  const trechos = useMemo(() => separarLinksDeShell(conteudo.visivel), [conteudo.visivel]);
  if (texto.length === 0) return null;

  return (
    <section
      aria-labelledby={`${id}-rotulo`}
      className="min-w-0"
      style={
        nome === 'stderr'
          ? {
              borderLeft: '1px solid var(--ck-edge-functional)',
              paddingLeft: 'var(--ck-space-3)',
            }
          : undefined
      }
    >
      <p id={`${id}-rotulo`} className="m-0 font-mono text-sm text-[var(--ck-text-secondary)]">
        {nome}
      </p>
      <div id={`${id}-conteudo`}>
        <CodeBlock className="whitespace-pre-wrap break-words overflow-x-hidden">
          {trechos.map((item, indice) =>
            item.tipo === 'link' ? (
              <a
                key={`${indice}:${item.valor}`}
                className="ck-link"
                href={item.valor}
                target="_blank"
                rel="noreferrer"
              >
                {item.valor}
              </a>
            ) : (
              item.valor
            ),
          )}
        </CodeBlock>
      </div>
      {conteudo.excedente > 0 ? (
        <button
          type="button"
          className="ck-veil min-h-[var(--ck-touch-min)] rounded-[var(--ck-radius-chip)] px-[var(--ck-space-3)] font-sans text-sm text-[var(--ck-text-secondary)]"
          aria-expanded={tudo}
          aria-controls={`${id}-conteudo`}
          onClick={aoAlternar}
        >
          {tudo ? 'recolher' : `ver tudo (+${conteudo.excedente} linhas)`}
        </button>
      ) : null}
    </section>
  );
}

export function ShellOutput({ valor }: { valor: unknown }) {
  const dados = useMemo(() => normalizarSaidaDeShell(valor), [valor]);
  const [expandidoPara, setExpandidoPara] = useState<{
    stdout: string | null;
    stderr: string | null;
  }>({ stdout: null, stderr: null });
  if (!dados || !temCorpoDeShell(dados)) return null;
  const caminho =
    dados.caminhoDaSaidaCompleta !== undefined
      ? separarCaminhoDeShell(dados.caminhoDaSaidaCompleta)
      : null;

  const alternar = (canal: 'stdout' | 'stderr', texto: string) =>
    setExpandidoPara((atual) => ({
      ...atual,
      [canal]: atual[canal] === texto ? null : texto,
    }));

  return (
    <div className="flex min-w-0 flex-col gap-[var(--ck-space-3)]">
      <div className="flex min-w-0 flex-wrap items-center gap-[var(--ck-space-2)] font-mono text-sm text-[var(--ck-text-secondary)]">
        {dados.interrompido ? (
          <span className="text-[var(--ck-state-fail)]">interrompido</span>
        ) : null}
        {dados.backgroundTaskId ? <span>background · {dados.backgroundTaskId}</span> : null}
        {dados.operacaoGit ? (
          <span>
            git {dados.operacaoGit.acao}
            {dados.operacaoGit.branch ? ` · ${dados.operacaoGit.branch}` : ''}
          </span>
        ) : null}
      </div>

      <Canal
        nome="stdout"
        texto={dados.stdout}
        tudo={expandidoPara.stdout === dados.stdout}
        aoAlternar={() => alternar('stdout', dados.stdout)}
      />
      <Canal
        nome="stderr"
        texto={dados.stderr}
        tudo={expandidoPara.stderr === dados.stderr}
        aoAlternar={() => alternar('stderr', dados.stderr)}
      />

      {dados.interpretacaoDoRetorno ? (
        <p className="m-0 font-sans text-sm text-[var(--ck-text-secondary)]">
          {dados.interpretacaoDoRetorno}
        </p>
      ) : null}

      {dados.caminhoDaSaidaCompleta ? (
        <p className="m-0 flex min-w-0 font-mono text-sm text-[var(--ck-text-secondary)]">
          <span className="shrink-0">saída completa em&nbsp;</span>
          <span className="min-w-0 truncate">{caminho?.diretorio}</span>
          <span className="shrink-0">{caminho?.arquivo}</span>
          {dados.tamanhoDaSaidaCompleta !== undefined
            ? <span className="shrink-0">&nbsp;· {formatoBytesDeShell(dados.tamanhoDaSaidaCompleta)}</span>
            : null}
        </p>
      ) : null}
    </div>
  );
}
