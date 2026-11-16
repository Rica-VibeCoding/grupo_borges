import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import * as troca from '../../lib/troca-em-curso.ts';
import { CONFERE_ERRO_MS, PRAZO_DA_TROCA_MS } from '../../lib/regua-da-troca.ts';
import { monta, operacao, drena, pendente } from './troca-bancada.test.ts';

const pedido = { tipo: 'retomar' as const, alvo: 'destino', forcar: false, desligado: false };
const direto = './usa-troca-direta.ts';
const historico = './usa-acoes-de-conversa.ts';
const opcoes = { agentSlug: 'pavan', nome: 'Pavan', atual: 'origem', aoMudarLinha() {}, aoExcluir() {}, tituloDe: () => null };
const ler = (fase: troca.Operacao['fase'], agora: number, id = 'cliente') =>
  troca.operacaoLida('pavan', troca.carimboDaLeitura('pavan'), operacao(id, fase), agora);
function falha() {
  troca.postRespondeu('pavan', 'cliente', { ...operacao('cliente', 'erro'), session_id: 'destino' }, 100);
  troca.confereTroca('pavan', { atual: 'origem' }, 100 + CONFERE_ERRO_MS);
}
beforeEach(() => troca.limpaTrocasNoChat());

test('R8.1: segundo toque com POST pendente não fecha nem duplica', async () => {
  let posts = 0, fechou = 0;
  const resposta = pendente<ReturnType<typeof operacao>>();
  const h = monta(direto, 'usaTrocaDireta', { postConversaNova: () => { posts++; return resposta.promise; } }, ['pavan', 'Pavan']);
  try {
    const p = { tipo: 'nova', alvo: null, interrompe: false, aoAceitar: () => fechou++ };
    h.render().pede(p);
    h.render().pede(p);
    assert.equal(posts, 1);
    assert.equal(fechou, 0);
    resposta.resolve(operacao(troca.leTroca('pavan')!.id, 'pronta'));
    await drena();
    assert.equal(fechou, 1);
  } finally { h.desmonta(); }
});

for (const fase of ['ocupado', 'recusada', 'falhou'] as const) {
  test(`R8.2: Nova não herda ${fase} de Retomar nem força seu POST`, async () => {
    const forcas: boolean[] = [];
    const h = monta(direto, 'usaTrocaDireta', { postConversaNova: async (_s, f, id) => {
      forcas.push(f); return operacao(id!, 'pronta');
    } }, ['pavan', 'Pavan']);
    try {
      h.render();
      troca.comecarTroca('pavan', pedido, 0, 'cliente');
      if (fase === 'falhou') falha();
      else troca.postRecusado('pavan', 'cliente', fase === 'ocupado' ? 'ocupado' : 'Conversa não encontrada', 100);
      assert.equal(h.render().estado.fase, 'livre');
      assert.equal(h.render().recusou, false);
      h.render().pede({ tipo: 'nova', alvo: null, interrompe: false });
      await drena();
      assert.deepEqual(forcas, [false]);
    } finally { h.desmonta(); }
  });
}
test('R8.2: Histórico limita ocupado e falha ao alvo e não força outro Retomar', async () => {
  const forcas: boolean[] = [];
  const h = monta(historico, 'usaAcoesDeConversa', { postConversaRetomar: async (_s, _alvo, f, id) => {
    forcas.push(f); return operacao(id!, 'religando');
  } }, [opcoes]);
  try {
    h.render();
    troca.comecarTroca('pavan', pedido, 0, 'cliente');
    troca.postRecusado('pavan', 'cliente', 'ocupado', 100);
    assert.equal(h.render().estado.troca.alvo, 'destino');
    h.render().pedeRetomar('outra', { ocupado: false, desligado: false });
    await drena();
    assert.deepEqual(forcas, [false]);
    const id = troca.leTroca('pavan')!.id!;
    troca.operacaoLida('pavan', troca.carimboDaLeitura('pavan'), operacao(id, 'erro'), 200);
    troca.confereTroca('pavan', { atual: 'origem' }, 30_000);
    assert.equal(h.render().estado.onde, 'outra');
  } finally { h.desmonta(); }
});

