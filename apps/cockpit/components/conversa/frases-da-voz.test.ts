import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { audioTocando, falaDoZe, frasesDoTexto, inicioDasPalavras, palavrasAte, palavrasDe } from './frases-da-voz.ts';

describe('as frases da resposta, no corte da voz', () => {
  it('corta na pontuação final e na linha em branco, como o servidor corta o áudio', () => {
    assert.deepEqual(frasesDoTexto('Sol o dia todo. Máxima de 31! Chove amanhã? Não…  Talvez.'), [
      'Sol o dia todo.',
      'Máxima de 31!',
      'Chove amanhã?',
      'Não…',
      'Talvez.',
    ]);
    assert.deepEqual(frasesDoTexto('Primeiro bloco\n\nSegundo bloco'), ['Primeiro bloco', 'Segundo bloco']);
  });

  it('abreviação não encerra frase', () => {
    assert.deepEqual(frasesDoTexto('Falei com o Dr. Silva hoje. Ele confirmou.'), ['Falei com o Dr. Silva hoje.', 'Ele confirmou.']);
  });

  it('texto vazio não tem frase', () => {
    assert.deepEqual(frasesDoTexto('   '), []);
  });
});

describe('qual áudio está tocando', () => {
  const inicios = [0, 2.4, 5.1];

  it('troca no início de cada áudio, pelo relógio do reprodutor', () => {
    assert.equal(audioTocando(inicios, 0), 0);
    assert.equal(audioTocando(inicios, 1.9), 0);
    assert.equal(audioTocando(inicios, 2.4), 1);
    assert.equal(audioTocando(inicios, 4), 1);
    assert.equal(audioTocando(inicios, 5.2), 2);
    assert.equal(audioTocando(inicios, 60), 2);
  });

  it('a duração medida no navegador pode ficar um fio abaixo da do servidor: ainda troca na hora', () => {
    assert.equal(audioTocando(inicios, 2.35), 1);
  });

  it('sem áudio, nada tocando', () => {
    assert.equal(audioTocando([], 3), -1);
  });
});

describe('a fala dele na legenda', () => {
  const a = 'Sol o dia todo. Máxima de 31 graus.';
  const b = 'Amanhã chove.';
  const audios = [
    { texto: a, frase: 0, duracao: 1.5 },
    { texto: a, frase: 1, duracao: 1.8 },
    { texto: b, frase: 0, duracao: 1.2 },
  ];

  it('antes do primeiro áudio, nada da resposta aparece', () => {
    assert.equal(falaDoZe(audios, -1), null);
  });

  it('a primeira frase sozinha, com a duração do áudio dela', () => {
    assert.deepEqual(falaDoZe(audios, 0), { dito: [], atual: 'Sol o dia todo.', indice: 0, duracao: 1.5 });
  });

  it('o que já foi dito fica, inteiro, antes da frase que toca — inclusive de outro bloco', () => {
    assert.deepEqual(falaDoZe(audios, 1), { dito: ['Sol o dia todo.'], atual: 'Máxima de 31 graus.', indice: 1, duracao: 1.8 });
    assert.deepEqual(falaDoZe(audios, 2), {
      dito: ['Sol o dia todo.', 'Máxima de 31 graus.'],
      atual: 'Amanhã chove.',
      indice: 2,
      duracao: 1.2,
    });
  });

  it('servidor cortou em mais frases que a tela: fica na última, sem repetir', () => {
    const mais = [...audios, { texto: b, frase: 1, duracao: 0.8 }];
    assert.deepEqual(falaDoZe(mais, 3)?.dito, ['Sol o dia todo.', 'Máxima de 31 graus.']);
    assert.equal(falaDoZe(mais, 3)?.atual, 'Amanhã chove.');
  });
});

describe('palavra por palavra, ao longo do áudio', () => {
  const palavras = palavrasDe('Sol o dia todo, máxima de 31.');
  const inicios = inicioDasPalavras(palavras, 3);

  it('a primeira entra com o áudio; as outras em ordem, antes do fim (o fim é respiro)', () => {
    assert.equal(inicios[0], 0);
    for (let i = 1; i < inicios.length; i += 1) assert.ok(inicios[i] > inicios[i - 1]);
    assert.ok(inicios[inicios.length - 1] < 3 * 0.9);
  });

  it('palavra longa ocupa mais tempo que curta', () => {
    assert.ok(inicios[1] - inicios[0] > inicios[2] - inicios[1]);
  });

  it('quantas já entraram: uma no começo, todas no fim, e nunca volta', () => {
    assert.equal(palavrasAte(inicios, 0), 1);
    assert.ok(palavrasAte(inicios, 1.5) >= palavrasAte(inicios, 1));
    assert.equal(palavrasAte(inicios, 3), palavras.length);
  });
});
