import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyMessage, ehMensagemResumoCompact } from './chat-payload-classifier.ts';
import type { MessagePayload } from './messages-types.ts';
import { buildRenderItems } from './render-items.ts';

// O cabeçalho real, copiado dos JSONL da frota (12/12 resumos amostrados em
// 02/08 começam EXATAMENTE assim). O corpo é longo — dezenas de linhas — e é
// ele que o "ver resumo" do cartão expande.
const RESUMO_REAL =
  'This session is being continued from a previous conversation that ran out of context. ' +
  'The summary below covers the earlier portion of the conversation.\n\n' +
  'Summary:\n1. Primary Request and Intent:\n   The user (Rica) made three requests…\n';

const baseMessage = {
  id: 1,
  kind: 'user',
  uuid: 'uuid-1',
  parent_uuid: null,
  session_id: 'session-1',
  is_sidechain: false,
  user_type: 'external',
  timestamp: '2026-08-02T00:00:00.000Z',
  created_at: 1,
} satisfies Omit<MessagePayload, 'message'>;

function userText(id: number, content: string): MessagePayload {
  return {
    ...baseMessage,
    id,
    uuid: `uuid-${id}`,
    kind: 'user',
    message: { role: 'user', content },
  };
}

test('classifyMessage — resumo de compact pelo PREFIXO do corpo vira compact-summary', () => {
  // É o caminho que atravessa hoje: o back descarta o `isCompactSummary` na
  // serialização canônica, e o corpo é o que chega.
  const payload = classifyMessage(userText(1, RESUMO_REAL));
  assert.equal(payload.kind, 'compact-summary');
  if (payload.kind !== 'compact-summary') return;
  // O resumo vai INTEIRO pro expandBody — o cartão é que decide fechar.
  assert.equal(payload.expandBody, RESUMO_REAL.trim());
  assert.equal(payload.compactMeta, undefined);
});

test('classifyMessage — a flag isCompactSummary basta, mesmo com corpo fora do padrão', () => {
  // O dia em que o back repassar a marca oficial, a detecção não depende mais
  // do texto — e um resumo com cabeçalho reformulado pelo CC continua preso.
  const msg = {
    ...userText(2, 'Resumo da conversa anterior, em formato novo.'),
    isCompactSummary: true,
  } as MessagePayload;
  assert.equal(ehMensagemResumoCompact(msg), true);
  assert.equal(classifyMessage(msg).kind, 'compact-summary');
});

test('classifyMessage — compactMetadata é lido quando existe, omitido quando não', () => {
  const comMeta = {
    ...userText(3, RESUMO_REAL),
    compactMetadata: { preTokens: 222_000, postTokens: 13_000, trigger: 'manual' },
  } as MessagePayload;
  const payload = classifyMessage(comMeta);
  assert.equal(payload.kind, 'compact-summary');
  if (payload.kind === 'compact-summary') {
    assert.deepEqual(payload.compactMeta, { preTokens: 222_000, postTokens: 13_000, trigger: 'manual' });
  }

  // Metadado malformado não derruba a classificação nem emite placeholder.
  const metaQuebrada = {
    ...userText(4, RESUMO_REAL),
    compactMetadata: { preTokens: 'muitos' },
  } as MessagePayload;
  const semMeta = classifyMessage(metaQuebrada);
  assert.equal(semMeta.kind, 'compact-summary');
  if (semMeta.kind === 'compact-summary') {
    assert.equal(semMeta.compactMeta, undefined);
  }
});

test('classifyMessage — quem CITA a frase no meio de um texto não casa', () => {
  const citacao = userText(
    5,
    'o resumo começa com "This session is being continued from a previous conversation that ran out of context" — vi no log',
  );
  assert.equal(ehMensagemResumoCompact(citacao), false);
  assert.equal(classifyMessage(citacao).kind, 'plain');
});

test('classifyMessage — texto normal do Rica continua plain', () => {
  assert.equal(classifyMessage(userText(6, 'manda balanço')).kind, 'plain');
});

test('buildRenderItems — compact-summary vira item próprio, nunca bolha do Rica', () => {
  const items = buildRenderItems([userText(7, RESUMO_REAL)]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'compact-summary');
  if (items[0].kind === 'compact-summary') {
    assert.equal(items[0].text, RESUMO_REAL.trim());
    assert.equal(items[0].compactMeta, undefined);
  }
});
