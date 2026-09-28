// Quando um item do feed pode PULAR o render — a comparação do `memo` do
// `CorpoDoItem`.
//
// O feed re-renderiza o tempo todo por motivo que não é do item: o
// virtualizador chama `flushSync` a cada passo de rolagem, a medição de altura
// devolve render, e cada quadro de streaming troca a lista inteira. Sem memo,
// cada um desses custava os ~20 itens montados — markdown reparseado, linha de
// ferramenta relida. A doc do React (react.dev/reference/react/memo, React
// 19.2) é a régua: `memo(Componente, arePropsEqual)` pula o render quando a
// função devolve true, e ela TEM de comparar tudo o que o componente lê —
// "if you do, make sure it compares every prop, including functions".
//
// O único prop que exige cuidado é o `lookup`. Ele vira um `Map` novo a cada
// mensagem (`buildToolResultLookup` refaz tudo), e com comparação rasa nenhum
// item jamais pularia. Mas o item só LÊ do lookup as entradas dos próprios
// `tool_use` — então é isso que se compara: as entradas desses ids, por valor.
// Um resultado que chega para a ferramenta X redesenha só quem tem X.
//
// Lógica pura, sem React: o `node --test` roda este módulo direto.

import type { ContentPart } from '@grupo_borges/cockpit-core/messages-types';
import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { usoDoChip } from './execucao-do-item.ts';
import type { ItemDoFeed, MembroDoGrupo } from './grupo-ferramentas.ts';

export type PropsDoItem = {
  item: ItemDoFeed;
  lookup?: ToolResultLookup;
  agentSlug?: string;
  estaRodando?: boolean;
};

function idsDasPartes(partes: readonly ContentPart[], saida: string[]): void {
  for (const parte of partes) if (parte.type === 'tool_use') saida.push(parte.id);
}

function idsDoMembro(membro: MembroDoGrupo, saida: string[]): void {
  if (membro.kind === 'assistant') {
    idsDasPartes(membro.parts, saida);
    return;
  }
  const uso = usoDoChip(membro);
  if (uso) saida.push(uso.id);
}

/** Os `tool_use_id` cujo resultado este item lê do lookup — exatamente as
 *  leituras do `CorpoDoItem`: `execucaoDaParte` nas partes do assistant,
 *  `execucaoDoChip` no chip de ferramenta, `entradasDoGrupo` nos membros. */
export function idsQueOItemLe(item: ItemDoFeed): string[] {
  const ids: string[] = [];
  switch (item.kind) {
    case 'assistant':
      idsDasPartes(item.parts, ids);
      break;
    case 'chip':
      if (item.classifierKind === 'tool') idsDoMembro(item, ids);
      break;
    case 'grupo-ferramentas':
      for (const membro of item.itens) idsDoMembro(membro, ids);
      break;
  }
  return ids;
}

type Entrada = ReturnType<ToolResultLookup['get']>;

/** Mesma entrada por VALOR: o `buildToolResultLookup` recria o objeto a cada
 *  chamada, mas o `rich` é o `tool_use_result` da mensagem — mesma referência
 *  enquanto a mensagem for a mesma. */
function mesmaEntrada(a: Entrada, b: Entrada): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.content === b.content && a.isError === b.isError && a.rich === b.rich;
}

export function mesmasPropsDoItem(antes: PropsDoItem, depois: PropsDoItem): boolean {
  if (antes.item !== depois.item) return false;
  if (antes.agentSlug !== depois.agentSlug) return false;
  if (Boolean(antes.estaRodando) !== Boolean(depois.estaRodando)) return false;
  if (antes.lookup === depois.lookup) return true;
  for (const id of idsQueOItemLe(depois.item)) {
    if (!mesmaEntrada(antes.lookup?.get(id), depois.lookup?.get(id))) return false;
  }
  return true;
}
