import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as chat from '../../lib/troca-em-curso.ts';
import { leConversaTrocada } from '../../lib/conversa-trocada.ts';
import { CONFERE_ERRO_MS } from '../../lib/regua-da-troca.ts';
import { monta, operacao } from './troca-bancada.test.ts';

const hookDoChat = '../../app/agente/[slug]/usa-troca-no-chat.ts';
const historico = './usa-acoes-de-conversa.ts';
const pedido = { tipo: 'retomar' as const, alvo: 'destino', desligado: false, forcar: false };
const opcoes = { agentSlug: 'pavan', nome: 'Pavan', atual: 'origem', aoMudarLinha() {}, aoExcluir() {}, tituloDe: () => null };
beforeEach(() => chat.limpaTrocasNoChat());
for (const pronta of [false, true]) {
  for (const operacaoId of ['anterior', 'cliente', undefined]) {
    test(`chat: evento ${operacaoId}, pronta=${pronta}, sem comparar relógios`, () => {
      const m = monta(hookDoChat, 'usaTrocaNoChat');
      chat.restauraTroca('pavan', m.guarda, 0);
      chat.comecarTroca('pavan', pedido, 0, 'cliente');
      if (pronta) chat.postRespondeu('pavan', 'cliente', operacao('cliente', 'pronta'), 100);
      const evento = leConversaTrocada({ session_id: 'destino', motivo: 'retomar', operacao_id: operacaoId, at: 1 });
      m.render('pavan', evento, [], 'origem');
      const concluiu = operacaoId !== 'anterior';
      assert.equal(chat.leTroca('pavan')?.fase === 'concluida', concluiu);
      assert.equal(m.guarda.getItem('ck-conversa-troca:pavan') === null, concluiu);
      m.desmonta();
    });
  }
}
test('Histórico e chat leem a mesma conferência F11, sem publicar estados de volta', () => {
  const h = monta(historico, 'usaAcoesDeConversa', {}, [opcoes]);
  const c = monta(hookDoChat, 'usaTrocaNoChat', {}, ['pavan', null, [], 'origem']);
  chat.restauraTroca('pavan', h.guarda, 0);
  chat.comecarTroca('pavan', pedido, 0, 'cliente');
  chat.postRespondeu('pavan', 'cliente', operacao('cliente', 'erro'), 100);
  assert.equal(h.render().estado.fase, 'conferindo');
  assert.notEqual(c.render().emCurso?.fase, 'falhou');
  chat.confereTroca('pavan', { atual: 'origem' }, 100 + CONFERE_ERRO_MS);
  assert.equal(h.render().estado.fase, 'falhou');
  assert.equal(c.render().emCurso?.fase, 'falhou');
  h.desmonta();
  c.desmonta();
});
test('chat: pronta espera a sessão de destino, depois limpa a aba', () => {
  const c = monta(hookDoChat, 'usaTrocaNoChat');
  chat.restauraTroca('pavan', c.guarda, 0);
  chat.comecarTroca('pavan', pedido, 0, 'cliente');
  chat.postRespondeu('pavan', 'cliente', operacao('cliente', 'pronta'), 100);
  c.render('pavan', null, [], 'origem');
  assert.equal(chat.leTrocaNoChat('pavan')?.fase, 'pronta');
  c.render('pavan', null, [], 'destino');
  assert.equal(chat.leTrocaNoChat('pavan'), null);
  assert.equal(c.guarda.getItem('ck-conversa-troca:pavan'), null);
  c.desmonta();
});

test('F11: sessão já resolvida é reconsiderada ao entrar na conferência mesmo com chat visualmente igual', () => {
  const c = monta(hookDoChat, 'usaTrocaNoChat');
  chat.restauraTroca('pavan', c.guarda, 0);
  chat.comecarTroca('pavan', pedido, 0, 'cliente');
  chat.postRespondeu('pavan', 'cliente', operacao('cliente', 'religando'), 100);
  c.render('pavan', null, [], 'destino');
  assert.equal(chat.leTroca('pavan')?.fase, 'esperando');
  const visual = chat.leTrocaNoChat('pavan');
  chat.operacaoLida('pavan', chat.carimboDaLeitura('pavan'), operacao('cliente', 'erro'), 200);
  assert.equal(chat.leTrocaNoChat('pavan'), visual);
  c.render('pavan', null, [], 'destino');
  assert.equal(chat.leTroca('pavan')?.fase, 'concluida');
  assert.equal(chat.leTrocaNoChat('pavan'), null);
  c.desmonta();
});
