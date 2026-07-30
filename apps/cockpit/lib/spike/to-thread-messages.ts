// to-thread-messages — a ponte RenderItem[] → ThreadMessageLike[].
//
// Contrato: docs/cockpit-v2-data-contract.md §5.1. O caminho inteiro é
//   MessagePayload[] → buildRenderItems → RenderItem[] → toThreadMessages → ThreadMessageLike[]
// e a ponte começa no RenderItem de propósito: o classificador é o ativo, a
// biblioteca é só quem desenha.
//
// Vive em lib/spike/ porque só sobrevive se o gate do passo 5 passar. Se cair
// para shadcn-only, este arquivo morre inteiro e nada mais se mexe.
//
// ---------------------------------------------------------------------------
// FONTE DA ASSINATURA: o pacote instalado, não memória. `ThreadMessageLike`
// está em node_modules/@assistant-ui/core/dist/runtime/utils/thread-message-like.d.ts:9
// e é re-exportado como tipo por @assistant-ui/react@0.15.1, que é a dependência
// direta deste app (o /core não é, então o import tem de vir do /react).
//
// Campos usados, todos conferidos linha a linha naquele .d.ts:
//   role · content · id · createdAt
//   { type: 'text', text }                                 (message.d.ts:8)
//   { type: 'reasoning', text }                            (message.d.ts:14)
//   { type: 'tool-call', toolCallId?, toolName, args?,
//     argsText?, result?, isError? }                       (thread-message-like.d.ts:12-19)
//   { type: `data-${string}`, data }                       (thread-message-like.d.ts:5)
//
// `status` existe no tipo mas NÃO é preenchido aqui: o contrato não fixa como
// derivá-lo do nosso payload, e chutar status de mensagem é inventar semântica
// de uma lib de um dia de idade.
// ---------------------------------------------------------------------------

