import assert from 'node:assert/strict';
import { test } from 'node:test';

import { avanca, inicial } from './maquina.ts';

const ouvindo = () => avanca(inicial(), { tipo: 'comecar' }, 0).conversa;

for (const evento of [
  { tipo: 'falhou', motivo: 'transcricaoFalhou' },
  { tipo: 'falhou', motivo: 'envioFalhou' },
  { tipo: 'capturaCaiu' },
] as const) {
  test(`erro ${JSON.stringify(evento)} solta a fila pausada sem reproduzir resposta antiga`, () => {
    let c = avanca(ouvindo(), { tipo: 'falaIniciou' }, 1).conversa;
    c = avanca(c, { tipo: 'textoDoZe', texto: 'Guardada.' }, 2).conversa;
    c = avanca(c, { tipo: 'falaTerminou', audio: new Float32Array([1]) }, 3).conversa;
    const erro = avanca(c, evento, 4);
    assert.equal(erro.conversa.estado, 'erro');
    assert.deepEqual(erro.efeitos.map((e) => e.tipo), ['descartarVoz', 'desligarDetector', 'avisarErro']);
    const nova = avanca(erro.conversa, { tipo: 'comecar' }, 5);
    assert.equal(nova.conversa.estado, 'ouvindo');
  });
}

test('vez segurada antes da primeira palavra retém resposta até soltar', () => {
  let c = avanca(ouvindo(), { tipo: 'segurou', ligado: true }, 1).conversa;
  const resposta = avanca(c, { tipo: 'textoDoZe', texto: 'Guardada.' }, 2);
  assert.equal(resposta.conversa.estado, 'ouvindo');
  assert.deepEqual(resposta.efeitos.map((e) => e.tipo), ['pausarVoz', 'falar']);
  c = avanca(resposta.conversa, { tipo: 'zeTerminou' }, 3).conversa;
  const solta = avanca(c, { tipo: 'segurou', ligado: false }, 4);
  assert.equal(solta.conversa.estado, 'falando');
  assert.ok(solta.efeitos.some((e) => e.tipo === 'retomarVoz'));
});

test('soltar a vez durante fala não libera resposta antes de terminar e enviar', () => {
  let c = avanca(ouvindo(), { tipo: 'segurou', ligado: true }, 1).conversa;
  c = avanca(c, { tipo: 'falaIniciou' }, 2).conversa;
  c = avanca(c, { tipo: 'textoDoZe', texto: 'Guardada.' }, 3).conversa;
  const solta = avanca(c, { tipo: 'segurou', ligado: false }, 4);
  assert.equal(solta.conversa.estado, 'ouvindo');
  assert.deepEqual(solta.efeitos, []);
});

test('voz falha durante captura: não interrompe gravação e aguarda fim do agente', () => {
  let c = avanca(ouvindo(), { tipo: 'falaIniciou' }, 1).conversa;
  c = avanca(c, { tipo: 'textoDoZe', texto: 'Guardada.' }, 2).conversa;
  const semVoz = avanca(c, { tipo: 'vozTerminou' }, 3);
  assert.equal(semVoz.conversa.estado, 'ouvindo');
  assert.deepEqual(semVoz.efeitos, []);
  c = avanca(semVoz.conversa, { tipo: 'falaTerminou', audio: new Float32Array([1]) }, 4).conversa;
  const vazia = avanca(c, { tipo: 'transcreveu', texto: '' }, 5);
  assert.equal(vazia.conversa.estado, 'falando');
  assert.equal(avanca(vazia.conversa, { tipo: 'zeTerminou' }, 6).conversa.estado, 'ouvindo');
});

test('fone permanece escutando quando resposta guardada é liberada', () => {
  let c = avanca(ouvindo(), { tipo: 'fone', ligado: true }, 1).conversa;
  c = avanca(c, { tipo: 'falaIniciou' }, 2).conversa;
  c = avanca(c, { tipo: 'textoDoZe', texto: 'Guardada.' }, 3).conversa;
  const r = avanca(c, { tipo: 'falaDescartada' }, 4);
  assert.equal(r.conversa.estado, 'falando');
  assert.equal(r.efeitos.some((e) => e.tipo === 'desligarDetector'), false);
});

