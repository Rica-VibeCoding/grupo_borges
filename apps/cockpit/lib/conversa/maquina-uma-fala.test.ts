import assert from 'node:assert/strict';
import { test } from 'node:test';

import { entradaDoMicrofone, toqueDoMicrofone } from '../../components/conversa/entrada-do-microfone.ts';
import { avanca, inicial } from './maquina.ts';
import type { Conversa, Efeito, Evento } from './tipos.ts';
import { umaFalaAberta } from './uma-fala.ts';

// Pedido do Rica (02/10), iPhone sem fone: na vez dele o microfone fecha e o botão do canto mostra
// isso; tocar nele abre só para uma fala, sem frear — a fala vai para a fila e o microfone fecha ao
// fim dela. O toque na tela segue freando. Com fone, nada muda.

function roda(eventos: Evento[], de: Conversa = inicial()): { conversa: Conversa; efeitos: Efeito[] } {
  let conversa = de;
  const efeitos: Efeito[] = [];
  eventos.forEach((evento, i) => {
    const r = avanca(conversa, evento, i * 100);
    conversa = r.conversa;
    efeitos.push(...r.efeitos);
  });
  return { conversa, efeitos };
}

const tipos = (efeitos: Efeito[]) => efeitos.map((e) => e.tipo);
const audio = new Float32Array(0);
const esperando = (fone: boolean) => roda([
  { tipo: 'fone', ligado: fone },
  { tipo: 'comecar' },
  { tipo: 'falaTerminou', audio },
  { tipo: 'transcreveu', texto: 'oi' },
  { tipo: 'enviou' },
]).conversa;
const aberta = () => roda([{ tipo: 'abrirUmaFala' }], esperando(false)).conversa;
const entrada = (c: Conversa, fone = false) => entradaDoMicrofone(c, fone, false);

test('sem fone, na vez dele, o botão mostra a entrada fechada e o toque abre uma fala', () => {
  const espera = esperando(false);
  assert.equal(entrada(espera), 'fechada');
  assert.equal(toqueDoMicrofone(entrada(espera)), 'abrirUmaFala');
});

test('a uma fala: abre sem frear, vai para a fila e o microfone fecha ao fim dela', () => {
  const abre = roda([{ tipo: 'abrirUmaFala' }], esperando(false));
  assert.equal(abre.conversa.estado, 'ouvindo');
  assert.deepEqual(tipos(abre.efeitos), ['ligarDetector']);
  assert.ok(umaFalaAberta(abre.conversa));
  assert.equal(entrada(abre.conversa), 'umaFala');

  const fala = roda([{ tipo: 'falaIniciou' }, { tipo: 'falaTerminou', audio }], abre.conversa);
  assert.equal(fala.conversa.estado, 'transcrevendo');
  assert.deepEqual(tipos(fala.efeitos), ['desligarDetector', 'transcrever'], 'fim de fala fecha o microfone');
  assert.equal(entrada(fala.conversa), 'fechadaSemToque');

  const envio = roda([{ tipo: 'transcreveu', texto: 'e mais isso' }, { tipo: 'enviou' }], fala.conversa);
  assert.deepEqual(envio.efeitos.find((e) => e.tipo === 'enviar'), { tipo: 'enviar', texto: 'e mais isso' });
  assert.equal(envio.conversa.estado, 'esperandoZe');
  assert.ok(!tipos(envio.efeitos).includes('ligarDetector'), 'a espera volta fechada');
  assert.equal(entrada(envio.conversa), 'fechada');

  const tudo = [...abre.efeitos, ...fala.efeitos, ...envio.efeitos];
  assert.ok(!tipos(tudo).includes('frearZe'));
  assert.ok(!tipos(tudo).includes('descartarVoz'));
});

test('a tosse não gasta a uma fala: o microfone segue aberto', () => {
  const { conversa, efeitos } = roda([{ tipo: 'falaIniciou' }, { tipo: 'falaDescartada' }], aberta());
  assert.equal(conversa.estado, 'ouvindo');
  assert.ok(umaFalaAberta(conversa));
  assert.deepEqual(efeitos, []);
});

