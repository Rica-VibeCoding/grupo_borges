import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import {
  buildRenderItems,
  coalesceSidechainGroups,
} from '@grupo_borges/cockpit-core/render-items';

import { agrupaFerramentas } from '../../components/feed/grupo-ferramentas.ts';
import { temConteudoVisivel } from './conteudo-visivel.ts';
import {
  createIncrementalRenderItems,
  incrementalRenderItemsStats,
} from './render-items-incremental.ts';

const FIXTURE_DIR = join(import.meta.dirname, '../../../../fixtures/cockpit-v2/familias');
type Fixture = { familia: string; ocorrencias: number; evento: MessagePayload };
const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith('.json') && file !== '_indice.json')
  .sort()
  .map((file) => JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as Fixture);

// O pipeline de produto inteiro, na ordem: o que não tem conteúdo não desenha
// (temConteudoVisivel), sidechains agrupam, linhas de trabalho agrupam (§7).
// O incremental tem de ser idêntico a isto em CADA prefixo — é a régua do teste.
function full(messages: readonly MessagePayload[]) {
  return agrupaFerramentas(
    coalesceSidechainGroups(buildRenderItems([...messages]).filter(temConteudoVisivel)),
  );
}

test('é idêntico ao rebuild completo em cada prefixo das 52 famílias reais', () => {
  assert.equal(fixtures.length, 52);
  const incremental = createIncrementalRenderItems();
  const messages = fixtures.map((fixture) => fixture.evento);

  for (let length = 0; length <= messages.length; length++) {
    assert.deepEqual(
      incremental.update(messages.slice(0, length)),
      full(messages.slice(0, length)),
      `divergência no prefixo ${length} (${fixtures[length - 1]?.familia ?? 'vazio'})`,
    );
  }
});

test('preserva as duas bordas obrigatórias: corpo null (199) e content string (87)', () => {
  const selected = ['borda__content_none', 'borda__content_string'].map((name) => {
    const fixture = fixtures.find((candidate) => candidate.familia === name);
    assert.ok(fixture, `fixture ausente: ${name}`);
    return fixture;
  });
  assert.equal(selected[0].ocorrencias, 199);
  assert.equal(selected[0].evento.message, null);
  assert.equal(selected[1].ocorrencias, 87);
  assert.equal(typeof selected[1].evento.message?.content, 'string');

  const incremental = createIncrementalRenderItems();
  for (let length = 1; length <= selected.length; length++) {
    const prefix = selected.slice(0, length).map((fixture) => fixture.evento);
    assert.deepEqual(incremental.update(prefix), full(prefix));
  }
});

test('reabre lookahead de Skill e o item seguinte consumido', () => {
  const skill = fixtures.find((fixture) => fixture.familia === 'tool__Skill')?.evento;
  const next = fixtures.find(
    (fixture) => fixture.evento.kind === 'assistant' && !fixture.evento.is_sidechain,
  )?.evento;
  assert.ok(skill);
  assert.ok(next);
  const incremental = createIncrementalRenderItems();
  assert.deepEqual(incremental.update([skill]), full([skill]));
  assert.deepEqual(incremental.update([skill, next]), full([skill, next]));
});

test('novo grupo lateral estende run já coalescido', () => {
  const sidechains = fixtures
    .filter((fixture) => fixture.evento.is_sidechain)
    .slice(0, 3)
    .map((fixture) => fixture.evento);
  assert.equal(sidechains.length, 3);
  const incremental = createIncrementalRenderItems();
  for (let length = 1; length <= sidechains.length; length++) {
    const prefix = sidechains.slice(0, length);
    assert.deepEqual(incremental.update(prefix), full(prefix));
  }
});

// tropa_task e615c350. A bolha da fila nasce dezenas de mensagens antes do
// eco, então ela está SEMPRE na parte estável quando ele chega — sem o rewind
// a cauda não vê o par, e o Rica lê a própria frase duas vezes.
test('fila e eco: o rewind mantém a paridade com o rebuild em cada prefixo', () => {
  const trabalho = fixtures.find((fixture) => fixture.evento.kind === 'assistant' && !fixture.evento.is_sidechain);
  assert.ok(trabalho);
  const enfileirada = {
    ...trabalho.evento,
    id: 7_000_001,
    kind: 'queued',
    uuid: '',
    message: null,
    content: 'tem mandei um anexo',
  } as unknown as MessagePayload;
  const eco = {
    ...trabalho.evento,
    id: 7_000_003,
    kind: 'user',
    uuid: 'eco-da-fila',
    message: { role: 'user', content: 'tem mandei um anexo' },
  } as unknown as MessagePayload;
  const meio = { ...trabalho.evento, id: 7_000_002, uuid: 'turno-em-curso' };

  const messages = [enfileirada, meio, eco];
  const incremental = createIncrementalRenderItems();
  for (let length = 1; length <= messages.length; length++) {
    const prefix = messages.slice(0, length);
    assert.deepEqual(incremental.update(prefix), full(prefix), `divergência no prefixo ${length}`);
  }
  // A régua do produto, não só a do oráculo: uma bolha, e sem a marca depois
  // que o turno consumiu a frase.
  const bolhas = incremental.update(messages).filter((item) => item.kind === 'user');
  assert.equal(bolhas.length, 1);
  assert.equal(bolhas[0].kind === 'user' && bolhas[0].enfileirada, undefined);
});

