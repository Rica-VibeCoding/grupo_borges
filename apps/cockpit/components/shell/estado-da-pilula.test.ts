import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estadoDaPilula } from './estado-da-pilula.ts';

test('sem a voz, vale a frota — no mesmo vocabulário da voz', () => {
  assert.deepEqual(estadoDaPilula('trabalhando', null), { tom: 'pensa', rotulo: 'trabalhando' });
  assert.deepEqual(estadoDaPilula('ocioso', null), { tom: 'prepara', rotulo: 'na linha' });
  assert.deepEqual(estadoDaPilula('aguardando', null), { tom: 'voce', rotulo: 'esperando você' });
  assert.deepEqual(estadoDaPilula('offline', null), { tom: 'desligado', rotulo: 'desligado' });
  assert.deepEqual(estadoDaPilula(undefined, null), { tom: 'prepara', rotulo: 'na linha' });
});

test('com a conversa andando, a cena da voz vence a frota', () => {
  assert.deepEqual(estadoDaPilula('trabalhando', 'esperandoZe'), { tom: 'pensa', rotulo: 'pensando' });
  assert.deepEqual(estadoDaPilula('trabalhando', 'falando'), { tom: 'ze', rotulo: 'falando' });
  assert.deepEqual(estadoDaPilula('aguardando', 'ouvindo'), { tom: 'voce', rotulo: 'ouvindo' });
  assert.deepEqual(estadoDaPilula('ocioso', 'erro'), { tom: 'erro', rotulo: 'parou' });
});

test('voz em repouso não diz nada do agente: a frota decide', () => {
  assert.deepEqual(estadoDaPilula('trabalhando', 'parado'), { tom: 'pensa', rotulo: 'trabalhando' });
  assert.deepEqual(estadoDaPilula('ocioso', 'preparando'), { tom: 'prepara', rotulo: 'preparando' });
});

test('fora do ar vence tudo', () => {
  assert.deepEqual(estadoDaPilula('offline', 'falando'), { tom: 'desligado', rotulo: 'desligado' });
});
