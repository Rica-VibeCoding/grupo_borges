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
  const gaveta = le('./configuracao-no-painel.tsx');
  const controles = le('./controles-da-conversa.tsx');
  assert.ok(!le('./tela-conversa.tsx').includes('ConfiguracaoDaConversa'));
  assert.match(gaveta, /<ControlesDaConversa/);
  for (const texto of ['Estou de fone', 'Mostrar texto']) {
    assert.ok(controles.includes(texto));
    assert.ok(!gaveta.includes(`nome="${texto}"`));
  }
  assert.ok(!controles.includes('Foto do agente'));
});

test('a gaveta usa a variante compacta, sem descrição', () => {
  const gaveta = le('./configuracao-no-painel.tsx');
  const controles = le('./controles-da-conversa.tsx');
  assert.match(gaveta, /detalheTecnico=\{detalheTecnico\}\s+compacta\s+\/>/);
  assert.ok(!gaveta.includes('Ficam guardadas neste aparelho.'));
  assert.match(controles, /compacta \? null : <span className=\{styles\.descricao\}>/);
  assert.match(controles, /compacta \? null : <p className=\{styles\.dica\}>/);
});

test('conversa vem antes do painel existente, sem substituir conteúdo do chat', () => {
  const gaveta = le('./configuracao-no-painel.tsx');
  assert.match(gaveta, /if \(!mostraConversaNoPainel\(caminho, busca\)\) return children/);
  assert.ok(gaveta.indexOf('<SecaoConversa fechar=') < gaveta.indexOf('<div className={styles.agente}>'));
  assert.match(gaveta, /useChaveDaConversa\(CHAVE_FONE\)/);
  assert.match(gaveta, /useChaveDaConversa\(CHAVE_TEXTO\)/);
  assert.match(gaveta, /useVisualConversa\(\)/);
});
