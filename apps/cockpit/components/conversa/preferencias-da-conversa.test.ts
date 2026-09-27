import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { gravaLigado, leLigado } from './preferencias-da-conversa.ts';

describe('chaves da folha de configurações', () => {
  it('ida e volta: ligado e desligado sobrevivem ao aparelho', () => {
    assert.equal(leLigado(gravaLigado(true)), true);
    assert.equal(leLigado(gravaLigado(false)), false);
  });

  it('sem nada gravado, ou com lixo, fica desligado: tela limpa e conversa sem fone', () => {
    for (const bruto of [null, undefined, '', 'true', 'sim', '2']) assert.equal(leLigado(bruto), false);
  });
});
