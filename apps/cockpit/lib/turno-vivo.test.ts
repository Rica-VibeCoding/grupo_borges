import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  assinaTurnoVivo,
  leTurnoVivo,
  limpaTurnoVivo,
  publicaTurnoVivo,
} from './turno-vivo.ts';

beforeEach(() => limpaTurnoVivo());

describe('turno vivo — a fonte do ■ que o lifecycle não dava', () => {
  it('nasce desligado: agente sem turno não oferece freio', () => {
    assert.equal(leTurnoVivo('canarinho'), false);
  });

  it('acende e apaga pelo que o feed publica', () => {
    publicaTurnoVivo('canarinho', true);
    assert.equal(leTurnoVivo('canarinho'), true);
    publicaTurnoVivo('canarinho', false);
    assert.equal(leTurnoVivo('canarinho'), false);
  });

  it('cada agente responde por si — o freio de um não aparece na tela do outro', () => {
    publicaTurnoVivo('canarinho', true);
    assert.equal(leTurnoVivo('tara'), false);
  });

  it('só notifica na VIRADA: republicar o mesmo valor não acorda o composer', () => {
    let avisos = 0;
    assinaTurnoVivo('canarinho', () => {
      avisos += 1;
    });
    publicaTurnoVivo('canarinho', true);
    publicaTurnoVivo('canarinho', true);
    publicaTurnoVivo('canarinho', true);
    assert.equal(avisos, 1, 'cada flush do stream republica o mesmo booleano');
    publicaTurnoVivo('canarinho', false);
    assert.equal(avisos, 2);
  });

  it('desassinar para de receber', () => {
    let avisos = 0;
    const solta = assinaTurnoVivo('canarinho', () => {
      avisos += 1;
    });
    solta();
    publicaTurnoVivo('canarinho', true);
    assert.equal(avisos, 0);
  });
});
