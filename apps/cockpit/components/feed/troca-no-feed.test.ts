import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { leConversaTrocada } from '../../lib/conversa-trocada.ts';
import type { ItemDoFeed } from './grupo-ferramentas.ts';
import { dobraPedidosDoCockpit, poeMarco, poeTrocaEmAndamento, textoDoPedido, textosDaTroca } from './troca-no-feed.ts';

const AT = Date.parse('2026-10-01T06:00:28Z');

function user(id: number, text: string, extra: Record<string, unknown> = {}, ts = AT - 60_000): ItemDoFeed {
  return { kind: 'user', text, payload: { id, uuid: `u${id}`, timestamp: new Date(ts).toISOString(), ...extra } as unknown as MessagePayload };
}
function assistant(id: number, extra: Record<string, unknown> = {}, ts = AT - 60_000): ItemDoFeed {
  return {
    kind: 'assistant',
    parts: [{ type: 'text', text: 'ok' }],
    payload: { id, uuid: `a${id}`, timestamp: new Date(ts).toISOString(), ...extra } as unknown as MessagePayload,
  } as ItemDoFeed;
}
const COCKPIT = { origem: 'cockpit' };
const PEDIDO = '[cockpit] Vou fechar esta conversa e retomar uma conversa antiga nesta linha.';

describe('troca no feed — o turno do cockpit, o marco e a espera (F13)', () => {
  it('o turno do cockpit vira uma linha só, com o pedido em palavras', () => {
    const itens = [user(1, 'oi'), assistant(2), user(3, PEDIDO, COCKPIT), assistant(4, COCKPIT), user(5, 'segue')];
    const dobrados = dobraPedidosDoCockpit(itens);
    assert.deepEqual(dobrados.map((i) => i.kind), ['user', 'assistant', 'pedido-do-cockpit', 'user']);
    const pedido = dobrados[2] as Extract<ItemDoFeed, { kind: 'pedido-do-cockpit' }>;
    assert.equal(pedido.itens.length, 2);
    assert.equal(textoDoPedido(pedido), PEDIDO);
  });

  it('sem nada do cockpit, devolve a mesma lista', () => {
    const itens = [user(1, 'oi'), assistant(2)];
    assert.equal(dobraPedidosDoCockpit(itens), itens);
  });

  it('o "ok" sozinho (replay cortado no meio do turno) também é do cockpit', () => {
    const dobrados = dobraPedidosDoCockpit([assistant(4, COCKPIT), user(5, 'segue')]);
    assert.equal(dobrados[0]?.kind, 'pedido-do-cockpit');
    assert.equal(textoDoPedido(dobrados[0] as Extract<ItemDoFeed, { kind: 'pedido-do-cockpit' }>), null);
  });

  it('Retomar: o marco fecha o histórico retomado e a conversa segue depois dele', () => {
    const troca = leConversaTrocada({ session_id: 'a5b2', motivo: 'retomar', at: AT })!;
    const itens = poeMarco([user(1, 'antigo'), assistant(2), user(3, 'depois', {}, AT + 5_000)], troca);
    assert.deepEqual(itens.map((i) => i.kind), ['user', 'assistant', 'marco-da-troca', 'user']);
  });

  it('Nova: o marco abre a lista', () => {
    const troca = leConversaTrocada({ session_id: 'n1', motivo: 'nova', at: AT })!;
    assert.deepEqual(poeMarco([], troca).map((i) => i.kind), ['marco-da-troca']);
    assert.deepEqual(poeMarco([user(1, 'primeira', {}, AT + 1)], troca).map((i) => i.kind), ['marco-da-troca', 'user']);
  });

  it('a linha da troca fecha a lista, e diz o passo em curso', () => {
    const troca = { fase: 'trocando', tipo: 'retomar', alvoTitulo: 'Voz em tempo real', etapa: 'estacionando', inicio: 0, desligado: false, forcar: false } as const;
    const itens = poeTrocaEmAndamento([user(1, 'oi')], troca);
    assert.equal(itens.at(-1)?.kind, 'troca-em-andamento');
    assert.deepEqual(textosDaTroca(troca), { titulo: 'Trocando para “Voz em tempo real”', passo: 'Anotando onde esta conversa parou', alerta: false });
    assert.equal(textosDaTroca({ ...troca, etapa: 'religando', tipo: 'nova' }).passo, 'Abrindo a conversa nova');
    assert.equal(textosDaTroca({ fase: 'falhou', texto: 'o /clear não chegou' }).alerta, true);
    assert.equal(poeTrocaEmAndamento([], null).length, 0);
  });
});
