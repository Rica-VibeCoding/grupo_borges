import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as troca from '../../lib/troca-em-curso.ts';
import { monta, operacao } from './troca-bancada.test.ts';

const pedido = { tipo: 'retomar' as const, alvo: 'destino', forcar: false, desligado: false };
const historico = './usa-acoes-de-conversa.ts';
const opcoes = { agentSlug: 'pavan', nome: 'Pavan', atual: 'origem', aoMudarLinha() {}, aoExcluir() {}, tituloDe: () => null };
beforeEach(() => troca.limpaTrocasNoChat());
for (const tipo of ['nova', 'retomar'] as const) {
  test(`R6.3: ${tipo} avisa na transição ao vivo e não repete ao reabrir Histórico`, () => {
    let avisos = 0;
    const args = [{ ...opcoes, aoMudarLinha: () => avisos++ }];
    const h = monta(historico, 'usaAcoesDeConversa', {}, args);
    h.render();
    troca.comecarTroca('pavan', { ...pedido, tipo }, 0, 'cliente');
    troca.conversaTrocada('pavan', { operacaoId: 'cliente', sessionId: 'destino' }, 10);
    h.render();
    assert.equal(h.render().trocouAgora, tipo);
    assert.equal(avisos, 1);
    h.desmonta();
    const reaberto = monta(historico, 'usaAcoesDeConversa', {}, args);
    try {
      reaberto.render();
      assert.equal(reaberto.render().trocouAgora, null);
      assert.equal(avisos, 1, 'não relê linha nem fecha a leitura reaberta');
    } finally { reaberto.desmonta(); }
  });
}
for (const entrou of ['destino', 'outra']) {
  test(`R6.6: 409 só marca Retomada agora se entrou=${entrou} corresponder ao pedido`, () => {
    const h = monta(historico, 'usaAcoesDeConversa', {}, [opcoes]);
    try {
      h.render();
      troca.comecarTroca('pavan', pedido, 0, 'cliente');
      troca.postRecusado('pavan', 'cliente', 'operacao_em_curso', 10);
      troca.operacaoLida('pavan', troca.carimboDaLeitura('pavan'), { ...operacao('externa', 'pronta'), session_id: entrou }, 20);
      troca.confereTroca('pavan', { sessao: entrou }, 30);
      h.render();
      assert.equal(h.render().trocouAgora, entrou === 'destino' ? 'retomar' : null);
    } finally { h.desmonta(); }
  });
}
test('R6.10: API velha avança pílula direta por leOperacao enquanto POST está pendente', () => {
  const h = monta('./usa-troca-direta.ts', 'usaTrocaDireta', {}, ['pavan', 'Pavan']);
  try {
    h.render();
    troca.comecarTroca('pavan', { ...pedido, tipo: 'nova', alvo: null }, 0, 'cliente');
    assert.equal(h.render().etapa, 'pedindo');
    for (const fase of ['estacionando', 'religando'] as const) {
      const { id: _id, ...velha } = operacao('ignorado', fase);
      troca.operacaoLida('pavan', troca.carimboDaLeitura('pavan'), velha, 2_000);
      assert.equal(h.render().etapa, fase);
    }
    assert.equal(troca.leTroca('pavan')?.post, 'pendente');
  } finally { h.desmonta(); }
});
