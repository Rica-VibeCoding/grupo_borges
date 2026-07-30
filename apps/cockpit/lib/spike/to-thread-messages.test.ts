// Teste da ponte RenderItem[] → ThreadMessageLike[] (§5.1 do data-contract).
//
// Entrada: fixtures/cockpit-v2/familias/*.json — as 52 famílias REAIS gravadas
// do painel em produção, passadas por buildRenderItems. Nenhum payload inventado
// à mão nesta primeira metade.
//
// ---------------------------------------------------------------------------
// ⚠️ MEDIDO, NÃO SUPOSTO: as 52 famílias alcançam CINCO dos nove kind.
//
// Rodando buildRenderItems sobre cada fixture e sobre todas juntas, os kind que
// aparecem são: user, assistant, chip, sidechain-group e — via
// coalesceSidechainGroups sobre os 16 eventos de sidechain reais —
// sidechain-cluster. Os outros quatro são INALCANÇÁVEIS a partir das fixtures,
// e o motivo é estrutural, não preguiça:
//
//   user-internal  discrimina por `user_type === 'internal'`; as 52 fixtures
//                  são todas `external`.
//   synthetic      discrimina por `payload.meta`; nenhuma fixture tem o campo.
//   channel        discrimina pelo texto começar com `<channel source=`.
//   meta-decision  discrimina pelo texto casar META_DECISION_PATTERNS.
//
// Os dois últimos dependem do TEXTO — e o texto é exatamente o que a redação
// das fixtures substitui por placeholder para poder commitar (README das
// fixtures). Ou seja: o que torna o baseline publicável é o mesmo que apaga o
// gatilho desses dois kind.
//
// Cobrimos os quatro restantes derivando de um evento REAL e trocando SÓ o
// campo pelo qual o classificador discrimina — o formato continua sendo o
// gravado, e cada derivação diz o que mudou. Os padrões de texto vêm de
// render-items.ts, não de memória.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import type { RenderItem } from '@grupo_borges/cockpit-core/render-items';
import {
  buildRenderItems,
  buildToolResultLookup,
  coalesceSidechainGroups,
} from '@grupo_borges/cockpit-core/render-items';

import { toThreadMessages } from './to-thread-messages.ts';

const DIR_FIXTURES = join(import.meta.dirname, '../../../../fixtures/cockpit-v2/familias');

type Fixture = { familia: string; ocorrencias: number; evento: MessagePayload };

const FIXTURES: Fixture[] = readdirSync(DIR_FIXTURES)
  .filter((f) => f.endsWith('.json') && f !== '_indice.json')
  .sort()
  .map((f) => JSON.parse(readFileSync(join(DIR_FIXTURES, f), 'utf8')) as Fixture);

const EVENTOS = FIXTURES.map((f) => f.evento);

function familia(nome: string): Fixture {
  const f = FIXTURES.find((x) => x.familia === nome);
  assert.ok(f, `fixture ausente: ${nome}`);
  return f;
}

function parts(m: ReturnType<typeof toThreadMessages>[number]) {
  assert.ok(Array.isArray(m.content), 'content deveria ser array de parts');
  return m.content as ReadonlyArray<{ type: string; [k: string]: unknown }>;
}

/** Registra qual kind cada teste exercitou, para o teste de exaustividade no fim. */
const COBERTOS = new Set<RenderItem['kind']>();
function cobre(itens: RenderItem[]) {
  for (const i of itens) COBERTOS.add(i.kind);
  return itens;
}

/* ========================================================================== */
/* 1. As 52 famílias reais                                                    */
/* ========================================================================== */

