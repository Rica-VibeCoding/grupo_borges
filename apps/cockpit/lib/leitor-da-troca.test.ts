import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { ConversasResponse, OperacaoDeConversa } from '@grupo_borges/cockpit-core/api';
import { acompanhaTroca, type RedeDaTroca } from './leitor-da-troca.ts';
import { comecarTroca, conversaTrocada, leTroca, limpaTrocasNoChat, postRecusado, postRespondeu,
  restauraTroca, type Operacao } from './troca-em-curso.ts';
import { CONFERE_ERRO_MS } from './regua-da-troca.ts';

const drena = () => new Promise<void>((r) => setImmediate(r));
function pendente<T>() {
  let resolve!: (t: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { resolve, promise };
}
const pedido = { tipo: 'retomar' as const, alvo: 'destino', desligado: false, forcar: false };
const op = (id: string | null, fase: Operacao['fase']): OperacaoDeConversa => ({ id, fase, session_id: null, desde: null, detalhe: 'erro' });
const lista = (id: string) => ({ conversas: [{ id, atual: true }] }) as ConversasResponse;
const semLista = async () => lista('origem');
beforeEach(() => limpaTrocasNoChat());

test('leitor único: Histórico, atalho e chat compartilham request e transferência de montagem', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100 });
  comecarTroca('pavan', pedido, 100, 'cliente');
  const resposta = pendente<OperacaoDeConversa>();
  let chamadas = 0;
  let sinal: AbortSignal | undefined;
  const rede: RedeDaTroca = { operacao: (_slug, s) => { chamadas++; sinal = s; return resposta.promise; }, lista: semLista };
  const h = acompanhaTroca('pavan', rede);
  const c = acompanhaTroca('pavan', rede);
  const d = acompanhaTroca('pavan', rede);
  try {
    assert.equal(chamadas, 0);
    t.mock.timers.tick(2_000);
    assert.equal(chamadas, 1);
    h(); h(); d();
    assert.equal(sinal?.aborted, false);
    t.mock.timers.tick(2_000);
    assert.equal(chamadas, 1, 'request em voo nunca sobrepõe outro');
    resposta.resolve(op('cliente', 'religando'));
    await drena();
    t.mock.timers.tick(2_000);
    assert.equal(chamadas, 2, 'o chat continua quando Histórico sai');
  } finally { h(); d(); c(); }
  assert.equal(sinal?.aborted, true);
});
test('leitor único: montagem anterior ao clique não fecha o POST novo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100 });
  const antiga = pendente<OperacaoDeConversa>();
  let chamadas = 0;
  const rede: RedeDaTroca = { operacao: () => ++chamadas === 1 ? antiga.promise : Promise.resolve(op('cliente', 'religando')), lista: semLista };
  const solta = acompanhaTroca('pavan', rede);
  try {
    comecarTroca('pavan', pedido, 100, 'cliente');
    antiga.resolve(op('antiga', 'pronta'));
    await drena();
    assert.equal(chamadas, 1);
    t.mock.timers.tick(2_000);
    await drena();
    assert.equal(chamadas, 2);
    assert.equal(leTroca('pavan')?.fase, 'esperando');
    assert.equal(leTroca('pavan')?.viuId, true);
  } finally { solta(); }
});
test('leitor único: GET em voo antes do aceite não transforma null antigo em sumiu', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100 });
  comecarTroca('pavan', pedido, 100, 'cliente');
  const antiga = pendente<OperacaoDeConversa>();
  let chamadas = 0;
  const rede: RedeDaTroca = { operacao: () => ++chamadas === 1 ? antiga.promise : Promise.resolve(op('cliente', 'religando')), lista: semLista };
  const solta = acompanhaTroca('pavan', rede);
  try {
    t.mock.timers.tick(2_000);
    postRespondeu('pavan', 'cliente', op('cliente', 'religando'), 200);
    antiga.resolve(op(null, null));
    await drena();
    assert.equal(chamadas, 2);
    assert.equal(leTroca('pavan')?.fase, 'esperando');
    assert.equal(leTroca('pavan')?.post, 'aceito');
  } finally { solta(); }
});
test('leitor único: só GET iniciado após 409 adota; evento anterior encerra a adoção', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100 });
  comecarTroca('pavan', pedido, 100, 'cliente');
  const antiga = pendente<OperacaoDeConversa>();
  let chamadas = 0;
  const rede: RedeDaTroca = { operacao: () => ++chamadas === 1 ? antiga.promise : Promise.resolve(op('bloqueou', 'erro')), lista: semLista };
  const solta = acompanhaTroca('pavan', rede);
  try {
    t.mock.timers.tick(2_000);
    conversaTrocada('pavan', { operacaoId: 'bloqueou', sessionId: 'destino' }, 110);
    postRecusado('pavan', 'cliente', 'operacao_em_curso', 120);
    antiga.resolve(op('anterior', 'pronta'));
    await drena();
    assert.equal(chamadas, 2);
    assert.equal(leTroca('pavan')?.id, 'bloqueou');
    assert.equal(leTroca('pavan')?.fase, 'concluida');
  } finally { solta(); }
});
test('F11 na recarga: leitor relê lista e confirma troca mesmo com /operacao em erro', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100 });
  const m = new Map<string, string>();
  const g = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  restauraTroca('pavan', g, 100);
  comecarTroca('pavan', pedido, 100, 'cliente');
  limpaTrocasNoChat();
  restauraTroca('pavan', g, 100);
  let leiturasDaLista = 0;
  const rede: RedeDaTroca = { operacao: async () => op('cliente', 'erro'), lista: async () => { leiturasDaLista++; return lista('destino'); } };
  const solta = acompanhaTroca('pavan', rede);
  try {
    t.mock.timers.tick(2_000);
    await drena();
    assert.equal(leiturasDaLista, 1);
    assert.equal(leTroca('pavan')?.conferencia?.erro, null);
    conversaTrocada('pavan', { operacaoId: 'cliente', sessionId: 'destino' }, 200);
    assert.equal(leTroca('pavan')?.fase, 'concluida');
    assert.equal(g.getItem('ck-conversa-troca:pavan'), null);
  } finally { solta(); }
});
test('R7: cinco erros de rede abrem conferência e falham após ate sem reconexão', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100 });
  comecarTroca('pavan', pedido, 100, 'cliente');
  const rede: RedeDaTroca = { operacao: async () => { throw new Error('rede'); }, lista: semLista };
  const solta = acompanhaTroca('pavan', rede);
  try {
    for (let i = 0; i < 5; i++) { t.mock.timers.tick(2_000); await drena(); }
    assert.equal(leTroca('pavan')?.fase, 'conferindo');
    t.mock.timers.tick(CONFERE_ERRO_MS - 1);
    assert.notEqual(leTroca('pavan')?.fase, 'falhou');
    t.mock.timers.tick(251);
    await drena();
    assert.equal(leTroca('pavan')?.fase, 'falhou');
  } finally { solta(); }
});

for (const fase of ['erro', null] as const) {
  for (const falha of ['rede', 'teto'] as const) {
    test(`R7: conferência ${fase} falha com /operacao sem contato (${falha}) após ate`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 20_000 });
      comecarTroca('pavan', pedido, 100, 'cliente');
      postRespondeu('pavan', 'cliente', op(fase ? 'cliente' : null, fase), 200);
      const erro = leTroca('pavan')?.conferencia?.erro;
      const solta = acompanhaTroca('pavan', {
        operacao: () => falha === 'rede' ? Promise.reject(new Error('rede')) : new Promise(() => {}),
        lista: async () => { assert.fail('não consulta lista com servidor inalcançável'); },
      });
      try {
        await drena();
        if (falha === 'teto') { t.mock.timers.tick(5_000); await drena(); }
        assert.equal(leTroca('pavan')?.fase, 'falhou');
        assert.equal(leTroca('pavan')?.erro, erro);
      } finally { solta(); }
    });
  }
}
