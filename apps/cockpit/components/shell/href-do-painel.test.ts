import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hrefDoPainel } from './href-do-painel.ts';
import { levaSoNoCliente } from './rede-de-navegacao.ts';

test('abrir, trocar visão e fechar preservam voz e parâmetros sem navegação de servidor', () => {
  let atual = 'http://cockpit.local/conversa/canarinho?diag=gesto&nav=aberto';
  const historico = {
    pushState: (_dados: unknown, _titulo: string, href: string | URL | null | undefined) => {
      atual = new URL(String(href), atual).href;
    },
    replaceState: () => assert.fail('a gaveta usa o histórico existente'),
  };
  for (const painel of ['detalhes', 'mcps', 'detalhes', null]) {
    const url = new URL(atual);
    const href = hrefDoPainel(`/agente/canarinho${painel ? `?painel=${painel}` : ''}`, url.pathname, url.search);
    assert.equal(href, `/conversa/canarinho?diag=gesto&nav=aberto${painel ? `&painel=${painel}` : ''}`);
    assert.equal(levaSoNoCliente(historico, href, atual, false), true);
  }
});

test('mantém chat normal e entrada de voz anterior à hidratação', () => {
  assert.equal(hrefDoPainel('/agente/canarinho?painel=detalhes', '/agente/canarinho', ''), '/agente/canarinho?painel=detalhes');
  assert.equal(hrefDoPainel('/agente/canarinho', '/agente/canarinho', '?tela=voz&painel=mcps'), '/agente/canarinho?tela=voz');
});

test('não reescreve navegação de outro agente, página ou origem', () => {
  for (const href of ['/agente/daniel?painel=detalhes', '/tropa', 'https://outro.local/agente/canarinho', '//outro.local/agente/canarinho']) {
    assert.equal(hrefDoPainel(href, '/conversa/canarinho', ''), href);
  }
  assert.equal(hrefDoPainel('/agente/canarinho?painel=mcps', null, ''), '/agente/canarinho?painel=mcps');
  assert.equal(hrefDoPainel('/agente/canarinho?painel=mcps', '/tropa', ''), '/agente/canarinho?painel=mcps');
});