test('as 52 famílias atravessam a ponte sem lançar e saem bem formadas', () => {
  assert.equal(FIXTURES.length, 52);
  const itens = cobre(buildRenderItems(EVENTOS));
  const msgs = toThreadMessages(itens, buildToolResultLookup(EVENTOS));

  assert.equal(msgs.length, itens.length, 'a ponte é 1:1 — nem agrupa nem descarta');
  for (const m of msgs) {
    assert.ok(['assistant', 'user', 'system'].includes(m.role), `role inválido: ${m.role}`);
    assert.ok(typeof m.content === 'string' || Array.isArray(m.content));
    for (const p of parts(m)) {
      assert.equal(typeof p.type, 'string');
      assert.ok(p.type.length > 0);
    }
  }
});

test('as 52 famílias saem com id presente e ÚNICO', () => {
  // Não é higiene: external-store-thread-runtime-core.js:136-144 deduplica por
  // id e mantém a última ocorrência, com console.warn. Id repetido some do feed
  // — e "sumiu uma mensagem" é a última coisa que se descobre olhando a tela.
  const itens = buildRenderItems(EVENTOS);
  const ids = toThreadMessages(itens, buildToolResultLookup(EVENTOS)).map((m) => m.id);

  const semId = ids.filter((id) => !id);
  assert.deepEqual(semId, [], `${semId.length} mensagens sem id → a lib cai no índice como identidade`);
  assert.equal(new Set(ids).size, ids.length, 'id repetido: a lib descarta a ocorrência anterior');
});

test('cada família isolada também atravessa — nenhuma depende das vizinhas', () => {
  for (const f of FIXTURES) {
    const itens = cobre(buildRenderItems([f.evento]));
    assert.doesNotThrow(() => toThreadMessages(itens), `família quebrou: ${f.familia}`);
  }
});

/* ========================================================================== */
/* 2. As duas bordas do contrato                                              */
/* ========================================================================== */

test('borda content null (199 casos reais) não vira bolha vazia', () => {
  const f = familia('borda__content_none');
  assert.equal(f.ocorrencias, 199);
  // A borda é o objeto `message` inteiro vindo null — não um content vazio
  // dentro de uma mensagem. O nome "content null" no baseline é o rótulo da
  // família; no disco o que vem null é o corpo todo.
  assert.equal(f.evento.message, null, 'a borda é o evento SEM corpo');

  const itens = buildRenderItems([f.evento]);
  assert.deepEqual(itens, [], 'evento sem corpo não gera RenderItem');
  assert.deepEqual(toThreadMessages(itens), [], 'e não gera mensagem nenhuma');
});

test('borda content null: se um item vazio chegar à ponte, sai content [] e não crash', () => {
  // Defesa da própria ponte, separada do caminho acima: buildRenderItems já
  // filtra, mas a ponte não pode depender disso para não estourar.
  const base = familia('bloco__text').evento;
  const item: RenderItem = { kind: 'assistant', payload: base, parts: [] };
  const [m] = toThreadMessages([item]);
  assert.equal(m.role, 'assistant');
  assert.deepEqual(m.content, []);
});

test('borda content string (87 casos reais) vira UM part de texto, não quebra em pedaços', () => {
  const f = familia('borda__content_string');
  assert.equal(f.ocorrencias, 87);
  const bruto = f.evento.message?.content;
  assert.equal(typeof bruto, 'string', 'a borda é content string em vez de array');

  const itens = cobre(buildRenderItems([f.evento]));
  const [m] = toThreadMessages(itens);
  assert.equal(m.role, 'user');
  const ps = parts(m);
  assert.equal(ps.length, 1, 'string vira um bloco só');
  assert.equal(ps[0].type, 'text');
  assert.equal(ps[0].text, bruto);
});

/* ========================================================================== */
/* 3. Os kind que as fixtures alcançam                                        */
/* ========================================================================== */

test('user → role user com part de texto', () => {
  const itens = cobre(buildRenderItems(EVENTOS)).filter((i) => i.kind === 'user');
  assert.ok(itens.length > 0);
  const [m] = toThreadMessages([itens[0]]);
  assert.equal(m.role, 'user');
  assert.equal(parts(m)[0].type, 'text');
  assert.ok(m.id, 'id vem do uuid do payload');
  assert.ok(m.createdAt instanceof Date);
});