// O caminho que o canário mostrou ao vivo em 07/08: a fila drenou DENTRO do
// turno, o CLI gravou `queue-operation remove` e nenhuma linha `user`. Quem
// tira a marca aqui é o fim do turno, e ele chega numa cauda posterior.
test('fila drenada sem eco: o fim do turno tira a marca na cauda seguinte', () => {
  const trabalho = fixtures.find((fixture) => fixture.evento.kind === 'assistant' && !fixture.evento.is_sidechain);
  assert.ok(trabalho);
  const enfileirada = {
    ...trabalho.evento,
    id: 7_100_001,
    kind: 'queued',
    uuid: '',
    message: null,
    content: 'tem mandei um anexo',
  } as unknown as MessagePayload;
  const fimDoTurno = {
    ...trabalho.evento,
    id: 7_100_002,
    uuid: 'fim-do-turno',
    message: { role: 'assistant', stop_reason: 'end_turn', content: 'terminei' },
  } as unknown as MessagePayload;

  const incremental = createIncrementalRenderItems();
  const marcada = incremental.update([enfileirada]).filter((item) => item.kind === 'user');
  assert.equal(marcada.length, 1);
  assert.equal(marcada[0].kind === 'user' && marcada[0].enfileirada, true);

  const messages = [enfileirada, fimDoTurno];
  assert.deepEqual(incremental.update(messages), full(messages));
  const depois = incremental.update(messages).filter((item) => item.kind === 'user');
  assert.equal(depois.length, 1);
  assert.equal(depois[0].kind === 'user' && depois[0].enfileirada, undefined);
});

test('reprocessa somente a cauda em 1.040+ mensagens', () => {
  const source = fixtures.find((fixture) => !fixture.evento.is_sidechain)?.evento;
  assert.ok(source);
  const messages = Array.from({ length: 1_041 }, (_, index): MessagePayload => ({
    ...source,
    id: 1_000_000 + index,
    uuid: `incremental-cost-${index}`,
    parent_uuid: null,
  }));
  const incremental = createIncrementalRenderItems();
  incremental.update(messages.slice(0, 1_040));
  incremental.update(messages);

  const stats = incrementalRenderItemsStats(incremental);
  assert.ok(stats);
  assert.deepEqual(stats, { reprocessedMessages: 2, totalMessages: 1_041 });
  assert.deepEqual(incremental.update(messages), full(messages));
  console.log(
    `medição incremental: ${stats.reprocessedMessages}/${stats.totalMessages} mensagens reprocessadas no flush`,
  );
});

/* ------------------------------------------------------------------------ */
/* §7 — o grupo de ferramentas no pipeline incremental                       */
/* ------------------------------------------------------------------------ */

/** Mensagem mínima de tool_use, no molde das fixtures tool__*. Sem resultado
 *  casado na mensagem seguinte, o classificador a mantém `plain` — ela vira
 *  item `assistant` só de tool_use, que é como TODA ferramenta aparece
 *  enquanto roda (e para sempre, quando a saída é curta). */
function ferramenta(indice: number, nome = 'Bash'): MessagePayload {
  return {
    id: 5_000_000 + indice,
    kind: 'assistant',
    uuid: `tool-run-${indice}`,
    parent_uuid: null,
    is_sidechain: false,
    timestamp: '2026-08-02T00:00:00Z',
    created_at: 0,
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: `tu-${indice}`, name: nome, input: { command: `cmd ${indice}` } },
      ],
    },
  } as unknown as MessagePayload;
}

/** O par que vira CHIP de ferramenta no classificador: tool_use + tool_result
 *  casado na mensagem imediatamente seguinte, com corpo > 300 caracteres
 *  (chat-payload-classifier.ts). É a minoria da conversa — 18 das 148
 *  execuções medidas em 02/08. */
function ferramentaComResultado(indice: number): MessagePayload[] {
  return [
    ferramenta(indice),
    {
      id: 5_100_000 + indice,
      kind: 'user',
      uuid: `tool-result-${indice}`,
      parent_uuid: null,
      is_sidechain: false,
      timestamp: '2026-08-02T00:00:01Z',
      created_at: 1,
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: `tu-${indice}`, content: 'saida '.repeat(60) },
        ],
      },
    } as unknown as MessagePayload,
  ];
}

test('corrida de ferramentas chegando uma por flush vira UM grupo que cresce', () => {
  const incremental = createIncrementalRenderItems();
  const messages: MessagePayload[] = [];

  for (let length = 1; length <= 6; length++) {
    messages.push(ferramenta(length));
    const itens = incremental.update(messages.slice());
    assert.deepEqual(itens, full(messages), `divergência com ${length} ferramentas`);
    if (length === 1) {
      // Uma ferramenta sozinha já é a linha discreta — não vira grupo.
      assert.equal(itens[0]?.kind, 'assistant');
    } else {
      assert.equal(itens.length, 1, `${length} ferramentas = um item só`);
      assert.equal(itens[0]?.kind, 'grupo-ferramentas');
      if (itens[0]?.kind === 'grupo-ferramentas') assert.equal(itens[0].itens.length, length);
    }
  }
});

