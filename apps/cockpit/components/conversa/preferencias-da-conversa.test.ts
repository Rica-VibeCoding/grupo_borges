import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { gravaLigado, leLigado, leMotor, leResposta } from './preferencias-da-conversa.ts';

describe('chaves da folha de configurações', () => {
  it('ida e volta: ligado e desligado sobrevivem ao aparelho', () => {
    assert.equal(leLigado(gravaLigado(true)), true);
    assert.equal(leLigado(gravaLigado(false)), false);
  });

  it('sem nada gravado, ou com lixo, fica desligado: tela limpa e conversa sem fone', () => {
    for (const bruto of [null, undefined, '', 'true', 'sim', '2']) assert.equal(leLigado(bruto), false);
  });
});

describe('resposta e voz da conversa', () => {
  it('a resposta nasce curta; só "completa" gravado fala tudo', () => {
    assert.equal(leResposta(''), 'curta');
    assert.equal(leResposta('lixo'), 'curta');
    assert.equal(leResposta('completa'), 'completa');
  });

  it('a voz nasce natural (Chirp); valor desconhecido também', () => {
    assert.equal(leMotor(''), 'chirp');
    assert.equal(leMotor('edge'), 'chirp');
    assert.equal(leMotor('wavenet'), 'wavenet');
    assert.equal(leMotor('minimax'), 'minimax');
  });
});