test('fala vazia volta a esperar com o microfone fechado', () => {
  const { conversa, efeitos } = roda([{ tipo: 'falaIniciou' }, { tipo: 'falaTerminou', audio }, { tipo: 'transcreveu', texto: ' ' }], aberta());
  assert.equal(conversa.estado, 'esperandoZe');
  assert.ok(!tipos(efeitos).includes('ligarDetector'));
});

test('tocar de novo antes de falar fecha; falando, o toque não corta a fala', () => {
  const fecha = roda([{ tipo: 'fecharUmaFala' }], aberta());
  assert.equal(fecha.conversa.estado, 'esperandoZe');
  assert.deepEqual(tipos(fecha.efeitos), ['desligarDetector']);

  const falando = roda([{ tipo: 'falaIniciou' }, { tipo: 'fecharUmaFala' }], aberta());
  assert.equal(falando.conversa.estado, 'ouvindo');
  assert.deepEqual(falando.efeitos, []);
});

test('o mudo ou a tela saindo, com a uma fala aberta, voltam a esperar fechados', () => {
  const { conversa, efeitos } = roda([{ tipo: 'microfoneMudo' }], aberta());
  assert.equal(conversa.estado, 'esperandoZe');
  assert.deepEqual(tipos(efeitos), ['desligarDetector']);
});

test('a resposta chegando antes de ele falar fecha o microfone e fala', () => {
  const { conversa, efeitos } = roda([{ tipo: 'textoDoZe', texto: 'pronto' }], aberta());
  assert.equal(conversa.estado, 'falando');
  assert.deepEqual(tipos(efeitos), ['desligarDetector', 'falar']);
  assert.equal(entrada(conversa), 'fechadaSemToque');
});

test('o turno fechando com a uma fala aberta vira a vez dele, de microfone aberto', () => {
  const { conversa, efeitos } = roda([{ tipo: 'zeTerminou' }], aberta());
  assert.equal(conversa.estado, 'ouvindo');
  assert.deepEqual(efeitos, []);
  assert.ok(!umaFalaAberta(conversa));
  assert.equal(entrada(conversa), 'aberta');
});

test('o toque na tela na vez dele segue freando — com a entrada fechada ou com a uma fala aberta', () => {
  const fechada = roda([{ tipo: 'interromper', rodando: true }], esperando(false));
  assert.ok(tipos(fechada.efeitos).includes('frearZe'));
  assert.equal(fechada.conversa.estado, 'ouvindo');

  const aberto = roda([{ tipo: 'interromper', rodando: true }], aberta());
  assert.ok(tipos(aberto.efeitos).includes('frearZe'));
  assert.equal(aberto.conversa.estado, 'ouvindo');
  assert.ok(!umaFalaAberta(aberto.conversa), 'freado, a vez é dele por inteiro');
  const vazia = roda([{ tipo: 'falaIniciou' }, { tipo: 'falaTerminou', audio }, { tipo: 'transcreveu', texto: '' }], aberto.conversa);
  assert.equal(vazia.conversa.estado, 'ouvindo', 'não volta a esperar um Zé freado');
});

test('com fone, nada muda: a espera já ouve e o botão é o mudo', () => {
  const espera = esperando(true);
  assert.equal(entrada(espera, true), 'aberta');
  assert.equal(toqueDoMicrofone(entrada(espera, true)), 'mudar');
  const { conversa, efeitos } = roda([{ tipo: 'abrirUmaFala' }], espera);
  assert.equal(conversa, espera);
  assert.deepEqual(efeitos, []);
});

test('mudo vence: o botão liga o microfone, como sempre', () => {
  assert.equal(entradaDoMicrofone(esperando(false), false, true), 'mudo');
  assert.equal(toqueDoMicrofone('mudo'), 'mudar');
});

test('fora da vez dele (falando ou parado), abrir uma fala não faz nada', () => {
  const parado = inicial();
  assert.deepEqual(roda([{ tipo: 'abrirUmaFala' }], parado).efeitos, []);
  assert.equal(toqueDoMicrofone('fechadaSemToque'), 'nada');
});