test('chip e assistant de tool_use na MESMA corrida viram um grupo só', () => {
  // A mistura é o caso real: a ferramenta cuja saída passa de 300 caracteres
  // vira chip, as vizinhas de saída curta ficam assistant — e são a mesma
  // corrida de trabalho para quem lê.
  const incremental = createIncrementalRenderItems();
  const messages = [...ferramentaComResultado(1), ferramenta(2), ferramenta(3)];
  for (let length = 1; length <= messages.length; length++) {
    const prefix = messages.slice(0, length);
    assert.deepEqual(incremental.update(prefix), full(prefix), `prefixo ${length}`);
  }
  const itens = incremental.update(messages);
  assert.equal(itens.length, 1);
  assert.equal(itens[0]?.kind, 'grupo-ferramentas');
  if (itens[0]?.kind === 'grupo-ferramentas') {
    assert.deepEqual(
      itens[0].itens.map((item) => item.kind),
      ['chip', 'assistant', 'assistant'],
    );
  }
});

test('thinking vazio entre ferramentas não quebra a run — some do feed', () => {
  const thinkingVazio = {
    id: 5_999_999,
    kind: 'assistant',
    uuid: 'thinking-oco',
    parent_uuid: null,
    is_sidechain: false,
    timestamp: '2026-08-02T00:00:01Z',
    created_at: 1,
    message: { role: 'assistant', content: [{ type: 'thinking', thinking: '' }] },
  } as unknown as MessagePayload;

  const incremental = createIncrementalRenderItems();
  const messages = [ferramenta(1), ferramenta(2), thinkingVazio, ferramenta(3)];
  for (let length = 1; length <= messages.length; length++) {
    const prefix = messages.slice(0, length);
    assert.deepEqual(incremental.update(prefix), full(prefix), `prefixo ${length}`);
  }
  const itens = incremental.update(messages);
  assert.equal(itens.length, 1, 'thinking oco não pode virar item nem quebrar o grupo');
  assert.equal(itens[0]?.kind, 'grupo-ferramentas');
  if (itens[0]?.kind === 'grupo-ferramentas') assert.equal(itens[0].itens.length, 3);
});

test('thinking oco JUNTO do tool_use não tira a mensagem da run', () => {
  // 803 de 804 thinkings gravados não têm texto (lib/thinking.ts) — e o
  // claude-code manda thinking oco na MESMA mensagem do tool_use. Se a régua
  // olhasse a part crua em vez do que desenha, quase nenhuma corrida real
  // agrupava.
  const comThinkingOco = {
    ...ferramenta(9),
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '  \n' },
        { type: 'tool_use', id: 'tu-9', name: 'Bash', input: { command: 'cmd 9' } },
      ],
    },
  } as unknown as MessagePayload;

  const incremental = createIncrementalRenderItems();
  const messages = [ferramenta(7), comThinkingOco, ferramenta(8)];
  const itens = incremental.update(messages);
  assert.deepEqual(itens, full(messages));
  assert.equal(itens.length, 1);
  assert.equal(itens[0]?.kind, 'grupo-ferramentas');
});

test('texto entre ferramentas quebra a run em dois grupos, como o rebuild', () => {
  const texto = {
    id: 5_999_998,
    kind: 'assistant',
    uuid: 'texto-no-meio',
    parent_uuid: null,
    is_sidechain: false,
    timestamp: '2026-08-02T00:00:02Z',
    created_at: 2,
    message: { role: 'assistant', content: [{ type: 'text', text: 'vou rodar mais um' }] },
  } as unknown as MessagePayload;

  const incremental = createIncrementalRenderItems();
  const messages = [ferramenta(1), ferramenta(2), texto, ferramenta(3), ferramenta(4)];
  for (let length = 1; length <= messages.length; length++) {
    const prefix = messages.slice(0, length);
    assert.deepEqual(incremental.update(prefix), full(prefix), `prefixo ${length}`);
  }
  const kinds = incremental.update(messages).map((item) => item.kind);
  assert.deepEqual(kinds, ['grupo-ferramentas', 'assistant', 'grupo-ferramentas']);
});

test('a chave do grupo é estável enquanto ele cresce — a linha não remonta', () => {
  const incremental = createIncrementalRenderItems();
  const messages = [ferramenta(1), ferramenta(2)];
  incremental.update(messages);
  const messages3 = [...messages, ferramenta(3)];
  incremental.update(messages3);
  const messages4 = [...messages3, ferramenta(4)];
  const [grupo] = incremental.update(messages4);
  // Identidade do primeiro membro preservada: é ela que ancora a `chaveDe`
  // (`gf-${itens[0].payload.uuid}`) e o estado de aberto/fechado do componente.
  assert.equal(grupo.kind, 'grupo-ferramentas');
  if (grupo.kind === 'grupo-ferramentas') {
    assert.equal(grupo.itens[0]?.payload.uuid, 'tool-run-1');
  }
});