import type { ThreadMessageLike } from '@assistant-ui/react';
import type { RenderItem, ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';
import type { ContentPart, MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

type Parts = Exclude<ThreadMessageLike['content'], string>;
type Part = Parts[number];
type Papel = ThreadMessageLike['role'];

/** Igual ao `assertNever` do cockpit-core: kind novo no union quebra na build,
 *  em vez de sumir em silêncio no runtime. */
function kindNaoTratado(kind: never): never {
  throw new Error(`RenderItem.kind sem conversão para ThreadMessageLike: ${String(kind)}`);
}

function ehObjetoSimples(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function papelDe(payload: MessagePayload | undefined): Papel {
  return payload?.message?.role === 'user' ? 'user' : 'assistant';
}

function criadoEm(payload: MessagePayload | undefined): Date | undefined {
  if (!payload) return undefined;
  if (payload.timestamp) {
    const d = new Date(payload.timestamp);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // created_at do contrato SSE é em SEGUNDOS.
  if (typeof payload.created_at === 'number') return new Date(payload.created_at * 1000);
  return undefined;
}

/** Monta a mensagem sem chaves com `undefined`: o `id` opcional do tipo é
 *  `string | undefined`, mas emitir a chave com undefined polui o diff dos
 *  testes e o JSON que vai pro renderer. */
function mensagem(role: Papel, content: Parts, id?: string, payload?: MessagePayload): ThreadMessageLike {
  const m: {
    role: Papel; content: Parts; id?: string; createdAt?: Date;
  } = { role, content };
  if (id) m.id = id;
  const criado = criadoEm(payload);
  if (criado) m.createdAt = criado;
  return m;
}

function partDeDados(tipo: `data-${string}`, data: unknown): Part {
  return { type: tipo, data } as Part;
}

/**
 * Converte um `tool_use` do nosso payload no `tool-call` nativo da lib.
 *
 * É o encaixe que justifica a ponte: o `tool-call` da lib tem `result` e
 * `isError`, e hoje o `tool_use_result` rico chega e é descartado porque o que
 * decide virar chip é o corte de 300 caracteres em chat-payload-classifier.ts:216.
 */
function toolCall(p: Extract<ContentPart, { type: 'tool_use' }>, lookup?: ToolResultLookup): Part {
  const achado = lookup?.get(p.id);
  const part: {
    type: 'tool-call'; toolCallId: string; toolName: string;
    args?: Record<string, unknown>; argsText?: string; result?: unknown; isError?: boolean;
  } = { type: 'tool-call', toolCallId: p.id, toolName: p.name };

  // `args` do tipo é ReadonlyJSONObject. `input` é `unknown` no nosso contrato,
  // então só entra como args quando é objeto; qualquer outra coisa vai em
  // `argsText`, que é o escape que a própria lib declara (linha 16 do .d.ts).
  if (ehObjetoSimples(p.input)) part.args = p.input;
  else if (p.input !== undefined && p.input !== null) part.argsText = JSON.stringify(p.input);

  if (achado) {
    part.result = achado.content;
    part.isError = achado.isError;
  }
  return part as Part;
}

function partsDoAssistant(parts: ContentPart[], lookup?: ToolResultLookup): Parts {
  const saida: Part[] = [];
  for (const p of parts) {
    switch (p.type) {
      case 'text':
        saida.push({ type: 'text', text: p.text });
        break;
      case 'thinking':
        saida.push({ type: 'reasoning', text: p.thinking });
        break;
      case 'tool_use':
        saida.push(toolCall(p, lookup));
        break;
      case 'tool_result':
        // Não deveria chegar aqui — buildRenderItems dobra tool_result no
        // lookup. Se chegar, vira dado nosso em vez de sumir: perder bloco em
        // silêncio é o modo de falha que o baseline existe para pegar.
        saida.push(partDeDados('data-tool-result', {
          toolUseId: p.tool_use_id, content: p.content, isError: p.is_error === true,
        }));
        break;
      default:
        return kindNaoTratado(p as never);
    }
  }
  return saida;
}

/**
 * A conversão. Um `RenderItem` vira exatamente uma `ThreadMessageLike` — 1:1,
 * sem agrupar e sem descartar, para que o contador de paridade do gate compare
 * maçã com maçã.
 *
 * @param itens  saída de `buildRenderItems`
 * @param lookup saída de `buildToolResultLookup`, opcional. Sem ele os
 *               `tool-call` saem sem `result`/`isError` — que é exatamente a
 *               perda de informação que a ponte existe para acabar.
 */
export function toThreadMessages(itens: RenderItem[], lookup?: ToolResultLookup): ThreadMessageLike[] {
  return itens.map((item) => converte(item, lookup));
}

function converte(item: RenderItem, lookup?: ToolResultLookup): ThreadMessageLike {
  switch (item.kind) {
    case 'user':
      return mensagem('user', [{ type: 'text', text: item.text }], item.payload.uuid, item.payload);

    case 'user-internal':
      // Texto continua sendo part de texto — o marcador é uma part a mais, não
      // uma troca. Trocar apagaria o conteúdo para a lib.
      return mensagem('user', [
        { type: 'text', text: item.text },
        partDeDados('data-internal', { userType: item.payload.user_type }),
      ], item.payload.uuid, item.payload);

    case 'assistant':
      return mensagem('assistant', partsDoAssistant(item.parts, lookup), item.payload.uuid, item.payload);

    case 'chip': {
      // Chip de tool é o único que a lib modela nativamente. O `toolName` vem
      // do tool_use real do payload; `chip.label` é rótulo de UI já prettificado
      // e serviria de nome errado.
      if (item.classifierKind === 'tool') {
        const usos = (item.payload.message?.content ?? []) as ContentPart[];
        const uso = Array.isArray(usos)
          ? usos.find((p): p is Extract<ContentPart, { type: 'tool_use' }> => p.type === 'tool_use')
          : undefined;
        const base = uso
          ? toolCall(uso, lookup)
          : ({ type: 'tool-call', toolName: item.chip.label } as Part);
        const comResultado = {
          ...(base as Record<string, unknown>),
          result: item.expandBody,
          isError: item.tone === 'error',
        } as Part;
        return mensagem('assistant', [comResultado], item.payload.uuid, item.payload);
      }
      return mensagem(papelDe(item.payload), [partDeDados('data-chip', {
        classifierKind: item.classifierKind,
        chip: item.chip,
        expandBody: item.expandBody,
        tone: item.tone,
      })], item.payload.uuid, item.payload);
    }

    case 'synthetic':
      return mensagem(papelDe(item.payload), [partDeDados('data-synthetic', {
        syntheticKind: item.syntheticKind, rawText: item.rawText,
      })], item.payload.uuid, item.payload);

    case 'channel':
      return mensagem(papelDe(item.payload), [partDeDados('data-channel', {
        raw: item.raw,
      })], item.payload.uuid, item.payload);

    case 'meta-decision':
      return mensagem('assistant', [partDeDados('data-meta', {
        text: item.text,
      })], item.payload.uuid, item.payload);

    case 'sidechain-group':
      return mensagem('assistant', [partDeDados('data-sidechain', {
        forma: 'group', rootUuid: item.rootUuid, count: item.count,
        durMs: item.durMs, parentUuids: item.parentUuids,
      })], item.rootUuid);

    case 'sidechain-cluster':
      return mensagem('assistant', [partDeDados('data-sidechain', {
        forma: 'cluster', groups: item.groups,
        subagentCount: item.subagentCount, totalDurMs: item.totalDurMs,
      })], item.groups[0]?.rootUuid);

    case 'ask-user':
      // ⚠️ NÃO ESTÁ NA TABELA DO §5.1. O contrato lista nove kind; o union do
      // RenderItem tem dez, e este é o décimo. Ele não sai de buildRenderItems
      // (entra por mergeAskUserItems, a partir do SSE `ask_user`), então não
      // aparece no caminho medido — mas o switch é exaustivo e deixá-lo de fora
      // quebraria a build. Segue a regra declarada do próprio §5.1: o que a lib
      // não modela vai como data-*. Confirmar com o dono do contrato.
      return mensagem('assistant', [partDeDados('data-ask-user', { entry: item.entry })]);

    default:
      return kindNaoTratado(item);
  }
}
