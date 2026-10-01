// A troca de conversa dentro da lista do feed (F13) — lógica pura, sem React.
//
// Três costuras sobre os itens que o classificador já agrupou:
//   1. o turno do cockpit (`origem: "cockpit"`) vira UMA linha discreta, e não
//      a bolha do Rica seguida de um "ok" solto;
//   2. o marco da troca entra no ponto em que a conversa passou a valer;
//   3. durante a troca, a linha "trocando" fecha a lista.

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { antesDaTroca, type ConversaTrocada } from '../../lib/conversa-trocada.ts';
import type { TrocaNoChat } from '../../lib/troca-em-curso.ts';
import type { ItemDoFeed } from './grupo-ferramentas.ts';

/** A mensagem que representa o item: a dele, ou a do primeiro membro. */
function payloadDe(item: ItemDoFeed): MessagePayload | null {
  if (item.kind === 'grupo-ferramentas') return item.itens[0]?.payload ?? null;
  if (item.kind === 'pedido-do-cockpit') return item.itens[0] ? payloadDe(item.itens[0]) : null;
  return 'payload' in item && item.payload ? item.payload : null;
}

export function ehDoCockpit(item: ItemDoFeed): boolean {
  const payload = payloadDe(item) as (MessagePayload & { origem?: unknown }) | null;
  return payload?.origem === 'cockpit';
}

/** Junta cada run de itens do cockpit num `pedido-do-cockpit`. Sem run,
 *  devolve a MESMA lista — o memo de quem chama não se perde à toa. */
export function dobraPedidosDoCockpit(itens: readonly ItemDoFeed[]): readonly ItemDoFeed[] {
  if (!itens.some(ehDoCockpit)) return itens;
  const saida: ItemDoFeed[] = [];
  let run: ItemDoFeed[] | null = null;
  for (const item of itens) {
    if (ehDoCockpit(item)) {
      if (!run) {
        run = [];
        saida.push({ kind: 'pedido-do-cockpit', itens: run });
      }
      run.push(item);
    } else {
      run = null;
      saida.push(item);
    }
  }
  return saida;
}

/** O pedido em palavras: o texto da primeira fala do cockpit, se houver. */
export function textoDoPedido(item: Extract<ItemDoFeed, { kind: 'pedido-do-cockpit' }>): string | null {
  for (const membro of item.itens) if (membro.kind === 'user') return membro.text;
  return null;
}

/** O marco entra depois do último item nascido antes da troca. Na Nova, a
 *  conversa nasce vazia e ele abre a lista; no Retomar, fecha o histórico
 *  retomado e o que vier depois é a conversa seguindo. */
export function poeMarco(itens: readonly ItemDoFeed[], troca: ConversaTrocada): ItemDoFeed[] {
  let posicao = 0;
  itens.forEach((item, i) => {
    const payload = payloadDe(item);
    if (!payload || antesDaTroca(troca, payload)) posicao = i + 1;
  });
  return [...itens.slice(0, posicao), { kind: 'marco-da-troca', troca }, ...itens.slice(posicao)];
}

/** A linha da troca fecha a lista; na pronta e na falha também — a pronta
 *  segura "abrindo a conversa" até o stream trazê-la, a falha diz o motivo. */
export function poeTrocaEmAndamento(itens: readonly ItemDoFeed[], troca: TrocaNoChat | null): readonly ItemDoFeed[] {
  if (!troca) return itens;
  return [...itens, { kind: 'troca-em-andamento', troca }];
}

export type TextosDaTroca = { titulo: string; passo: string | null; alerta: boolean };

/** O que a linha da troca diz em cada fase. O tempo conta em quem desenha. */
export function textosDaTroca(troca: TrocaNoChat): TextosDaTroca {
  if (troca.fase === 'falhou') return { titulo: 'A troca de conversa não terminou', passo: troca.texto, alerta: true };
  if (troca.fase === 'pronta') return { titulo: 'Abrindo a conversa nova…', passo: null, alerta: false };
  const titulo =
    troca.tipo === 'nova'
      ? 'Trocando para uma conversa nova'
      : troca.alvoTitulo
        ? `Trocando para “${troca.alvoTitulo}”`
        : 'Trocando de conversa';
  const passo = troca.desligado
    ? 'Ligando o agente nesta conversa'
    : troca.etapa === 'estacionando'
      ? troca.forcar
        ? 'Interrompendo o turno'
        : 'Anotando onde esta conversa parou'
      : troca.tipo === 'nova'
        ? 'Abrindo a conversa nova'
        : 'Religando o agente na conversa pedida';
  return { titulo, passo, alerta: false };
}