test('assistant → text vira text, thinking vira reasoning, tool_use vira tool-call', () => {
  const itens = cobre(buildRenderItems(EVENTOS)).filter((i) => i.kind === 'assistant');
  const msgs = toThreadMessages(itens, buildToolResultLookup(EVENTOS));
  const tipos = new Set(msgs.flatMap((m) => parts(m).map((p) => p.type)));

  assert.ok(tipos.has('text'), 'nenhum part de texto nas fixtures de assistant');
  assert.ok(tipos.has('reasoning'), 'thinking tinha de virar reasoning');
  assert.ok(tipos.has('tool-call'), 'tool_use tinha de virar tool-call');
  for (const t of tipos) assert.ok(['text', 'reasoning', 'tool-call'].includes(t), `tipo inesperado: ${t}`);
});

test('tool-call carrega toolName e args do tool_use real', () => {
  const itens = buildRenderItems(EVENTOS).filter((i) => i.kind === 'assistant');
  const chamadas = toThreadMessages(itens, buildToolResultLookup(EVENTOS))
    .flatMap((m) => parts(m))
    .filter((p) => p.type === 'tool-call');

  assert.ok(chamadas.length >= 10, `esperava as ~12 chamadas das fixtures, vi ${chamadas.length}`);
  for (const c of chamadas) {
    assert.equal(typeof c.toolName, 'string');
    assert.ok((c.toolName as string).length > 0, 'toolName vazio');
    assert.equal(typeof c.toolCallId, 'string');
    if (c.args !== undefined) assert.equal(typeof c.args, 'object');
  }
});

test('tool-call recebe result e isError quando o lookup tem o par', () => {
  // O encaixe que justifica a ponte: hoje o tool_use_result rico é descartado.
  const parToolUse = FIXTURES.find((f) => {
    const c = f.evento.message?.content;
    return Array.isArray(c) && c.some((p) => p.type === 'tool_use');
  });
  assert.ok(parToolUse);

  const resultado = familia('bloco__tool_result').evento;
  const usos = parToolUse.evento.message?.content as Array<{ type: string; id?: string }>;
  const uso = usos.find((p) => p.type === 'tool_use');
  assert.ok(uso?.id);

  // Um evento REAL de tool_result, reapontado para o tool_use REAL do par acima:
  // muda só o tool_use_id, que é o que casa os dois.
  const conteudoOriginal = (resultado.message?.content ?? []) as Array<Record<string, unknown>>;
  const casado: MessagePayload = {
    ...resultado,
    message: {
      ...resultado.message!,
      content: conteudoOriginal.map((p) => ({ ...p, tool_use_id: uso.id })),
    },
  } as MessagePayload;

  const lookup = buildToolResultLookup([parToolUse.evento, casado]);
  assert.ok(lookup.has(uso.id!), 'o lookup do core não casou o par');

  const chamada = toThreadMessages(buildRenderItems([parToolUse.evento]), lookup)
    .flatMap((m) => parts(m))
    .find((p) => p.type === 'tool-call' && p.toolCallId === uso.id);

  assert.ok(chamada, 'tool-call sumiu');
  assert.equal(typeof chamada.result, 'string');
  assert.equal(chamada.isError, false);
});

test('chip não-tool → data-chip', () => {
  const itens = cobre(buildRenderItems(EVENTOS)).filter((i) => i.kind === 'chip');
  assert.ok(itens.length > 0, 'nenhum chip nas fixtures');
  const [m] = toThreadMessages(itens);
  const p = parts(m)[0];
  assert.equal(p.type, 'data-chip');
  const d = p.data as { classifierKind: string; chip: { label: string } };
  assert.notEqual(d.classifierKind, 'tool', 'esta fixture é a de chip NÃO-tool');
  assert.ok(d.chip.label.length > 0);
});

