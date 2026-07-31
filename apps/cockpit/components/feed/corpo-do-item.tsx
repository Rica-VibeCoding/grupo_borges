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
import type { RenderItem } from '@grupo_borges/cockpit-core/render-items';
import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { Badge } from '@/components/ui/badge';
// Extensão `.tsx` explícita de propósito: cada renderer tem um `.ts` irmão de
// mesmo nome (a lógica testada), e a resolução sem extensão acha o `.ts`
// primeiro. O componente só sai pelo caminho completo.
import { AgentResult } from '@/components/renderers/agent-result.tsx';
import { FetchResult } from '@/components/renderers/fetch-result.tsx';
import { LinhaExecucao } from '@/components/renderers/linha-execucao';
import { AssistantMarkdown } from '@/components/renderers/markdown';
import { ResultList } from '@/components/renderers/result-list.tsx';
import { Thinking } from '@/components/renderers/thinking';

import {
  execucaoDaParte,
  execucaoDoChip,
  familiaDoRich,
  type EntradaDaExecucao,
} from './execucao-do-item';

type Props = { item: RenderItem; lookup?: ToolResultLookup };

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

function LinhaSeca({ rotulo, corpo }: { rotulo: string; corpo?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--ck-space-2)',
        alignItems: 'baseline',
        minWidth: 0,
        fontSize: 'var(--ck-text-sm)',
        color: 'var(--ck-text-tertiary)',
      }}
    >
      <Badge>{rotulo}</Badge>
      {corpo ? (
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
            flex: 1,
          }}
        >
          {corpo}
        </span>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Execução                                                                    */
/* -------------------------------------------------------------------------- */

/** A escolha da entrada mora em `execucao-do-item.ts`, que tem teste. Aqui só
 *  se desenha o que foi escolhido. */
function Execucao({ entrada }: { entrada: EntradaDaExecucao }) {
  // O `rich` é o tool_use_result cru. A família foi escolhida (e provada contra
  // fixture real) no `familiaDoRich`; sem família, `corpoRico` fica undefined e
  // a LinhaExecucao cai no `Saida` genérico de sempre — caminho intacto.
  const familia = familiaDoRich(entrada.rich);
  const corpoRico =
    familia === 'fetch' ? (
      <FetchResult valor={entrada.rich} />
    ) : familia === 'lista' ? (
      <ResultList valor={entrada.rich} />
    ) : familia === 'agente' ? (
      <AgentResult valor={entrada.rich} />
    ) : undefined;

  return (
    <LinhaExecucao
      toolName={entrada.toolName}
      args={entrada.args}
      result={entrada.result}
      isError={entrada.isError}
      estado={entrada.estado}
      corpoRico={corpoRico}
    />
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
      // solto". `w-fit` + `self-start` seguram a caixa no tamanho do texto
      // dentro do flex-column do feed; sem os dois ela estica (`align-items:
      // stretch` é o padrão do eixo cruzado) e o balão vira uma faixa cheia.
      return (
        <div
          className="w-fit max-w-[var(--ck-read-mid)] self-start rounded-[var(--ck-radius-frame)]"
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

    case 'synthetic':
      return <LinhaSeca rotulo={item.syntheticKind} corpo={item.rawText} />;
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
