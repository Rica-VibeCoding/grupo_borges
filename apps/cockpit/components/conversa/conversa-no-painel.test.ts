import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { mostraConversaNoPainel } from './conversa-no-painel.ts';

const le = (arquivo: string) => readFileSync(new URL(arquivo, import.meta.url), 'utf8');

for (const [caminho, busca] of [
  ['/conversa/canarinho', '?painel=detalhes'],
  ['/agente/canarinho', '?tela=voz&painel=detalhes'],
  ['/conversa/tara', '?diag=1&painel=detalhes&nav=aberto'],
]) {
  test(`mostra conversa em ${caminho}${busca}`, () => {
    assert.equal(mostraConversaNoPainel(caminho, busca), true);
  });
}

for (const [caminho, busca] of [
  ['/agente/canarinho', '?painel=detalhes'],
  ['/agente/canarinho', '?tela=chat&painel=detalhes'],
  ['/conversa/canarinho', '?painel=mcps'],
  ['/conversa/canarinho', ''],
  ['/conversa/canarinho/extra', '?painel=detalhes'],
  ['/', '?painel=detalhes&tela=voz'],
]) {
  test(`preserva painel sem conversa em ${caminho}${busca}`, () => {
    assert.equal(mostraConversaNoPainel(caminho, busca), false);
  });
}

test('a gaveta do agente é a única casa dos controles da conversa', () => {
  const cartao = le('../gaveta/cartao-da-conversa.tsx');
  const gaveta = le('../gaveta/gaveta-nova.tsx');
  assert.ok(!le('./tela-conversa.tsx').includes('ConfiguracaoDaConversa'));
  for (const texto of ['Estou de fone', 'Mostrar texto']) assert.ok(cartao.includes(texto));
  assert.ok(!cartao.includes('Foto do agente'));
  assert.match(gaveta, /mostraConversaNoPainel\(/);
  assert.match(gaveta, /\{conversa \? <CartaoDaConversa \/> : null\}/);
});

test('o cartão da conversa grava pelas mesmas chaves e pelo mesmo visual', () => {
  const cartao = le('../gaveta/cartao-da-conversa.tsx');
  assert.match(cartao, /useChaveDaConversa\(CHAVE_FONE\)/);
  assert.match(cartao, /useChaveDaConversa\(CHAVE_TEXTO\)/);
  assert.match(cartao, /useVisualConversa\(\)/);
  assert.match(cartao, /useDetalheDaConversa\(\)/);
});

test('conversa vem antes da sessão, sem substituir o painel do agente', () => {
  const gaveta = le('../gaveta/gaveta-nova.tsx');
  assert.ok(gaveta.indexOf('<CartaoDaConversa />') < gaveta.indexOf('<CartaoDaSessao v='));
});
