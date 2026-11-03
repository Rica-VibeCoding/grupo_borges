import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bolhaAberta,
  comandoDigitado,
  COMANDOS_DO_COCKPIT,
  comandosDoAgente,
  veuDoComposer,
} from './comandos-do-cockpit.ts';

describe('comandos de barra do cockpit', () => {
  it('a bolha tem um item só: /voltar', () => {
    assert.deepEqual([...COMANDOS_DO_COCKPIT], ['/voltar']);
  });

  it('abre com a barra sozinha e fecha ao seguir digitando ou apagar', () => {
    assert.equal(bolhaAberta('/', false), true);
    assert.equal(bolhaAberta('', false), false);
    assert.equal(bolhaAberta('/v', false), false);
    assert.equal(bolhaAberta(' /', false), false);
  });

  it('dispensada à mão (Esc, toque fora) fica fechada', () => {
    assert.equal(bolhaAberta('/', true), false);
  });

  it('/voltar digitado inteiro é do cockpit e nunca vai pro agente', () => {
    assert.equal(comandoDigitado('/voltar'), '/voltar');
    assert.equal(comandoDigitado('  /voltar \n'), '/voltar');
    assert.equal(comandoDigitado('/voltar pra ontem'), null);
    assert.equal(comandoDigitado('/compact'), null);
  });
});

describe('comandos do agente', () => {
  it('só os do workspace marcados cockpit: true entram', () => {
    const lista = [
      { comando: '/lead', origem: 'project', cockpit: true },
      { comando: '/encerrar', origem: 'project', cockpit: false },
      { comando: '/revisar', origem: 'user', cockpit: true },
      { comando: '/voltar', origem: 'project', cockpit: true },
    ];
    assert.deepEqual(comandosDoAgente(lista), ['/lead']);
  });
});

describe('véu do composer', () => {
  it('cobre a bolha, o modal e a passagem de um pro outro', () => {
    assert.equal(veuDoComposer(true, false), true);
    // O toque no /voltar fecha a bolha e abre o modal no mesmo render.
    assert.equal(veuDoComposer(false, true), true);
    assert.equal(veuDoComposer(true, true), true);
  });

  it('sai quando os dois fecham', () => {
    assert.equal(veuDoComposer(false, false), false);
  });
});
