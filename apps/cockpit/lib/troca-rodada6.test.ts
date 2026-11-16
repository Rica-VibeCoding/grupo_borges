import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { ConversasResponse, OperacaoDeConversa } from '@grupo_borges/cockpit-core/api';
import { acompanhaTroca } from './leitor-da-troca.ts';
import { CONFERE_ERRO_MS, PRAZO_DA_TROCA_MS } from './regua-da-troca.ts';
import * as troca from './troca-em-curso.ts';

const pedido = { tipo: 'retomar' as const, alvo: 'destino', forcar: false, desligado: false };
const op = (id: string | null, fase: troca.Operacao['fase']): OperacaoDeConversa => ({ id, fase, desde: null, session_id: null, detalhe: 'erro' });
const lista = (id: string) => ({ conversas: [{ id, atual: true }] }) as ConversasResponse;
const drena = () => new Promise<void>((r) => setImmediate(r));
function memoria() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
function encerra() {
  troca.comecarTroca('pavan', pedido, 0, 'encerrada');
  troca.conversaTrocada('pavan', { operacaoId: 'encerrada', sessionId: 'origem' }, 1);
  troca.dispensaTroca('pavan');
}
beforeEach(() => troca.limpaTrocasNoChat());
for (const post of ['morto', 'pendente'] as const) {
  test(`R6.1: leitura encerrada chega à regra c/prazo do POST ${post}`, () => {
    encerra();
    troca.comecarTroca('pavan', pedido, 100, 'cliente');
    if (post === 'morto') troca.postMorreu('pavan', 'cliente', 200);
    troca.operacaoLida('pavan', troca.carimboDaLeitura('pavan'), op('encerrada', 'pronta'), post === 'morto' ? 15_100 : 100 + PRAZO_DA_TROCA_MS);
    assert.equal(troca.leTroca('pavan')?.fase, 'conferindo');
    assert.ok(troca.leTroca('pavan')?.conferencia?.erro);
  });
}
for (const atual of ['origem', 'destino']) {
  test(`R6.1: 409 de id encerrado resolve pela lista ${atual}`, () => {
    encerra();
    troca.comecarTroca('pavan', pedido, 100, 'cliente');
    troca.postRecusado('pavan', 'cliente', 'operacao_em_curso', 200);
    troca.operacaoLida('pavan', troca.carimboDaLeitura('pavan'), op('encerrada', 'religando'), 300);
    assert.notEqual(troca.leTroca('pavan')?.post, 'adotando');
    assert.notEqual(troca.leTroca('pavan')?.id, 'encerrada');
    troca.confereTroca('pavan', { atual, sessao: atual }, 300 + CONFERE_ERRO_MS);
    assert.equal(troca.leTroca('pavan')?.fase, atual === 'destino' ? 'concluida' : 'falhou');
  });
}
for (const fase of [null, 'pronta', 'erro', 'religando'] as const) {
  test(`R6.2: chave do HEAD é descartada; /operacao ${fase} decide espera`, () => {
    const guarda = memoria();
    guarda.setItem('ck-conversa-troca:pavan', JSON.stringify(pedido));
    troca.restauraTroca('pavan', guarda, 100);
    assert.equal(troca.leTroca('pavan'), null);
    assert.equal(guarda.getItem('ck-conversa-troca:pavan'), null);
    troca.operacaoLida('pavan', troca.carimboDaLeitura('pavan'), op('externa', fase), 200);
    assert.equal(troca.leTroca('pavan')?.fase ?? null, fase === 'religando' ? 'esperando' : null);
  });
}
for (const falha of ['erro', 'teto'] as const) {
  test(`R6.4: lista com ${falha} depois de ate encerra conferência de erro`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 20_000 });
    troca.comecarTroca('pavan', pedido, 100, 'cliente');
    troca.postRespondeu('pavan', 'cliente', op('cliente', 'erro'), 200);
    const solta = acompanhaTroca('pavan', { operacao: async () => op('cliente', 'erro'), lista: () => {
      if (falha === 'erro') return Promise.reject(new Error('lista indisponível'));
      return new Promise(() => {});
    } });
    try {
      await drena();
      if (falha === 'teto') { t.mock.timers.tick(5_000); await drena(); }
      assert.equal(troca.leTroca('pavan')?.fase, 'falhou');
    } finally { solta(); }
  });
}
test('R6.4: lista tem cinco segundos próprios após operação lenta', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 20_000 });
  troca.comecarTroca('pavan', pedido, 100, 'cliente');
  troca.postRespondeu('pavan', 'cliente', op('cliente', 'erro'), 200);
  let resolveOp!: (o: OperacaoDeConversa) => void;
  let resolveLista!: (l: ConversasResponse) => void;
  let sinal: AbortSignal | undefined;
  const solta = acompanhaTroca('pavan', {
    operacao: () => new Promise((r) => { resolveOp = r; }),
    lista: (_s, s) => { sinal = s; return new Promise((r) => { resolveLista = r; }); },
  });
  try {
    t.mock.timers.tick(4_500);
    resolveOp(op('cliente', 'erro'));
    await drena();
    t.mock.timers.tick(4_500);
    assert.equal(sinal?.aborted, false);
    resolveLista(lista('destino'));
    await drena();
    assert.equal(troca.leTroca('pavan')?.conferencia?.erro, null);
  } finally { solta(); }
});
test('R6.5: pronta some do chat em 2 s, Histórico conserva seus 20 s', () => {
  troca.comecarTroca('pavan', pedido, 100, 'cliente');
  troca.postRespondeu('pavan', 'cliente', op('cliente', 'pronta'), 200);
  troca.confereTroca('pavan', {}, 2_199);
  assert.equal(troca.leTrocaNoChat('pavan')?.fase, 'pronta');
  troca.confereTroca('pavan', {}, 2_200);
  assert.equal(troca.leTrocaNoChat('pavan'), null);
  assert.equal(troca.leTroca('pavan')?.fase, 'conferindo');
  troca.operacaoLida('pavan', troca.carimboDaLeitura('pavan'), op('cliente', 'pronta'), 3_000);
  assert.equal(troca.leTrocaNoChat('pavan'), null);
});
test('R6.6: abrir Histórico com chat ocioso relê operação externa uma vez', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100 });
  let externa = false;
  let chamadas = 0;
  const rede = { operacao: async () => { chamadas++; return op(externa ? 'externa' : null, externa ? 'religando' : null); }, lista: async () => lista('origem') };
  const chat = acompanhaTroca('pavan', rede);
  await drena();
  assert.equal(chamadas, 1);
  externa = true;
  const historico = acompanhaTroca('pavan', rede, true);
  try {
    await drena();
    assert.equal(chamadas, 2);
    assert.equal(troca.leTroca('pavan')?.id, 'externa');
    assert.equal(troca.leTroca('pavan')?.fase, 'esperando');
  } finally { historico(); chat(); }
});
test('R6.6: Histórico descobre externa após troca concluída ainda no store', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100 });
  encerra();
  troca.comecarTroca('pavan', pedido, 10, 'ultima');
  troca.conversaTrocada('pavan', { operacaoId: 'ultima', sessionId: 'destino' }, 20);
  const solta = acompanhaTroca('pavan', { operacao: async () => op('externa', 'religando'), lista: async () => lista('origem') }, true);
  try {
    await drena();
    assert.equal(troca.leTroca('pavan')?.id, 'externa');
    assert.equal(troca.leTroca('pavan')?.fase, 'esperando');
  } finally { solta(); }
});
test('R6.7: começo e descoberta externa funcionam sem crypto.randomUUID', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    assert.ok(troca.comecarTroca('pavan', pedido, 100));
    troca.operacaoLida('outro', troca.carimboDaLeitura('outro'), op('externa', 'religando'), 200);
    assert.equal(troca.leTroca('outro')?.id, 'externa');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
});
for (const fim of ['concluida', 'falhou', 'recusada'] as const) {
  test(`R6.8: timers só existem entre começo e ${fim}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100 });
    const ativos = new Set<ReturnType<typeof setInterval>>();
    const agenda = globalThis.setInterval;
    const limpa = globalThis.clearInterval;
    t.mock.method(globalThis, 'setInterval', (...args: Parameters<typeof setInterval>) => {
      const id = agenda(...args);
      ativos.add(id);
      return id;
    });
    t.mock.method(globalThis, 'clearInterval', (id: ReturnType<typeof setInterval>) => { ativos.delete(id); limpa(id); });
    let chamadas = 0;
    const solta = acompanhaTroca('pavan', { operacao: async () => { chamadas++; return op(null, null); }, lista: async () => lista('origem') });
    try {
      await drena();
      assert.equal(ativos.size, 0);
      troca.comecarTroca('pavan', pedido, 100, 'cliente');
      assert.equal(ativos.size, 2);
      if (fim === 'concluida') troca.conversaTrocada('pavan', { operacaoId: 'cliente', sessionId: 'destino' }, 200);
      else if (fim === 'recusada') troca.postRecusado('pavan', 'cliente', 'ocupado', 200);
      else {
        troca.postRespondeu('pavan', 'cliente', op('cliente', 'erro'), 200);
        troca.confereTroca('pavan', { atual: 'origem' }, 200 + CONFERE_ERRO_MS);
      }
      assert.equal(ativos.size, 0);
      const antes = chamadas;
      t.mock.timers.tick(10_000);
      await drena();
      assert.equal(chamadas, antes);
      troca.comecarTroca('pavan', pedido, 20_000, 'seguinte');
      assert.equal(ativos.size, 2);
    } finally { solta(); }
    assert.equal(ativos.size, 0);
  });
}
test('R6.9: persistência conserva só os últimos 20 ids encerrados', () => {
  const guarda = memoria();
  troca.restauraTroca('pavan', guarda, 0);
  for (let i = 0; i < 25; i++) {
    const id = `cliente-${i}`;
    troca.comecarTroca('pavan', pedido, i * 100, id);
    troca.conversaTrocada('pavan', { operacaoId: id, sessionId: 'destino' }, i * 100 + 1);
  }
  const ids = JSON.parse(guarda.getItem('ck-conversa-troca:pavan:encerradas')!);
  assert.deepEqual(ids, Array.from({ length: 20 }, (_v, i) => `cliente-${i + 5}`));
  troca.limpaTrocasNoChat();
  troca.restauraTroca('pavan', guarda, 3_000);
  troca.operacaoLida('pavan', troca.carimboDaLeitura('pavan'), op('cliente-24', 'religando'), 3_100);
  assert.equal(troca.leTroca('pavan'), null);
});
test('R6.9: poda também a chave sem teto deixada pela versão anterior', () => {
  const guarda = memoria();
  const ids = Array.from({ length: 25 }, (_v, i) => `cliente-${i}`);
  guarda.setItem('ck-conversa-troca:pavan:encerradas', JSON.stringify(ids));
  troca.restauraTroca('pavan', guarda, 100);
  assert.deepEqual(JSON.parse(guarda.getItem('ck-conversa-troca:pavan:encerradas')!), ids.slice(-20));
});
test('R6.6: Histórico agenda sua leitura após um GET anterior ainda em voo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100 });
  let resolve!: (o: OperacaoDeConversa) => void;
  let chamadas = 0;
  const rede = { operacao: () => ++chamadas === 1 ? new Promise<OperacaoDeConversa>((r) => { resolve = r; }) : Promise.resolve(op('externa', 'religando')),
    lista: async () => lista('origem') };
  const chat = acompanhaTroca('pavan', rede);
  const historico = acompanhaTroca('pavan', rede, true);
  try {
    assert.equal(chamadas, 1, 'não sobrepõe requests');
    resolve(op(null, null));
    await drena();
    assert.equal(chamadas, 2, 'GET iniciado antes da montagem não substitui a nova leitura');
    assert.equal(troca.leTroca('pavan')?.id, 'externa');
  } finally { historico(); chat(); }
});
test('R6.5: leitor encerra pronta exatamente em 2 s mesmo fora do tick de 250 ms', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100 });
  troca.comecarTroca('pavan', pedido, 100, 'cliente');
  const solta = acompanhaTroca('pavan', { operacao: () => new Promise(() => {}), lista: async () => lista('origem') });
  try {
    t.mock.timers.tick(123);
    troca.postRespondeu('pavan', 'cliente', op('cliente', 'pronta'));
    t.mock.timers.tick(1_999);
    assert.equal(troca.leTrocaNoChat('pavan')?.fase, 'pronta');
    t.mock.timers.tick(1);
    assert.equal(troca.leTrocaNoChat('pavan'), null);
    assert.equal(troca.leTroca('pavan')?.fase, 'conferindo');
  } finally { solta(); await drena(); }
});
