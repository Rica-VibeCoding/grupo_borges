import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { conviteDaTela, rotuloDoEstado } from './direcao-da-voz.ts';

describe('rótulo do estado junto da foto', () => {
  it('as vezes da conversa', () => {
    assert.equal(rotuloDoEstado('parado'), 'na linha');
    assert.equal(rotuloDoEstado('ouvindo'), 'ouvindo');
    assert.equal(rotuloDoEstado('transcrevendo'), 'entendendo');
    assert.equal(rotuloDoEstado('esperandoZe'), 'pensando');
    assert.equal(rotuloDoEstado('falando'), 'falando');
    assert.equal(rotuloDoEstado('interrompendo'), 'pausado');
    assert.equal(rotuloDoEstado('erro'), 'parou');
    // Só a cor muda: a palavra segue a de hoje (o cartão do pé diz o porquê).
    assert.equal(rotuloDoEstado('ocupado'), 'parou');
    assert.equal(rotuloDoEstado('pronta'), 'resposta pronta');
    assert.equal(rotuloDoEstado('preparando'), 'preparando');
  });
});

describe('o convite da tela parada', () => {
  it('parado: uma linha pequena, sem número técnico', () => {
    const convite = conviteDaTela('parado', false);
    assert.equal(convite, 'toque para ligar');
    assert.doesNotMatch(convite ?? '', /\d|detector/i);
  });

  it('voltou da recarga com a conversa aberta: o convite é continuar, não começar', () => {
    assert.equal(conviteDaTela('parado', false, true), 'toque para continuar');
    assert.equal(conviteDaTela('parado', false, false), 'toque para ligar');
    assert.equal(conviteDaTela('preparando', false, true), 'preparando a escuta');
  });

  it('preparando: a espera numa linha, também sem número', () => {
    assert.equal(conviteDaTela('preparando', false), 'preparando a escuta');
  });

  it('com a conversa andando, ou com o detector quebrado, não há convite', () => {
    for (const cena of ['ouvindo', 'transcrevendo', 'esperandoZe', 'falando', 'interrompendo', 'erro'] as const) {
      assert.equal(conviteDaTela(cena, false), null);
    }
    assert.equal(conviteDaTela('parado', true), null);
    assert.equal(conviteDaTela('preparando', true), null);
  });
});
