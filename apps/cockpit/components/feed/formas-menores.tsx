'use client';

// As formas menores do feed: a fala literal do humano, a linha seca e a parte
// de um `assistant`. Saíram de `corpo-do-item.tsx` (02/10), sem mudança — lá
// ficou a ponte item → desenho; aqui, as peças que ela monta.

import { useState } from 'react';

import type { ContentPart } from '@grupo_borges/cockpit-core/messages-types';
import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { AssistantMarkdown } from '@/components/renderers/markdown';
import { Thinking } from '@/components/renderers/thinking';

import { Execucao } from './execucao';
import { execucaoDaParte } from './execucao-do-item';
import { resumoDeUmaLinha, temMaisParaMostrar } from './linha-seca.ts';

/* -------------------------------------------------------------------------- */
/* Formas menores — uma linha, sem moldura                                    */
/* -------------------------------------------------------------------------- */

/** Texto literal do humano: nunca passa por markdown. O que o Rica digitou é o
 *  que aparece, inclusive quando ele digita crase. */
export function Fala({ texto, tom }: { texto: string; tom?: 'discreto' }) {
  return (
    <p
      style={{
        margin: 0,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        color: tom === 'discreto' ? 'var(--ck-text-tertiary)' : 'var(--ck-text-primary)',
        fontSize: tom === 'discreto' ? 'var(--ck-text-sm)' : 'var(--ck-text-md)',
      }}
    >
      {texto}
    </p>
  );
}

/** Linha de sistema, sem a caixinha — ordem do Rica, 02/08: "sem borda, sem
 *  fundo, sem badge". O rótulo é overline (12px, uppercase, tracking largo):
 *  lê-se como legenda, não como chip. Corpo em secondary — tertiary em texto
 *  de corpo é reprovação direta do contrato (3.55:1).
 *
 *  Uma linha continua sendo o desenho certo, mas ela deixou de ser MUDA sobre
 *  o que esconde: medido no chat do Rica em 15/08, viewport de iPhone, 23px
 *  visíveis de 555px reais — 4% do texto. Ele leu o conjunto como "tudo sai
 *  truncado". Quando há mais atrás das reticências, a linha inteira vira alvo
 *  e abre no lugar; corpo curto ("60 passos") não ganha controle nenhum. */
export function LinhaSeca({ rotulo, corpo }: { rotulo: string; corpo?: string }) {
  const [aberta, setAberta] = useState(false);
  const podeAbrir = temMaisParaMostrar(corpo);

  const miolo = (
    <>
      <span
        style={{
          flexShrink: 0,
          fontSize: 'var(--ck-text-xs)',
          letterSpacing: 'var(--ck-track-overline)',
          textTransform: 'uppercase',
        }}
      >
        {rotulo}
      </span>
      {corpo ? (
        <span
          style={{
            fontSize: 'var(--ck-text-sm)',
            minWidth: 0,
            flex: 1,
            ...(aberta
              ? { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }
              : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
          }}
        >
          {aberta ? corpo : resumoDeUmaLinha(corpo)}
        </span>
      ) : null}
    </>
  );

  const forma = {
    display: 'flex',
    gap: 'var(--ck-space-2)',
    alignItems: aberta ? 'flex-start' : 'baseline',
    minWidth: 0,
    width: '100%',
    textAlign: 'left' as const,
    color: 'var(--ck-text-secondary)',
  };

  if (!podeAbrir) return <div style={forma}>{miolo}</div>;

  return (
    <button
      type="button"
      onClick={() => setAberta((estava) => !estava)}
      aria-expanded={aberta}
      aria-label={aberta ? `Fechar ${rotulo}` : `Abrir ${rotulo} por inteiro`}
      style={{ ...forma, minHeight: 'var(--ck-touch-min)', alignItems: aberta ? 'flex-start' : 'center' }}
    >
      {miolo}
    </button>
  );
}

export function Parte({
  parte,
  lookup,
  cursorNoFim = false,
}: {
  parte: ContentPart;
  lookup?: ToolResultLookup;
  cursorNoFim?: boolean;
}) {
  switch (parte.type) {
    case 'text':
      // Texto vazio não vira parágrafo fantasma com moldura.
      return parte.text.length > 0 ? (
        <AssistantMarkdown cursorNoFim={cursorNoFim}>{parte.text}</AssistantMarkdown>
      ) : null;
    case 'thinking':
      return <Thinking content={parte.thinking} />;
    case 'tool_use':
      return <Execucao entrada={execucaoDaParte(parte, lookup)} />;
    case 'tool_result':
      // O classificador dobra `tool_result` dentro do lookup, então chegar aqui
      // significa resultado órfão — mostrar seco vale mais que sumir.
      return (
        <LinhaSeca
          rotulo={parte.is_error === true ? 'resultado órfão · erro' : 'resultado órfão'}
          corpo={typeof parte.content === 'string' ? parte.content : undefined}
        />
      );
  }
}
