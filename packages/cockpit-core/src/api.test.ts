import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  AgentInputError,
  deleteItemDaFila,
  fetchFilaDaSessao,
  postAgentInput,
} from './api.ts';

const fetchOriginal = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

test('postAgentInput preserva o desfecho estruturado da entrega', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        detail: {
          code: 'agent_pane_unavailable',
          delivery_outcome: 'uncertain',
          reason: 'envio_nao_confirmado',
          safe_to_resend: false,
        },
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );

  await assert.rejects(
    postAgentInput('daniel', 'faz isso'),
    (erro: unknown) => {
      assert.ok(erro instanceof AgentInputError);
      assert.equal(erro.status, 409);
      assert.equal(erro.detail, 'agent_pane_unavailable');
      assert.equal(erro.deliveryOutcome, 'uncertain');
      assert.equal(erro.reason, 'envio_nao_confirmado');
      assert.equal(erro.safeToResend, false);
      return true;
    },
  );
});

test('fetchFilaDaSessao devolve os itens da sessão', async () => {
  let urlPedida = '';
  globalThis.fetch = async (input: string | URL | Request) => {
    urlPedida = String(input);
    return new Response(JSON.stringify({ itens: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const resposta = await fetchFilaDaSessao('tara');
  assert.deepEqual(resposta.itens, []);
  assert.equal(urlPedida, '/api/agents/tara/fila', 'rota própria por sessão, não o snapshot da frota');
});

/** Slug com caractere especial não pode escapar da rota — é o mesmo cuidado que
 *  as outras rotas por sessão já tomam. */
test('fetchFilaDaSessao escapa o slug', async () => {
  let urlPedida = '';
  globalThis.fetch = async (input: string | URL | Request) => {
    urlPedida = String(input);
    return new Response(JSON.stringify({ itens: [] }), { status: 200 });
  };

  await fetchFilaDaSessao('a/b');
  assert.equal(urlPedida, '/api/agents/a%2Fb/fila');
});

test('deleteItemDaFila usa DELETE e escapa o id', async () => {
  let metodo = '';
  let urlPedida = '';
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    urlPedida = String(input);
    metodo = init?.method ?? 'GET';
    return new Response(JSON.stringify({ cancelada: true, item: {} }), { status: 200 });
  };

  await deleteItemDaFila('tara', 'a/b');
  assert.equal(metodo, 'DELETE');
  assert.equal(urlPedida, '/api/agents/tara/fila/a%2Fb');
});

/**
 * O item já drenando não pode ser cancelado, e o erro tem de chegar em texto —
 * recusa muda aqui viraria botão que não faz nada, que é o defeito que a
 * `porta-de-envio` existe para matar, um andar acima.
 */
test('cancelar item que já saiu de pendente falha dizendo por quê', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ detail: 'item_ja_drenando' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });

  await assert.rejects(deleteItemDaFila('tara', 'x'), (erro: unknown) => {
    assert.ok(erro instanceof Error);
    assert.match(erro.message, /item_ja_drenando/);
    return true;
  });
});
