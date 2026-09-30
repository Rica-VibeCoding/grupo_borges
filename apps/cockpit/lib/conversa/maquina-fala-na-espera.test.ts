import assert from 'node:assert/strict';
import { test } from 'node:test';

import { avanca, inicial } from './maquina.ts';
import type { Conversa, Efeito, Evento } from './tipos.ts';

// O desenho das interrupções (30/09): só o toque freia o Zé. Falar enquanto ele pensa entra na
// fila do Claude Code sem frear, com ou sem fone (sem fone, a tela ignora a fala que começa com a
// frase de apoio tocando — `eventos-do-detector.ts`).

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
const ateEspera = (fone: boolean): Evento[] => [
  { tipo: 'fone', ligado: fone },
  { tipo: 'comecar' },
  { tipo: 'falaTerminou', audio },
  { tipo: 'transcreveu', texto: 'oi' },
  { tipo: 'enviou' },
];
const esperando = (fone: boolean) => roda(ateEspera(fone)).conversa;

for (const fone of [true, false]) {
  const com = fone ? 'com fone' : 'sem fone';

  test(`${com}, esperar pelo Zé deixa o microfone ouvindo`, () => {
    const { conversa, efeitos } = roda(ateEspera(fone));
    assert.equal(conversa.estado, 'esperandoZe');
    assert.equal(tipos(efeitos).at(-1), 'ligarDetector');
  });

  test(`${com}, falar enquanto ele pensa vai para a fila sem frear`, () => {
    const { conversa, efeitos } = roda(
      [{ tipo: 'falaIniciou' }, { tipo: 'falaTerminou', audio }, { tipo: 'transcreveu', texto: 'e mais isso' }, { tipo: 'enviou' }],
      esperando(fone),
    );
    assert.ok(!tipos(efeitos).includes('frearZe'));
    assert.deepEqual(efeitos.find((e) => e.tipo === 'enviar'), { tipo: 'enviar', texto: 'e mais isso' });
    assert.equal(conversa.estado, 'esperandoZe');
    assert.equal(tipos(efeitos).at(-1), 'ligarDetector');
  });
}

test('tosse na espera volta a esperar, não a ouvir', () => {
  const { conversa, efeitos } = roda([{ tipo: 'falaIniciou' }, { tipo: 'falaDescartada' }], esperando(true));
  assert.equal(conversa.estado, 'esperandoZe');
  assert.ok(!tipos(efeitos).includes('frearZe'));
});

test('transcrição vazia na espera volta a esperar com o microfone ouvindo', () => {
  const { conversa, efeitos } = roda(
    [{ tipo: 'falaIniciou' }, { tipo: 'falaTerminou', audio }, { tipo: 'transcreveu', texto: ' ' }],
    esperando(true),
  );
  assert.equal(conversa.estado, 'esperandoZe');
  assert.equal(tipos(efeitos).at(-1), 'ligarDetector');
});

test('o Zé termina enquanto ele fala na espera: fala vazia volta a ouvir, não a esperar para sempre', () => {
  const { conversa } = roda(
    [{ tipo: 'falaIniciou' }, { tipo: 'zeTerminou' }, { tipo: 'falaTerminou', audio }, { tipo: 'transcreveu', texto: '' }],
    esperando(true),
  );
  assert.equal(conversa.estado, 'ouvindo');
});

test('a resposta chega enquanto ele fala na espera: a voz espera a fala dele sair', () => {
  const { conversa, efeitos } = roda(
    [{ tipo: 'falaIniciou' }, { tipo: 'textoDoZe', texto: 'Olhei.' }, { tipo: 'falaTerminou', audio }, { tipo: 'transcreveu', texto: 'e isso' }, { tipo: 'enviou' }],
    esperando(true),
  );
  assert.deepEqual(tipos(efeitos).filter((t) => t !== 'tocarTique' && t !== 'transcrever' && t !== 'enviar'),
    ['pausarVoz', 'falar', 'desligarDetector', 'retomarVoz', 'ligarDetector']);
  assert.equal(conversa.estado, 'falando');
});

test('parar sem freio (a tela saiu) não freia o Zé, mas descarta o resto do turno', () => {
  const { conversa, efeitos } = roda([{ tipo: 'parar', semFreio: true }], esperando(false));
  assert.equal(conversa.estado, 'parado');
  assert.ok(!tipos(efeitos).includes('frearZe'));
  assert.equal(roda([{ tipo: 'comecar' }, { tipo: 'textoDoZe', texto: 'resto' }], conversa).conversa.estado, 'ouvindo');
});

test('parar pelo toque continua freando', () => {
  assert.ok(tipos(roda([{ tipo: 'parar' }], esperando(false)).efeitos).includes('frearZe'));
});
