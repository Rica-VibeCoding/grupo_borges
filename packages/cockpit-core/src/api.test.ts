import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { AgentInputError, postAgentInput } from './api.ts';

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
