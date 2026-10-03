import assert from 'node:assert/strict';
import { test } from 'node:test';

import { avanca, inicial } from '../../lib/conversa/maquina.ts';
import type { Conversa, Efeito, Evento } from '../../lib/conversa/tipos.ts';
import { esperaSegue } from './espera-do-subagente.ts';

// Code review (02/10): a espera pelo subagente se perdia quando a tela passava por `ouvindo` — a
// tosse com fone, a uma fala sem fone. Voltando a `esperandoZe` sem ela, o fim do trabalho não
// devolvia a vez (tela presa) e o toque seguinte freava um agente parado, calando o turno que viria.

type Regra = (c: Conversa, rodando: boolean) => boolean;
// A régua de antes: só `esperandoZe`/`falando` seguravam a espera.
const regraAntiga: Regra = (c, rodando) => !rodando && (c.estado === 'esperandoZe' || c.estado === 'falando');

const audio = new Float32Array(0);

/** Retoma com o subagente trabalhando e passa os eventos, aplicando a régua da espera a cada passo. */
function roda(fone: boolean, eventos: Evento[], regra: Regra = esperaSegue, rodando = false) {
  let conversa: Conversa = inicial();
  for (const e of [{ tipo: 'fone', ligado: fone }, { tipo: 'retomar' }] as Evento[]) conversa = avanca(conversa, e, 0).conversa;
  let espera = true; // `segundoPlanoRef = r.segundoPlano`
  const efeitos: Efeito[] = [];
  eventos.forEach((evento, i) => {
    const r = avanca(conversa, evento, i * 100);
    conversa = r.conversa;
    efeitos.push(...r.efeitos);
    espera = espera && regra(conversa, rodando);
  });
  return { conversa, espera, efeitos };
}

/** O toque seguinte, como `use-modo-conversa` despacha. */
const toque = (c: Conversa, espera: boolean, rodando = false) =>
  avanca(c, { tipo: 'interromper', rodando, semFreio: espera && !rodando }, 9999);

const tosse: Evento[] = [{ tipo: 'falaIniciou' }, { tipo: 'falaDescartada' }];
const umaFalaFechada: Evento[] = [{ tipo: 'abrirUmaFala' }, { tipo: 'fecharUmaFala' }];
const umaFalaVazia: Evento[] = [{ tipo: 'abrirUmaFala' }, { tipo: 'falaTerminou', audio }, { tipo: 'transcreveu', texto: '' }];

const cenarios: [string, boolean, Evento[]][] = [
  ['com fone, a tosse', true, tosse],
  ['sem fone, a uma fala fechada', false, umaFalaFechada],
  ['sem fone, a uma fala vazia', false, umaFalaVazia],
];

for (const [nome, fone, eventos] of cenarios) {
  test(`${nome}: volta a esperar o subagente com a espera de pé, e o toque não freia`, () => {
    const { conversa, espera } = roda(fone, eventos);
    assert.equal(conversa.estado, 'esperandoZe');
    assert.equal(espera, true); // o fim do trabalho devolve a vez (`zeTerminou`)
    const r = toque(conversa, espera);
    assert.ok(!r.efeitos.some((e) => e.tipo === 'frearZe'));
  });

  test(`${nome}: a régua antiga perdia a espera e o toque freava (a metade que mostra o defeito)`, () => {
    const { conversa, espera } = roda(fone, eventos, regraAntiga);
    assert.equal(conversa.estado, 'esperandoZe');
    assert.equal(espera, false);
    assert.ok(toque(conversa, espera).efeitos.some((e) => e.tipo === 'frearZe'));
  });
}

test('turno novo abre (`rodando`): a espera solta, e o toque volta a frear', () => {
  const aberta = roda(true, [{ tipo: 'textoDoZe', texto: 'oi' }], esperaSegue, true);
  assert.equal(aberta.espera, false);
  assert.ok(toque(aberta.conversa, aberta.espera, true).efeitos.some((e) => e.tipo === 'frearZe'));
});

test('parar solta a espera', () => {
  assert.equal(roda(true, [{ tipo: 'parar' }]).espera, false);
  assert.equal(roda(false, [{ tipo: 'parar', semFreio: true }]).espera, false);
});

test('a fala da espera que vira pedido solta a espera — o turno que vem é novo', () => {
  const r = roda(true, [{ tipo: 'falaIniciou' }, { tipo: 'falaTerminou', audio }, { tipo: 'transcreveu', texto: 'e aí?' }]);
  assert.equal(r.espera, false);
});

test('fora da espera, ouvir não segura nada', () => {
  assert.equal(esperaSegue({ estado: 'ouvindo' }, false), false);
  assert.equal(esperaSegue({ estado: 'esperandoZe' }, false), true);
  assert.equal(esperaSegue({ estado: 'falando' }, false), true);
  assert.equal(esperaSegue({ estado: 'esperandoZe' }, true), false);
});
