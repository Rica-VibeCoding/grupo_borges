import assert from 'node:assert/strict';
import { it } from 'node:test';

import { avanca, inicial } from '../../lib/conversa/maquina.ts';
import type { Conversa, Evento } from '../../lib/conversa/tipos.ts';

import { comParcial, FALA_VAZIA, falaDepois, type FalaDaVez } from './fala-da-vez.ts';

/*
 * O "Você disse" pertence à vez do Rica (28/09, iPhone): a tela de erro mostrava o texto de
 * uma fala anterior, porque o texto só era escrito e nunca apagado — e era escrito mesmo quando
 * a máquina já tinha recusado o `transcreveu`.
 */

const AUDIO = new Float32Array(16);

/** Leva a máquina e a fala da tela pelos eventos, como o `despacha` da tela faz. */
function roda(eventos: Evento[], inicio: { conversa?: Conversa; fala?: FalaDaVez } = {}) {
  let conversa = inicio.conversa ?? inicial();
  let fala = inicio.fala ?? FALA_VAZIA;
  for (const evento of eventos) {
    const antes = conversa.estado;
    conversa = avanca(conversa, evento, 0).conversa;
    fala = falaDepois(fala, antes, evento, conversa.estado);
  }
  return { conversa, fala };
}

const falaCom = (texto: string): Evento[] => [
  { tipo: 'falaTerminou', audio: AUDIO },
  { tipo: 'transcreveu', texto },
];

it('fala com texto, envio falha, vez nova e o WAV falha: "Não entendi" sem texto', () => {
  const r = roda([
    { tipo: 'comecar' },
    ...falaCom('Melhor, estou aproveitando e fazendo os testes aqui.'),
    { tipo: 'falhou', motivo: 'envioFalhou' },
    { tipo: 'comecar' },
    { tipo: 'falaTerminou', audio: AUDIO },
    { tipo: 'falhou', motivo: 'transcricaoFalhou' },
  ]);
  assert.equal(r.conversa.estado, 'erro');
  assert.equal(r.conversa.motivo, 'transcricaoFalhou');
  assert.equal(r.fala.firme, null);
});

it('falhou e depois chega um texto atrasado: a máquina recusou, a tela não escreve', () => {
  const r = roda([
    { tipo: 'comecar' },
    { tipo: 'falaTerminou', audio: AUDIO },
    { tipo: 'falhou', motivo: 'transcricaoFalhou' },
    { tipo: 'transcreveu', texto: 'tarde demais' },
  ]);
  assert.equal(r.conversa.estado, 'erro');
  assert.equal(r.fala.firme, null);
});

it('o envio desta fala falhou: o texto dela fica na tela de erro', () => {
  const r = roda([{ tipo: 'comecar' }, ...falaCom(' Oi, Canário. '), { tipo: 'falhou', motivo: 'envioFalhou' }]);
  assert.equal(r.conversa.motivo, 'envioFalhou');
  assert.equal(r.fala.firme, 'Oi, Canário.');
});

it('a fala aceita fica enquanto o Zé pensa e responde; a vez nova começa limpa', () => {
  const r = roda([{ tipo: 'comecar' }, ...falaCom('Oi.'), { tipo: 'enviou' }, { tipo: 'textoDoZe', texto: 'Olá.' }]);
  assert.equal(r.conversa.estado, 'falando');
  assert.equal(r.fala.firme, 'Oi.');
  const depois = roda([{ tipo: 'vozTerminou' }, { tipo: 'zeTerminou' }], r);
  assert.equal(depois.conversa.estado, 'ouvindo');
  assert.deepEqual(depois.fala, FALA_VAZIA);
});

it('texto vazio: volta a ouvir sem nada escrito', () => {
  const r = roda([{ tipo: 'comecar' }, ...falaCom('   ')]);
  assert.equal(r.conversa.estado, 'ouvindo');
  assert.deepEqual(r.fala, FALA_VAZIA);
});

it('o parcial aparece na vez do Rica e some quando o firme chega', () => {
  const { conversa } = roda([{ tipo: 'comecar' }]);
  let fala = comParcial(FALA_VAZIA, conversa.estado, ' Canário, teste');
  assert.equal(fala.parcial, 'Canário, teste');
  const r = roda(falaCom('Canário, teste do modo conversa.'), { conversa, fala });
  assert.deepEqual(r.fala, { firme: 'Canário, teste do modo conversa.', parcial: null });
  fala = comParcial(r.fala, r.conversa.estado, 'Canário, teste do modo conversa, atrasado');
  assert.equal(fala.parcial, null, 'delta atrasado não volta depois do firme');
});

it('parcial fora da vez do Rica é ignorado; erro apaga o parcial', () => {
  assert.deepEqual(comParcial(FALA_VAZIA, 'esperandoZe', 'eco'), FALA_VAZIA);
  assert.deepEqual(comParcial(FALA_VAZIA, 'erro', 'eco'), FALA_VAZIA);
  const { conversa } = roda([{ tipo: 'comecar' }, { tipo: 'falaTerminou', audio: AUDIO }]);
  const fala = comParcial(FALA_VAZIA, conversa.estado, 'quase lá');
  assert.equal(fala.parcial, 'quase lá');
  const r = roda([{ tipo: 'falhou', motivo: 'transcricaoFalhou' }], { conversa, fala });
  assert.deepEqual(r.fala, FALA_VAZIA);
});

it('parcial vazio (tosse limpa do canal) apaga o que estava escrito', () => {
  const fala = comParcial({ firme: null, parcial: 'Can' }, 'ouvindo', null);
  assert.deepEqual(fala, FALA_VAZIA);
});