test('resposta durante gravação longa não desliga o detector nem toma a vez', () => {
  const captura = avanca(ouvindo(), { tipo: 'falaIniciou' }, 1).conversa;
  const resposta = avanca(captura, { tipo: 'textoDoZe', texto: 'Uma resposta.' }, 20_000);
  assert.equal(resposta.conversa.estado, 'ouvindo');
  assert.deepEqual(resposta.efeitos, [{ tipo: 'pausarVoz' }, { tipo: 'falar', texto: 'Uma resposta.' }]);

  const audio = new Float32Array([.1, .2, .3]);
  const terminou = avanca(resposta.conversa, { tipo: 'falaTerminou', audio }, 40_000);
  assert.equal(terminou.conversa.estado, 'transcrevendo');
  assert.deepEqual(terminou.efeitos, [{ tipo: 'desligarDetector' }, { tipo: 'transcrever', audio }]);
  const transcrita = avanca(terminou.conversa, { tipo: 'transcreveu', texto: 'Minha fala inteira.' }, 41_000);
  assert.ok(transcrita.efeitos.some((e) => e.tipo === 'enviar' && e.texto === 'Minha fala inteira.'));
  const enviada = avanca(transcrita.conversa, { tipo: 'enviou' }, 42_000);
  assert.equal(enviada.conversa.estado, 'falando');
  assert.deepEqual(enviada.efeitos, [{ tipo: 'retomarVoz' }]);
});

test('texto que chega durante a transcrição não faz perder o resultado dela', () => {
  const gravada = avanca(ouvindo(), { tipo: 'falaTerminou', audio: new Float32Array([1]) }, 1).conversa;
  const resposta = avanca(gravada, { tipo: 'textoDoZe', texto: 'Já estou vendo.' }, 2);
  assert.equal(resposta.conversa.estado, 'transcrevendo');
  const transcrita = avanca(resposta.conversa, { tipo: 'transcreveu', texto: 'Complemento gravado.' }, 3);
  assert.ok(transcrita.efeitos.some((e) => e.tipo === 'enviar' && e.texto === 'Complemento gravado.'));
});

test('vários blocos e fim do agente não interrompem a captura em curso', () => {
  let c = avanca(ouvindo(), { tipo: 'falaIniciou' }, 1).conversa;
  for (const texto of ['Primeiro.', 'Segundo.']) {
    const r = avanca(c, { tipo: 'textoDoZe', texto }, 2);
    assert.equal(r.conversa.estado, 'ouvindo');
    assert.equal(r.efeitos.some((e) => e.tipo === 'desligarDetector'), false);
    c = r.conversa;
  }
  const terminou = avanca(c, { tipo: 'zeTerminou' }, 3);
  assert.equal(terminou.conversa.estado, 'ouvindo');
  assert.deepEqual(terminou.efeitos, []);
});

test('transcrição vazia também solta a voz retida', () => {
  let c = avanca(ouvindo(), { tipo: 'falaTerminou', audio: new Float32Array([1]) }, 1).conversa;
  c = avanca(c, { tipo: 'textoDoZe', texto: 'Resposta aguardando.' }, 2).conversa;
  for (const evento of [{ tipo: 'transcreveu', texto: '' }, { tipo: 'falhou', motivo: 'transcricaoVazia' }] as const) {
    const r = avanca(c, evento, 3);
    assert.equal(r.conversa.estado, 'falando');
    assert.ok(r.efeitos.some((e) => e.tipo === 'retomarVoz'));
  }
});

test('tosse descartada libera a resposta aguardando sem mandar fala vazia', () => {
  let c = avanca(ouvindo(), { tipo: 'falaIniciou' }, 1).conversa;
  c = avanca(c, { tipo: 'textoDoZe', texto: 'Resposta aguardando.' }, 2).conversa;
  const r = avanca(c, { tipo: 'falaDescartada' }, 3);
  assert.equal(r.conversa.estado, 'falando');
  assert.deepEqual(r.efeitos, [{ tipo: 'desligarDetector' }, { tipo: 'retomarVoz' }]);
});
