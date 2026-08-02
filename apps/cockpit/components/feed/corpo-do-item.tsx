'use client';

// Ponte RenderItem → renderers reais.
//
// Esta é a única camada que sabe traduzir o vocabulário do classificador para o
// vocabulário visual. `components/renderers/**` é de CONSUMO: se algo aqui
// precisar de um renderer diferente, o conserto é uma conversa, não uma edição
// lá dentro.
//
// A tese do cockpit v2 é que 82% do que passa por aqui é `tool_use` — então o
// caminho quente é `LinhaExecucao`, e ela nasce colapsada.

import type { ContentPart } from '@grupo_borges/cockpit-core/messages-types';
import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { AssistantMarkdown } from '@/components/renderers/markdown';
import { Thinking } from '@/components/renderers/thinking';

import { Execucao } from './execucao';
import {
  execucaoDaParte,
  execucaoDoChip,
} from './execucao-do-item';
import type { ItemDoFeed } from './grupo-ferramentas.ts';
import { GrupoFerramentasView } from './grupo-ferramentas.tsx';

type Props = { item: ItemDoFeed; lookup?: ToolResultLookup };

/* -------------------------------------------------------------------------- */
/* Formas menores — uma linha, sem moldura                                    */
/* -------------------------------------------------------------------------- */

/** Texto literal do humano: nunca passa por markdown. O que o Rica digitou é o
 *  que aparece, inclusive quando ele digita crase. */
function Fala({ texto, tom }: { texto: string; tom?: 'discreto' }) {
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
 *  de corpo é reprovação direta do contrato (3.55:1). */
function LinhaSeca({ rotulo, corpo }: { rotulo: string; corpo?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--ck-space-2)',
        alignItems: 'baseline',
        minWidth: 0,
        color: 'var(--ck-text-secondary)',
      }}
    >
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
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
            flex: 1,
            fontSize: 'var(--ck-text-sm)',
          }}
        >
          {corpo}
        </span>
      ) : null}
    </div>
  );
}

function Parte({ parte, lookup }: { parte: ContentPart; lookup?: ToolResultLookup }) {
  switch (parte.type) {
    case 'text':
      // Texto vazio não vira parágrafo fantasma com moldura.
      return parte.text.length > 0 ? <AssistantMarkdown>{parte.text}</AssistantMarkdown> : null;
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

/* -------------------------------------------------------------------------- */
/* Item                                                                        */
/* -------------------------------------------------------------------------- */

export function CorpoDoItem({ item, lookup }: Props) {
  switch (item.kind) {
    case 'user':
      // Balão — ordem do Rica, 30/07: "o meu vai em balão, o de vcs fica
      // solto". `w-fit` segura a caixa no tamanho do texto dentro do
      // flex-column do feed; sem ele ela estica (`align-items: stretch` é o
      // padrão do eixo cruzado) e o balão vira uma faixa cheia.
      //
      // `self-end` desde 02/08, testando o v2: *"o input que eu mando fica do
      // lado esquerdo junto com o output, o certo seria do lado direito"*. A
      // ordem de 30/07 tinha decidido balão contra solto, não o lado — com os
      // dois à esquerda, a fala dele e a da máquina começavam na mesma margem e
      // só o fundo separava. O lado é o que distingue quem falou antes de ler.
      return (
        <div
          className="w-fit max-w-[var(--ck-read-mid)] self-end rounded-[var(--ck-radius-frame)]"
          style={{ background: 'var(--ck-surface-raised)', padding: 'var(--ck-space-3)' }}
        >
          <Fala texto={item.text} />
        </div>
      );
    case 'user-internal':
      return <Fala texto={item.text} tom="discreto" />;
    case 'meta-decision':
      return <Fala texto={item.text} tom="discreto" />;

    case 'assistant':
      return (
        <>
          {item.parts.map((parte, indice) => (
            <Parte key={indice} parte={parte} lookup={lookup} />
          ))}
        </>
      );

    case 'chip':
      return item.classifierKind === 'tool' ? (
        <Execucao entrada={execucaoDoChip(item, lookup)} />
      ) : (
        <LinhaSeca rotulo={item.chip.label} corpo={item.chip.summary || item.expandBody} />
      );

    case 'grupo-ferramentas':
      return <GrupoFerramentasView grupo={item} lookup={lookup} />;

    case 'synthetic':
      // `stt` não é evento de sistema: é o Rica falando, e chegou por voz em vez
      // de teclado. Estava caindo no mesmo desenho dos wakeups — linha cinza,
      // truncada, rótulo técnico — e ele leu isso como defeito no teste de 02/08
      // (*"o texto ficou embaixo"*). Wakeup é máquina se anunciando e continua
      // discreto; a fala dele ganha o mesmo balão do texto digitado, porque é a
      // mesma pessoa dizendo a mesma coisa por outra porta. O 🎙 já vem no
      // `raw_text` e é o que distingue as duas portas — não precisa de rótulo.
      return item.syntheticKind === 'stt' ? (
        <div
          className="w-fit max-w-[var(--ck-read-mid)] self-end rounded-[var(--ck-radius-frame)]"
          style={{ background: 'var(--ck-surface-raised)', padding: 'var(--ck-space-3)' }}
        >
          <Fala texto={item.rawText} />
        </div>
      ) : (
        <LinhaSeca rotulo={item.syntheticKind} corpo={item.rawText} />
      );
    case 'channel':
      return <LinhaSeca rotulo="canal" corpo={item.raw} />;

    case 'sidechain-group':
      return (
        <LinhaSeca
          rotulo="& subagente"
          corpo={`${item.count} ${item.count === 1 ? 'passo' : 'passos'}`}
        />
      );
    case 'sidechain-cluster':
      return (
        <LinhaSeca
          rotulo="& subagentes"
          corpo={`${item.subagentCount} em paralelo`}
        />
      );

    case 'ask-user':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ck-space-1)' }}>
          <LinhaSeca rotulo="pergunta" corpo={item.entry.status} />
          {item.entry.questions.map((questao, indice) => (
            <Fala key={indice} texto={typeof questao === 'string' ? questao : JSON.stringify(questao)} />
          ))}
        </div>
      );
  }
}
