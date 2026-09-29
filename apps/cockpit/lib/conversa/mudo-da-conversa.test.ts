import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avanca, inicial } from './maquina.ts';
import { falaDepois } from '../../components/conversa/fala-da-vez.ts';
const mudo = { tipo: 'microfoneMudo' } as const;
const inicio = () => avanca(inicial(), { tipo: 'comecar' }, 0).conversa;

test('mudo limpa palavras parciais da TV sem apagar pedido já aceito', () => {
  assert.deepEqual(falaDepois({ firme: null, parcial: 'TV ao fundo' }, 'ouvindo', mudo, 'ouvindo'), { firme: null, parcial: null });
  assert.deepEqual(falaDepois({ firme: 'Pedido aceito.', parcial: null }, 'esperandoZe', mudo, 'esperandoZe'), { firme: 'Pedido aceito.', parcial: null });
});

test('mudo no meio da captura libera resposta guardada sem parar agente', () => {
  let c = avanca(inicio(), { tipo: 'falaIniciou' }, 1).conversa;
  c = avanca(c, { tipo: 'textoDoZe', texto: 'Resposta.' }, 2).conversa;
  const r = avanca(c, mudo, 3);
  assert.equal(r.conversa.estado, 'falando');
  assert.ok(r.efeitos.some((e) => e.tipo === 'retomarVoz'));
  assert.equal(r.efeitos.some((e) => e.tipo === 'frearZe' || e.tipo === 'descartarVoz'), false);
});

test('mudo abandona transcrição ainda não enviada e não aceita resultado tardio', () => {
  let c = avanca(inicio(), { tipo: 'falaTerminou', audio: new Float32Array([1]) }, 1).conversa;
  c = avanca(c, mudo, 2).conversa;
  assert.equal(c.estado, 'ouvindo');
  assert.deepEqual(avanca(c, { tipo: 'transcreveu', texto: 'TV.' }, 3).efeitos, []);
});

test('mudo não perde confirmação de pedido cujo envio já começou', () => {
  let c = avanca(inicio(), { tipo: 'falaTerminou', audio: new Float32Array([1]) }, 1).conversa;
  c = avanca(c, { tipo: 'transcreveu', texto: 'Pedido aceito.' }, 2).conversa;
  c = avanca(c, mudo, 3).conversa;
  assert.equal(c.estado, 'transcrevendo');
  assert.equal(avanca(c, { tipo: 'enviou' }, 4).conversa.estado, 'esperandoZe');
});

test('mudo durante resposta não cancela nem fecha a voz', () => {
  const c = avanca(inicio(), { tipo: 'textoDoZe', texto: 'Resposta.' }, 1).conversa;
  const r = avanca(c, mudo, 2);
  assert.equal(r.conversa.estado, 'falando');
  assert.deepEqual(r.efeitos, []);
});

test('mudo durante fala por cima retoma resposta pausada', () => {
  let c = avanca(inicio(), { tipo: 'fone', ligado: true }, 1).conversa;
  c = avanca(c, { tipo: 'textoDoZe', texto: 'Resposta.' }, 2).conversa;
  c = avanca(c, { tipo: 'falaIniciou' }, 3).conversa;
  const r = avanca(c, mudo, 4);
  assert.equal(r.conversa.estado, 'falando');
  assert.ok(r.efeitos.some((e) => e.tipo === 'retomarVoz'));
  assert.equal(r.efeitos.some((e) => e.tipo === 'frearZe'), false);
});