test('sidechain-group e sidechain-cluster → data-sidechain, com a forma distinguível', () => {
  const sidechain = EVENTOS.filter((e) => e.is_sidechain);
  assert.ok(sidechain.length >= 10, `esperava os 16 eventos de sidechain, vi ${sidechain.length}`);

  const grupos = cobre(buildRenderItems(sidechain));
  const pg = parts(toThreadMessages(grupos.filter((i) => i.kind === 'sidechain-group'))[0])[0];
  assert.equal(pg.type, 'data-sidechain');
  assert.equal((pg.data as { forma: string }).forma, 'group');

  const clusters = cobre(coalesceSidechainGroups(grupos)).filter((i) => i.kind === 'sidechain-cluster');
  assert.ok(clusters.length > 0, 'coalesce não produziu cluster a partir dos grupos reais');
  const pc = parts(toThreadMessages(clusters)[0])[0];
  assert.equal(pc.type, 'data-sidechain');
  assert.equal((pc.data as { forma: string }).forma, 'cluster');
});

/* ========================================================================== */
/* 4. Os kind que a redação das fixtures apagou — derivados de evento real     */
/* ========================================================================== */

/** Evento real de usuário, com UM campo trocado. O que muda vai no nome. */
function derivaDeUser(mudanca: Partial<MessagePayload>, texto?: string): MessagePayload {
  const base = familia('borda__content_string').evento;
  return {
    ...base,
    ...mudanca,
    message: texto === undefined ? base.message : { ...base.message!, content: texto },
  } as MessagePayload;
}

test('user-internal (trocando só user_type) → texto preservado + marcador data-internal', () => {
  const itens = cobre(buildRenderItems([derivaDeUser({ user_type: 'internal' })]));
  assert.deepEqual(itens.map((i) => i.kind), ['user-internal']);

  const [m] = toThreadMessages(itens);
  assert.equal(m.role, 'user');
  const ps = parts(m);
  assert.equal(ps[0].type, 'text', 'o texto não pode ser trocado pelo marcador');
  assert.equal(ps[1].type, 'data-internal');
});

test('synthetic (anexando só payload.meta) → data-synthetic', () => {
  const itens = cobre(buildRenderItems([
    derivaDeUser({ meta: { kind: 'wakeup-cron', raw_text: '<<autonomous-loop>>' } }),
  ]));
  assert.deepEqual(itens.map((i) => i.kind), ['synthetic']);

  const p = parts(toThreadMessages(itens)[0])[0];
  assert.equal(p.type, 'data-synthetic');
  assert.equal((p.data as { syntheticKind: string }).syntheticKind, 'wakeup-cron');
});

test('channel (texto no prefixo de LOOKS_LIKE_CHANNEL_RE) → data-channel', () => {
  // O prefixo vem de render-items.ts:87, não de memória.
  const itens = cobre(buildRenderItems([
    derivaDeUser({}, '<channel source="telegram" chat_id="1">oi</channel>'),
  ]));
  assert.deepEqual(itens.map((i) => i.kind), ['channel']);
  assert.equal(parts(toThreadMessages(itens)[0])[0].type, 'data-channel');
});

test('meta-decision (texto casando META_DECISION_PATTERNS) → data-meta', () => {
  // Padrão copiado de render-items.ts:104-110.
  const base = familia('bloco__text').evento;
  const evento = {
    ...base,
    message: { ...base.message!, role: 'assistant', content: 'Eco do meu próprio envio, ignorando.' },
  } as MessagePayload;

  const itens = cobre(buildRenderItems([evento]));
  assert.deepEqual(itens.map((i) => i.kind), ['meta-decision']);
  const p = parts(toThreadMessages(itens)[0])[0];
  assert.equal(p.type, 'data-meta');
  assert.equal(toThreadMessages(itens)[0].role, 'assistant');
});

