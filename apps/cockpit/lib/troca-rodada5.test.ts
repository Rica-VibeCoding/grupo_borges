import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { ConversasResponse, OperacaoDeConversa } from '@grupo_borges/cockpit-core/api';
import { acompanhaTroca } from './leitor-da-troca.ts';
import { comecaTroca, reduzTroca, CONFERE_ERRO_MS, type Operacao } from './regua-da-troca.ts';
import { carimboDaLeitura, comecarTroca, confereTroca, conversaTrocada, dispensaTroca, leTroca,
  leituraMorreu, limpaTrocasNoChat, operacaoLida, postRecusado, postRespondeu, restauraTroca } from './troca-em-curso.ts';

const pedido = { tipo: 'retomar' as const, alvo: 'destino', desligado: false, forcar: false };
const op = (id: string | null | undefined, fase: Operacao['fase']): Operacao => ({ id, fase, session_id: null, desde: null, detalhe: 'erro da API' });
const inicio = () => comecaTroca(pedido, 'cliente', 100);
const drena = () => new Promise<void>((r) => setImmediate(r));
const lista = (id: string) => ({ conversas: [{ id, atual: true }] }) as ConversasResponse;
function memoria() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
beforeEach(() => limpaTrocasNoChat());

for (const agora of [400, 300_000]) {
  for (const fase of ['religando', 'pronta'] as const) {
    test(`R5.2: após cinco falhas, nossa ${fase} recupera acompanhamento em ${agora}`, () => {
      comecarTroca('pavan', pedido, 100, 'cliente');
      const marca = carimboDaLeitura('pavan');
      for (let i = 0; i < 5; i++) leituraMorreu('pavan', marca, 200);
      assert.equal(leTroca('pavan')?.fase, 'conferindo');
      operacaoLida('pavan', marca, op('outra', fase), 300);
      assert.equal(leTroca('pavan')?.fase, 'conferindo');
      operacaoLida('pavan', marca, op('cliente', fase), agora);
      assert.equal(leTroca('pavan')?.fase, fase === 'pronta' ? 'concluida' : 'esperando');
      if (fase === 'religando') assert.equal(leTroca('pavan')?.conferencia, undefined);
    });
  }
}
test('R5.2: evento nosso conclui durante conferência de erro', () => {
  const erro = reduzTroca(inicio(), { tipo: 'falha-de-leitura' }, 200);
  assert.equal(reduzTroca(erro, { tipo: 'evento', evento: { operacaoId: 'cliente', sessionId: 'destino' } }, 300).fase, 'concluida');
});
for (const fim of ['concluida', 'falhou'] as const) {
  test(`R5.3: id do servidor adotado e ${fim} não revive na recarga nem após 409`, () => {
    const guarda = memoria();
    restauraTroca('pavan', guarda, 100);
    comecarTroca('pavan', pedido, 100, 'cliente');
    postRecusado('pavan', 'cliente', 'operacao_em_curso', 200);
    operacaoLida('pavan', carimboDaLeitura('pavan'), op('servidor', fim === 'falhou' ? 'erro' : 'religando'), 300);
    if (fim === 'concluida') conversaTrocada('pavan', { operacaoId: 'servidor', sessionId: 'destino' }, 400);
    else confereTroca('pavan', { atual: 'origem' }, 300 + CONFERE_ERRO_MS);
    assert.equal(leTroca('pavan')?.fase, fim);
    dispensaTroca('pavan');
    limpaTrocasNoChat();
    restauraTroca('pavan', guarda, 50_000);
    operacaoLida('pavan', carimboDaLeitura('pavan'), op('servidor', 'religando'), 50_100);
    assert.equal(leTroca('pavan'), null);
    comecarTroca('pavan', pedido, 50_200, 'novo-cliente');
    postRecusado('pavan', 'novo-cliente', 'operacao_em_curso', 50_300);
    operacaoLida('pavan', carimboDaLeitura('pavan'), op('servidor', 'religando'), 50_400);
    assert.notEqual(leTroca('pavan')?.id, 'servidor');
    operacaoLida('pavan', carimboDaLeitura('pavan'), op('nova-operacao', 'religando'), 50_500);
    assert.equal(leTroca('pavan')?.id, 'novo-cliente', 'a operação encerrada já levou à conferência, sem adoção posterior');
    assert.equal(leTroca('pavan')?.fase, 'conferindo');
    confereTroca('pavan', { atual: 'origem' }, 50_400 + CONFERE_ERRO_MS);
    assert.equal(leTroca('pavan')?.fase, 'falhou');
  });
}
test('R5.4: relógio após Safari congelado não substitui lista posterior a ate', () => {
  const erro = reduzTroca(inicio(), { tipo: 'operacao', op: op('cliente', 'erro') }, 200);
  const antes = reduzTroca(erro, { tipo: 'relogio', atual: 'origem' }, 200 + CONFERE_ERRO_MS - 1);
  assert.equal(reduzTroca(antes, { tipo: 'relogio' }, 99_000).fase, 'conferindo');
  assert.equal(reduzTroca(antes, { tipo: 'relogio', atual: 'origem' }, 99_000).fase, 'falhou');
});
test('R5.4: recarga após ate espera lista e aceita troca feita', () => {
  const guarda = memoria();
  restauraTroca('pavan', guarda, 100);
  comecarTroca('pavan', pedido, 100, 'cliente');
  postRespondeu('pavan', 'cliente', op('cliente', 'erro'), 200);
  limpaTrocasNoChat();
  restauraTroca('pavan', guarda, 99_000);
  confereTroca('pavan', {}, 99_000);
  assert.equal(leTroca('pavan')?.fase, 'conferindo');
  confereTroca('pavan', { atual: 'destino' }, 99_100);
  assert.equal(leTroca('pavan')?.conferencia?.erro, null);
});
test('R5.4: lista iniciada antes de ate e recebida depois não autoriza falhar', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 3_000 });
  comecarTroca('pavan', pedido, 100, 'cliente');
  postRespondeu('pavan', 'cliente', op('cliente', 'erro'), 200);
  let resolve!: (l: ConversasResponse) => void;
  const pendente = new Promise<ConversasResponse>((r) => { resolve = r; });
  let listas = 0;
  const solta = acompanhaTroca('pavan', { operacao: async () => op('cliente', 'erro') as OperacaoDeConversa,
    lista: () => ++listas === 1 ? pendente : Promise.resolve(lista('origem')) });
  try {
    await drena();
    t.mock.timers.setTime(200 + CONFERE_ERRO_MS + 1);
    resolve(lista('origem'));
    await drena();
    assert.equal(leTroca('pavan')?.fase, 'conferindo');
    t.mock.timers.tick(2_000);
    await drena();
    assert.equal(leTroca('pavan')?.fase, 'falhou');
  } finally { solta(); }
});
test('R5.5: API sem id só é lida dois segundos após começar', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100 });
  comecarTroca('pavan', pedido, 100, 'cliente');
  let leituras = 0;
  const solta = acompanhaTroca('pavan', { operacao: async () => {
    leituras++;
    return op(undefined, 'erro') as OperacaoDeConversa;
  }, lista: async () => lista('origem') });
  try {
    await drena();
    assert.equal(leituras, 0);
    t.mock.timers.tick(1_999);
    await drena();
    assert.equal(leituras, 0);
    t.mock.timers.tick(1);
    await drena();
    assert.equal(leituras, 1);
    assert.equal(leTroca('pavan')?.fase, 'conferindo');
  } finally { solta(); }
});
for (const antes of [null, undefined, 'origem']) {
  test(`R5.6: Nova com antes=${antes} exige prova de troca conhecida`, () => {
    const nova = comecaTroca({ ...pedido, tipo: 'nova', alvo: null, antes }, 'cliente', 100);
    const erro = reduzTroca(nova, { tipo: 'operacao', op: op('cliente', 'erro') }, 200);
    const provada = reduzTroca(erro, { tipo: 'relogio', atual: 'destino', sessao: 'destino' }, 300);
    assert.equal(provada.fase, antes ? 'concluida' : 'conferindo');
    if (!antes) assert.notEqual(provada.conferencia?.erro, null);
    const conhecida = reduzTroca(nova, { tipo: 'operacao', op: { ...op('cliente', 'erro'), session_id: 'destino' } }, 200);
    assert.equal(reduzTroca(conhecida, { tipo: 'relogio', sessao: 'destino' }, 300).fase, 'concluida');
  });
}
for (const id of ['cliente', undefined]) {
  test(`R5.7: fase null após ver operação ${id}, POST pendente não some`, () => {
    const vista = reduzTroca(inicio(), { tipo: 'operacao', op: op(id, 'religando') }, 200);
    assert.equal(reduzTroca(vista, { tipo: 'operacao', op: op(id === undefined ? undefined : null, null) }, 3_000).fase, 'esperando');
  });
}
