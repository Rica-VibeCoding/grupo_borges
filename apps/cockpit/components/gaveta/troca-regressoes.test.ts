import assert from 'node:assert/strict';
import { test, beforeEach, mock } from 'node:test';
import * as api from '@grupo_borges/cockpit-core/api';
import * as chat from '../../lib/troca-em-curso.ts';
import { monta, drena, pendente, operacao } from './troca-bancada.test.ts';

const historico = './usa-acoes-de-conversa.ts';
const direto = './usa-troca-direta.ts';
const opcoes = { agentSlug: 'pavan', nome: 'Pavan', atual: 'origem', aoMudarLinha() {}, aoExcluir() {}, tituloDe: () => null };
beforeEach(() => chat.limpaTrocasNoChat());
for (const tipo of ['nova', 'retomar'] as const) {
  test(`API: ${tipo} envia UUID no corpo; chamador antigo continua válido`, async () => {
    const corpos: unknown[] = [];
    const fetchMock = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      corpos.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => operacao('cliente', 'pronta') };
    });
    try {
      if (tipo === 'nova') { await api.postConversaNova('pavan', false, 'cliente'); await api.postConversaNova('pavan', true); }
      else { await api.postConversaRetomar('pavan', 'destino', false, 'cliente'); await api.postConversaRetomar('pavan', 'destino', true); }
      assert.deepEqual(corpos, [{ forcar: false, operacao_id: 'cliente' }, { forcar: true }]);
    } finally { fetchMock.mock.restore(); }
  });
}
for (const origem of ['historico', 'direto'] as const) {
  function montar(rede: Partial<typeof api>) {
    return monta(origem === 'historico' ? historico : direto, origem === 'historico' ? 'usaAcoesDeConversa' : 'usaTrocaDireta', rede,
      origem === 'historico' ? [opcoes] : ['pavan', 'Pavan']);
  }
  function pedir(h: any) {
    if (origem === 'historico') h.pedeRetomar('destino', { ocupado: false, desligado: false });
    else h.pede({ tipo: 'nova', alvo: null, interrompe: false });
  }
  test(`${origem}: POST sai com UUID antes de desmontar; resposta continua no store`, async () => {
    const pedidos: unknown[][] = [];
    const resposta = pendente<api.RespostaDaTroca>();
    const post = (...args: unknown[]) => { pedidos.push(args); return resposta.promise; };
    const m = montar({ postConversaNova: post, postConversaRetomar: post });
    pedir(m.render());
    m.desmonta();
    assert.equal(pedidos.length, 1);
    const id = String(pedidos[0].at(-1));
    assert.match(id, /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i);
    assert.equal(chat.leTroca('pavan')?.clienteId, id);
    assert.ok(m.guarda.getItem('ck-conversa-troca:pavan'));
    assert.equal(chat.leTrocaNoChat('pavan'), null);
    resposta.resolve(operacao(id, 'pronta'));
    await drena();
    assert.equal(chat.leTroca('pavan')?.fase, 'conferindo');
    assert.equal(chat.leTrocaNoChat('pavan')?.fase, 'pronta');
  });
  test(`${origem}: erro de rede marca POST morto na fonte única`, async () => {
    const post = async () => { throw new TypeError('rede caiu'); };
    const m = montar({ postConversaNova: post, postConversaRetomar: post });
    pedir(m.render());
    await drena();
    assert.equal(chat.leTroca('pavan')?.post, 'morto');
    m.desmonta();
  });
  test(`${origem}: 409 acompanha id adotado no store`, async () => {
    const post = async () => { throw new api.ErroDeConversa(409, 'operacao_em_curso'); };
    const m = montar({ postConversaNova: post, postConversaRetomar: post });
    pedir(m.render());
    await drena();
    assert.equal(chat.leTroca('pavan')?.post, 'adotando');
    chat.operacaoLida('pavan', chat.carimboDaLeitura('pavan'), operacao('bloqueou', 'pronta'), 200);
    assert.equal(chat.leTroca('pavan')?.id, 'bloqueou');
    assert.equal(chat.leTroca('pavan')?.conferencia?.erro, null);
    m.desmonta();
  });
  test(`${origem}: stream antes do POST impede falha tardia e nova espera`, async () => {
    const resposta = pendente<api.RespostaDaTroca>();
    const post = () => resposta.promise;
    const m = montar({ postConversaNova: post, postConversaRetomar: post });
    pedir(m.render());
    const id = chat.leTroca('pavan')!.id!;
    chat.conversaTrocada('pavan', { operacaoId: id, sessionId: 'destino' }, 120);
    resposta.resolve(operacao(id, 'erro'));
    await drena();
    assert.equal(chat.leTrocaNoChat('pavan'), null);
    assert.equal(chat.leTroca('pavan')?.fase, 'concluida');
    assert.equal(m.guarda.getItem('ck-conversa-troca:pavan'), null);
    m.desmonta();
  });
  test(`${origem}: ocupado deixa botão âmbar e retry força sem escurecer chat`, async () => {
    const pedidos: boolean[] = [];
    const post = async (_s: string, forcar: boolean) => { pedidos.push(forcar); throw new api.ErroDeConversa(409, 'ocupado'); };
    const m = montar(origem === 'historico'
      ? { postConversaRetomar: (s, _id, f) => post(s, f) }
      : { postConversaNova: post });
    pedir(m.render());
    await drena();
    assert.equal(m.render().estado.fase, 'ocupado');
    assert.equal(chat.leTrocaNoChat('pavan'), null);
    pedir(m.render());
    await drena();
    assert.deepEqual(pedidos, [false, true]);
    m.desmonta();
  });
}

for (const origem of ['historico', 'direto'] as const) {
  for (const status of [400, 404, 409, 500, 502, 503, 504]) {
    test(`R5.1: ${origem}, HTTP ${status} só encerra recusa real`, async () => {
      const post = async () => { throw new api.ErroDeConversa(status, 'recusa ou proxy'); };
      const m = monta(origem === 'historico' ? historico : direto,
        origem === 'historico' ? 'usaAcoesDeConversa' : 'usaTrocaDireta',
        { postConversaNova: post, postConversaRetomar: post }, origem === 'historico' ? [opcoes] : ['pavan', 'Pavan']);
      try {
        const h = m.render();
        if (origem === 'historico') h.pedeRetomar('destino', { ocupado: false, desligado: false });
        else h.pede({ tipo: 'nova', alvo: null, interrompe: false });
        await drena();
        assert.equal(chat.leTroca('pavan')?.post, status < 500 ? 'recusado' : 'morto');
        if (status >= 500) {
          const id = chat.leTroca('pavan')!.id!;
          chat.operacaoLida('pavan', chat.carimboDaLeitura('pavan'), operacao(id, 'religando'), 30_100);
          assert.equal(chat.leTroca('pavan')?.fase, 'esperando');
          chat.operacaoLida('pavan', chat.carimboDaLeitura('pavan'), operacao(id, 'pronta'), 60_100);
          assert.equal(chat.leTroca('pavan')?.conferencia?.erro, null);
        }
      } finally { m.desmonta(); }
    });
  }
}