test('chip de tool → tool-call nativo com o toolName do tool_use, não o rótulo do chip', () => {
  // O classifier só vira chip de tool quando o corpo do resultado passa de 300
  // caracteres (chat-payload-classifier.ts:217) — daí o resultado longo.
  const parToolUse = FIXTURES.find((f) => {
    const c = f.evento.message?.content;
    return Array.isArray(c) && c.some((p) => p.type === 'tool_use') && f.evento.kind === 'assistant';
  });
  assert.ok(parToolUse);
  const usos = parToolUse.evento.message?.content as Array<{ type: string; id?: string; name?: string }>;
  const uso = usos.find((p) => p.type === 'tool_use')!;

  const resultado = familia('bloco__tool_result').evento;
  const longo: MessagePayload = {
    ...resultado,
    uuid: 'derivado-tool-result',
    message: {
      ...resultado.message!,
      content: [{ type: 'tool_result', tool_use_id: uso.id, content: 'x'.repeat(400) }],
    },
  } as MessagePayload;

  const itens = cobre(buildRenderItems([parToolUse.evento, longo]));
  const chip = itens.find((i) => i.kind === 'chip' && i.classifierKind === 'tool');
  assert.ok(chip, 'não virou chip de tool — o corte de 300 chars mudou?');

  const p = parts(toThreadMessages([chip])[0])[0];
  assert.equal(p.type, 'tool-call');
  assert.equal(p.toolName, uso.name, 'toolName tem de ser o nome real, não chip.label');
  assert.equal(typeof p.result, 'string');
  assert.equal(p.isError, false);
});

/* ========================================================================== */
/* 5. Exaustividade — o teste que quebra quando alguém acrescenta um kind      */
/* ========================================================================== */

test('ask-user: décimo kind, ratificado como data-ask-user, com id e createdAt do entry', () => {
  // O §5.1 nasceu com nove kind; o union tem dez. Ratificado em 27064af: o que
  // a lib não modela vira data-*. Não sai de buildRenderItems (entra por
  // mergeAskUserItems, do SSE `ask_user`), então não aparece nas fixtures.
  const item = {
    kind: 'ask-user',
    entry: { request_id: 'req-1', status: 'pending', questions: [], created_at_ms: 1_700_000_000_000 },
  } satisfies RenderItem;
  COBERTOS.add('ask-user');

  const [m] = toThreadMessages([item]);
  const p = parts(m)[0];
  assert.equal(p.type, 'data-ask-user');
  // Sem id a lib gera um por conversão e o card remonta a cada flush — falso
  // positivo de G4 que só apareceria na medição.
  assert.equal(m.id, 'req-1');
  assert.equal(m.createdAt?.getTime(), 1_700_000_000_000);
});

test('uuid vazio cai no id numérico, mesma régua do messageRef do classificador', () => {
  // uuid vazio é caso real, não hipótese: o core se defende dele em
  // chat-payload-classifier.ts:236 com `msg.uuid || String(msg.id)`. Sem o
  // fallback, a mensagem sai sem id e a identidade passa a ser gerada pela lib.
  const itens = buildRenderItems([derivaDeUser({ uuid: '', id: 4242 })]);
  assert.equal(itens.length, 1);
  const [m] = toThreadMessages(itens);
  assert.equal(m.id, '4242');

  // e o caminho normal continua usando o uuid
  const [normal] = toThreadMessages(buildRenderItems([derivaDeUser({ uuid: 'u-1', id: 4242 })]));
  assert.equal(normal.id, 'u-1');
});

test('todos os dez kind do union têm conversão coberta por teste', () => {
  const todos: RenderItem['kind'][] = [
    'user', 'user-internal', 'synthetic', 'channel', 'assistant',
    'meta-decision', 'chip', 'sidechain-group', 'sidechain-cluster', 'ask-user',
  ];
  const faltando = todos.filter((k) => !COBERTOS.has(k));
  assert.deepEqual(faltando, [], `kind sem cobertura: ${faltando.join(', ')}`);
});
