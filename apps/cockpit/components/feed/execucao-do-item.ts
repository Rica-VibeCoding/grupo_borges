// Que entrada a `LinhaExecucao` recebe para um dado item.
//
// Mora fora do `.tsx` de propósito: renderizar é do React, ESCOLHER é nosso, e
// é o escolher que quebra nas bordas — chip sem `tool_use` casável, resultado
// que ainda não chegou, corpo vazio. A suíte roda `node --test` sem
// transpilação de JSX, então lógica que precisa de prova não pode morar dentro
// de um componente.
//
// Caminho quente do cockpit v2: 82% do que passa pelo feed é `tool_use`.

import type { ContentPart } from '@grupo_borges/cockpit-core/messages-types';
import type { RenderItem, ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

// Extensão explícita: o `node --test` roda estes módulos sem bundler e resolve
// como ESM — mesma convenção do `gramatica.ts` e do `acoes-rapidas.ts`.
import { normalizarAgentResult } from '../renderers/agent-result.ts';
import { normalizarFetchResult } from '../renderers/fetch-result.ts';
import { normalizarConteudoDeArquivo } from '../renderers/file-content.ts';
import { normalizarPaginaPublicada } from '../renderers/published-page.ts';
import { normalizarListaResultado } from '../renderers/result-list.ts';
import { normalizarSaidaDeShell } from '../renderers/shell-output.ts';
import { normalizarLinhaDeStatus } from '../renderers/status-line.ts';

import { ehLinhaDeTrabalho, type ItemDoFeed } from './grupo-ferramentas.ts';

export type EntradaDaExecucao = {
  toolName: string;
  args?: unknown;
  result?: unknown;
  rich?: unknown;
  isError?: boolean;
  /** Sem resultado casado, a execução ainda está em voo: `running`, ou
   *  `requires-action` quando quem tem a vez é o Rica (`pedeAoRica`). Os quatro
   *  valores do `EntradaExecucao` da gramática — este tipo é espalhado nela —
   *  embora este módulo não produza `incomplete`. */
  estado: 'running' | 'complete' | 'incomplete' | 'requires-action';
};

/** Ferramentas cujo resultado é a RESPOSTA DO RICA (02/10): sem resultado, o
 *  agente não está trabalhando, está esperando ele — `aguarda`, âmbar (§6.5).
 *  O back-end não marca isso: o JSONL só tem o `tool_use` sem `tool_result`,
 *  igual a qualquer ferramenta em voo. Quem sabe é o nome. */
// `mcp__ask-user__ask_user` é o painel de decisão do cockpit: trava o turno até
// o Rica escolher, igual ao `AskUserQuestion`.
const PEDE_AO_RICA: ReadonlySet<string> = new Set(['AskUserQuestion', 'mcp__ask-user__ask_user']);

export function pedeAoRica(toolName: string): boolean {
  return PEDE_AO_RICA.has(toolName);
}

/** Em voo — rodando ou esperando o Rica. */
export function estaEmVoo(entrada: Pick<EntradaDaExecucao, 'estado'>): boolean {
  return entrada.estado === 'running' || entrada.estado === 'requires-action';
}

function semResultado(toolName: string): EntradaDaExecucao['estado'] {
  return pedeAoRica(toolName) ? 'requires-action' : 'running';
}

type Chip = Extract<RenderItem, { kind: 'chip' }>;
type UsoDeFerramenta = Extract<ContentPart, { type: 'tool_use' }>;

/** O `tool_use` que originou um chip — o chip carrega a mensagem inteira. */
export function usoDoChip(item: Chip): UsoDeFerramenta | undefined {
  const partes = item.payload.message?.content;
  if (!Array.isArray(partes)) return undefined;
  return (partes as ContentPart[]).find(
    (parte): parte is UsoDeFerramenta => parte.type === 'tool_use',
  );
}

/** Qual família de renderer rico atende este `tool_use_result` cru. Cada
 *  normalizador devolve null fora da própria família, e as famílias são
 *  disjuntas por construção (as chaves exigidas não se sobrepõem) — a ordem é
 *  só desempate defensivo, da mais quente para a mais rara na matriz.
 *  `null` = nenhuma família: o corpo fica com o `Saida` genérico de sempre.
 *  A escolha mora aqui (testada contra fixture real); o `.tsx` só desenha. */
export function familiaDoRich(
  rich: unknown,
): 'fetch' | 'lista' | 'agente' | 'arquivo' | 'status' | 'pagina-publicada' | 'shell' | null {
  if (rich === null || rich === undefined) return null;
  if (normalizarFetchResult(rich)) return 'fetch';
  if (normalizarListaResultado(rich)) return 'lista';
  if (normalizarAgentResult(rich)) return 'agente';
  if (normalizarConteudoDeArquivo(rich)) return 'arquivo';
  if (normalizarLinhaDeStatus(rich)) return 'status';
  if (normalizarPaginaPublicada(rich)) return 'pagina-publicada';
  if (normalizarSaidaDeShell(rich)) return 'shell';
  return null;
}

/** A mesma execução por VALOR — a comparação do `memo` da `Execucao`. Quem
 *  monta a entrada (`execucaoDaParte`, `entradasDoGrupo`) cria objeto novo a
 *  cada render; os campos vêm da mensagem e do lookup e só mudam quando a
 *  execução muda (o resultado chega, o erro aparece). */
export function mesmaExecucao(
  { entrada: a }: { entrada: EntradaDaExecucao },
  { entrada: b }: { entrada: EntradaDaExecucao },
): boolean {
  return (
    a === b ||
    (a.toolName === b.toolName &&
      a.args === b.args &&
      a.result === b.result &&
      a.rich === b.rich &&
      a.isError === b.isError &&
      a.estado === b.estado)
  );
}

export function execucaoDaParte(
  parte: UsoDeFerramenta,
  lookup?: ToolResultLookup,
): EntradaDaExecucao {
  const achado = lookup?.get(parte.id);
  return {
    toolName: parte.name,
    args: parte.input,
    result: achado?.content,
    rich: achado?.rich,
    isError: achado?.isError,
    estado: achado ? 'complete' : semResultado(parte.name),
  };
}

export function execucaoDoChip(item: Chip, lookup?: ToolResultLookup): EntradaDaExecucao {
  const uso = usoDoChip(item);
  if (uso) return execucaoDaParte(uso, lookup);

  // Chip sintetizado pelo classificador, sem `tool_use` por baixo: o corpo do
  // próprio chip é o único resultado que existe. Corpo vazio NÃO vira
  // `complete` com resultado vazio — isso pintaria de concluído o que pode
  // estar em voo.
  const corpo = item.expandBody;
  return {
    toolName: item.chip.label,
    result: corpo || undefined,
    isError: item.tone === 'error' ? true : undefined,
    estado: corpo ? 'complete' : semResultado(item.chip.label),
  };
}

/** O item não pinta nada: é só o passo em voo, que mora na linha do agora (a
 *  `Execucao` devolve null para `running`). O envelope do feed tira o padding
 *  dele, e o item segue na lista com a mesma chave — some do olho sem
 *  remontar quando o passo termina. `requires-action` é pergunta e aparece. */
export function soPassoEmVoo(item: ItemDoFeed, lookup?: ToolResultLookup): boolean {
  if (item.kind === 'chip') {
    return item.classifierKind === 'tool' && execucaoDoChip(item, lookup).estado === 'running';
  }
  if (item.kind !== 'assistant' || !ehLinhaDeTrabalho(item)) return false;
  return item.parts.every(
    (parte) => parte.type !== 'tool_use' || execucaoDaParte(parte, lookup).estado === 'running',
  );
}
