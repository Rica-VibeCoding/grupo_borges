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

export type EntradaDaExecucao = {
  toolName: string;
  args?: unknown;
  result?: unknown;
  rich?: unknown;
  isError?: boolean;
  /** Sem resultado casado, a execução ainda está em voo. */
  estado: 'running' | 'complete';
};

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
    estado: achado ? 'complete' : 'running',
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
    estado: corpo ? 'complete' : 'running',
  };
}
