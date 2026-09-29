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

test('folha móvel e gaveta reutilizam um só miolo de controles', () => {
  const folha = le('./configuracao-da-conversa.tsx');
  const gaveta = le('./configuracao-no-painel.tsx');
  const controles = le('./controles-da-conversa.tsx');
  assert.match(le('./tela-conversa.tsx'), /<ConfiguracaoDaConversa\s+ativa=\{ativa\}/);
  assert.match(folha, /<ControlesDaConversa/);
  assert.match(gaveta, /<ControlesDaConversa/);
  assert.match(folha, /<Drawer open=\{aberta\} onOpenChange=\{mudaAberta\}/);
  for (const texto of ['Estou de fone', 'Mostrar texto', 'Foto do agente']) {
    assert.ok(controles.includes(texto));
    assert.ok(!folha.includes(`nome="${texto}"`));
    assert.ok(!gaveta.includes(`nome="${texto}"`));
  }
});

test('só a gaveta usa a variante compacta, sem descrição; a folha móvel segue igual', () => {
  const folha = le('./configuracao-da-conversa.tsx');
  const gaveta = le('./configuracao-no-painel.tsx');
  const controles = le('./controles-da-conversa.tsx');
  assert.match(gaveta, /detalheTecnico=\{detalheTecnico\}\s+compacta\s+\/>/);
  assert.ok(!folha.includes('compacta'));
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
  assert.match(gaveta, /useDirecaoDaVoz\(\)/);
  assert.match(gaveta, /useVisualConversa\(\)/);
});
