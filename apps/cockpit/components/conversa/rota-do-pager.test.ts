import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { painelAssentado, painelDaUrl, urlComTropa, urlDoPainel } from './rota-do-pager.ts';

describe('painel da URL', () => {
  it('chat em /agente, voz em /conversa e na entrada direta com ?tela=voz', () => {
    assert.equal(painelDaUrl('/agente/canarinho', '', 'canarinho'), 'chat');
    assert.equal(painelDaUrl('/agente/canarinho', '?nav=aberto', 'canarinho'), 'chat');
    assert.equal(painelDaUrl('/conversa/canarinho', '', 'canarinho'), 'voz');
    assert.equal(painelDaUrl('/agente/canarinho', '?tela=voz', 'canarinho'), 'voz');
  });

  it('URL de outro agente ou de outra página não é deste pager', () => {
    assert.equal(painelDaUrl('/agente/daniel', '', 'canarinho'), null);
    assert.equal(painelDaUrl('/conversa/daniel', '', 'canarinho'), null);
    assert.equal(painelDaUrl('/', '', 'canarinho'), null);
  });
});

describe('URL do painel', () => {
  it('troca o caminho, guarda o resto da busca e tira a marca de entrada', () => {
    assert.equal(urlDoPainel('voz', 'canarinho', ''), '/conversa/canarinho');
    assert.equal(urlDoPainel('chat', 'canarinho', '?tela=voz'), '/agente/canarinho');
    assert.equal(urlDoPainel('voz', 'canarinho', '?tela=voz&diag=gesto'), '/conversa/canarinho?diag=gesto');
    assert.equal(urlDoPainel('chat', 'canarinho', '?diag=1'), '/agente/canarinho?diag=1');
  });
});

describe('rolagem assentada', () => {
  it('assenta a até 1 px de um painel; no meio do caminho, não', () => {
    assert.equal(painelAssentado(0, 393), 'chat');
    assert.equal(painelAssentado(393, 393), 'voz');
    assert.equal(painelAssentado(392.5, 393), 'voz');
    assert.equal(painelAssentado(0.6, 393), 'chat');
    assert.equal(painelAssentado(200, 393), null);
    assert.equal(painelAssentado(390, 393), null);
  });

  it('sem largura (painel sem layout ainda) não assenta', () => {
    assert.equal(painelAssentado(0, 0), null);
  });
});

describe('URL com a tropa', () => {
  it('abre e fecha só o ?nav, sem mexer no resto', () => {
    assert.equal(urlComTropa('/agente/canarinho', '', true), '/agente/canarinho?nav=aberto');
    assert.equal(urlComTropa('/agente/canarinho', '?nav=aberto', false), '/agente/canarinho');
    assert.equal(urlComTropa('/agente/canarinho', '?diag=gesto&nav=aberto', false), '/agente/canarinho?diag=gesto');
  });
});
