import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { TETO_FALAS, esqueceTudo, falaGuardada, guardaFala } from './falas-guardadas.ts';
import { type EstadoRevelacao } from './bolha-voz.ts';

/** As URLs que o módulo mandou revogar — revogar cedo é o defeito caro aqui:
 *  URL de objeto revogada não toca e não avisa, e a fala some sem erro. */
const revogadas: string[] = [];
URL.revokeObjectURL = (url: string) => {
  revogadas.push(url);
};

function estado(duracaoReal: number): EstadoRevelacao {
  return {
    peaks: [31, 10, 31],
    duracaoEstimada: duracaoReal,
    duracoesReais: [duracaoReal],
    estimativasPorSentenca: [duracaoReal],
    duracaoReal,
    peaksPorSegundo: 20,
  };
}

function fala(sufixo: string) {
  return { urls: [`blob:${sufixo}-0`, `blob:${sufixo}-1`], est: estado(4), degradada: false };
}

describe('falas-guardadas', () => {
  beforeEach(() => {
    esqueceTudo();
    revogadas.length = 0;
  });

  it('devolve a fala inteira do texto já sintetizado', () => {
    // O ponto do módulo: o segundo toque sai DAQUI e não abre o stream de novo.
    guardaFala('Está pronto.', fala('a'));

    const achada = falaGuardada('Está pronto.');
    assert.deepEqual(achada?.urls, ['blob:a-0', 'blob:a-1']);
    // A onda e o aviso viajam junto: sem os peaks, o retoque tocaria com a
    // onda vazia, e o passado (o que ele já ouviu) teria mudado de forma.
    assert.equal(achada?.est.duracaoReal, 4);
    assert.equal(achada?.degradada, false);
    assert.deepEqual(revogadas, []);
  });

  it('não devolve áudio de outro texto', () => {
    // Mensagem editada tem texto diferente — reaproveitar seria falar errado.
    guardaFala('Está pronto.', fala('a'));
    assert.equal(falaGuardada('Está pronto!'), null);
  });

  it('re-sintetizar o mesmo texto revoga o áudio velho', () => {
    // Fala interrompida e refeita deixava um MP3 órfão na memória da aba.
    guardaFala('Está pronto.', fala('a'));
    guardaFala('Está pronto.', fala('b'));

    assert.deepEqual(revogadas, ['blob:a-0', 'blob:a-1']);
    assert.deepEqual(falaGuardada('Está pronto.')?.urls, ['blob:b-0', 'blob:b-1']);
  });

  it('estourar o teto expulsa a fala menos ouvida, e só ela', () => {
    for (let i = 0; i < TETO_FALAS; i += 1) guardaFala(`texto ${i}`, fala(String(i)));
    guardaFala('texto novo', fala('novo'));

    assert.deepEqual(revogadas, ['blob:0-0', 'blob:0-1']);
    assert.equal(falaGuardada('texto 0'), null);
    assert.notEqual(falaGuardada('texto 1'), null);
    assert.notEqual(falaGuardada('texto novo'), null);
  });

  it('ouvir de novo salva a fala da expulsão', () => {
    // A resposta que o Rica volta a tocar é justamente a que não pode sair.
    for (let i = 0; i < TETO_FALAS; i += 1) guardaFala(`texto ${i}`, fala(String(i)));
    assert.notEqual(falaGuardada('texto 0'), null);

    guardaFala('texto novo', fala('novo'));

    assert.notEqual(falaGuardada('texto 0'), null);
    assert.equal(falaGuardada('texto 1'), null);
    assert.deepEqual(revogadas, ['blob:1-0', 'blob:1-1']);
  });
});