for (const origem of ['nova', 'historico'] as const) {
  for (const fase of ['recusada', 'falhou'] as const) {
    test(`R8.3: desmontar ${origem} limpa ${fase}; reabrir volta livre`, () => {
      const args = origem === 'nova' ? ['pavan', 'Pavan'] : [opcoes];
      const arquivo = origem === 'nova' ? direto : historico;
      const nome = origem === 'nova' ? 'usaTrocaDireta' : 'usaAcoesDeConversa';
      const h = monta(arquivo, nome, {}, args);
      h.render();
      troca.comecarTroca('pavan', origem === 'nova' ? { ...pedido, tipo: 'nova', alvo: null } : pedido, 0, 'cliente');
      if (fase === 'falhou') falha();
      else troca.postRecusado('pavan', 'cliente', 'ocupado', 100);
      assert.notEqual(h.render().estado.fase, 'livre');
      h.desmonta();
      const reaberto = monta(arquivo, nome, {}, args);
      try { assert.equal(reaberto.render().estado.fase, 'livre'); }
      finally { reaberto.desmonta(); }
    });
  }
}

for (const prova of ['evento', 'sessao'] as const) {
  test(`R8.4: ${prova} nossa depois de falhou conclui e apaga alerta`, () => {
    troca.comecarTroca('pavan', pedido, 0, 'cliente');
    falha();
    assert.equal(troca.leTrocaNoChat('pavan')?.fase, 'falhou');
    if (prova === 'evento') {
      troca.conversaTrocada('pavan', { operacaoId: 'outra', sessionId: 'destino' }, 20_000);
      assert.equal(troca.leTroca('pavan')?.fase, 'falhou');
      troca.conversaTrocada('pavan', { operacaoId: 'cliente', sessionId: 'destino' }, 20_001);
    } else {
      troca.confereTroca('pavan', { sessao: 'outra' }, 20_000);
      assert.equal(troca.leTroca('pavan')?.fase, 'falhou');
      troca.confereTroca('pavan', { sessao: 'destino' }, 20_001);
    }
    assert.equal(troca.leTroca('pavan')?.fase, 'concluida');
    assert.equal(troca.leTrocaNoChat('pavan'), null);
    ler('religando', 30_000);
    assert.equal(troca.leTroca('pavan')?.fase, 'concluida');
  });
}

test('R8.5: servidor mantém nosso id após 240 s sem oscilar nem reler linha em laço', () => {
  let avisos = 0;
  const h = monta(historico, 'usaAcoesDeConversa', {}, [{ ...opcoes, aoMudarLinha: () => avisos++ }]);
  try {
    h.render();
    troca.comecarTroca('pavan', pedido, 0, 'cliente');
    troca.postMorreu('pavan', 'cliente', 30_000);
    for (let agora = PRAZO_DA_TROCA_MS - 2_000; agora < PRAZO_DA_TROCA_MS + 20_000; agora += 2_000) {
      ler('religando', agora);
      h.render();
      troca.confereTroca('pavan', {}, agora + 1_750);
      assert.equal(troca.leTroca('pavan')?.fase, 'esperando');
      h.render();
    }
    assert.equal(avisos, 0);
    ler(null, PRAZO_DA_TROCA_MS + 20_000);
    assert.equal(troca.leTroca('pavan')?.fase, 'conferindo');
  } finally { h.desmonta(); }
});
test('R8.5: depois de ver nossa operação em curso, falta de resposta ainda tem teto', () => {
  troca.comecarTroca('pavan', pedido, 0, 'cliente');
  ler('religando', PRAZO_DA_TROCA_MS);
  assert.equal(troca.leTroca('pavan')?.fase, 'esperando');
  troca.confereTroca('pavan', {}, PRAZO_DA_TROCA_MS + 60_000);
  assert.equal(troca.leTroca('pavan')?.fase, 'conferindo');
  troca.confereTroca('pavan', { listaFalhou: true }, PRAZO_DA_TROCA_MS + 60_000 + CONFERE_ERRO_MS);
  assert.equal(troca.leTroca('pavan')?.fase, 'falhou');
});

test('R8.6: consumidores do cartão releem quando falha e quando é dispensada', () => {
  let leituras = 0;
  const solta = troca.assinaTrocaFeita('pavan', () => leituras++);
  try {
    troca.comecarTroca('pavan', pedido, 0, 'cliente');
    falha();
    assert.equal(leituras, 1);
    troca.dispensaTroca('pavan');
    assert.equal(leituras, 2);
  } finally { solta(); }
});
test('R8.7: bancada está identificada como teste fora dos módulos do app', () => {
  assert.equal(existsSync(new URL('./troca-bancada.ts', import.meta.url)), false);
  assert.equal(existsSync(new URL('./troca-bancada.test.ts', import.meta.url)), true);
});
