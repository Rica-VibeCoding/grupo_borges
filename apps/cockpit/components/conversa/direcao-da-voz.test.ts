import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DIRECAO_PADRAO,
  DIRECOES,
  conviteDaTela,
  gravaDirecao,
  leDirecao,
  rotuloDoEstado,
} from './direcao-da-voz.ts';

describe('direção da tela de voz (a chave B/C)', () => {
  it('sem nada gravado, abre na Atividade ao vivo (B)', () => {
    assert.equal(leDirecao(null), 'atividade');
    assert.equal(leDirecao(''), 'atividade');
    assert.equal(DIRECAO_PADRAO, 'atividade');
  });

  it('lê de volta o que gravou', () => {
    for (const d of DIRECOES) assert.equal(leDirecao(gravaDirecao(d.id)), d.id);
    assert.equal(leDirecao('eclipse'), 'eclipse');
  });

  it('valor desconhecido cai no padrão em vez de quebrar a tela', () => {
    assert.equal(leDirecao('nucleo'), 'atividade');
    assert.equal(leDirecao('moldura/fio'), 'atividade');
  });

  it('o catálogo tem as duas escolhidas, B primeiro', () => {
    assert.deepEqual(DIRECOES.map((d) => d.id), ['atividade', 'eclipse']);
  });
});

describe('rótulo do estado junto da foto', () => {
  it('parado: "na linha" na B, "em espera" na C', () => {
    assert.equal(rotuloDoEstado('atividade', 'parado'), 'na linha');
    assert.equal(rotuloDoEstado('eclipse', 'parado'), 'em espera');
  });

  it('as vezes da conversa, iguais nas duas', () => {
    for (const d of ['atividade', 'eclipse'] as const) {
      assert.equal(rotuloDoEstado(d, 'ouvindo'), 'ouvindo');
      assert.equal(rotuloDoEstado(d, 'transcrevendo'), 'entendendo');
      assert.equal(rotuloDoEstado(d, 'esperandoZe'), 'pensando');
      assert.equal(rotuloDoEstado(d, 'falando'), 'falando');
      assert.equal(rotuloDoEstado(d, 'interrompendo'), 'pausado');
      assert.equal(rotuloDoEstado(d, 'erro'), 'parou');
      // Só a cor muda: a palavra segue a de hoje (o cartão do pé diz o porquê).
      assert.equal(rotuloDoEstado(d, 'ocupado'), 'parou');
      assert.equal(rotuloDoEstado(d, 'pronta'), 'resposta pronta');
      assert.equal(rotuloDoEstado(d, 'preparando'), 'preparando');
    }
  });
});

describe('o convite da tela parada', () => {
  it('parado: uma linha pequena, a mesma nas duas direções, sem número técnico', () => {
    const convite = conviteDaTela('parado', false);
    assert.equal(convite, 'toque para falar');
    assert.doesNotMatch(convite ?? '', /\d|detector/i);
  });

  it('voltou da recarga com a conversa aberta: o convite é continuar, não começar', () => {
    assert.equal(conviteDaTela('parado', false, true), 'toque para continuar');
    assert.equal(conviteDaTela('parado', false, false), 'toque para falar');
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
