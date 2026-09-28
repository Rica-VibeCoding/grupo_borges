import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { criaEspelhoDaFala, QUADROS_DE_PRE_GRAVACAO, type Comando } from './espelho-da-fala.ts';

// Um quadro do detector: 512 amostras a 16 kHz (32 ms). O valor marca a ordem.
const q = (n: number) => new Float32Array(512).fill(n / 1000);
const marcas = (comandos: Comando[]) =>
  comandos.map((c) => (c.tipo === 'limpa' ? 'limpa' : c.quadros.map((quadro) => Math.round(quadro[0] * 1000))));
const junta = (comandos: Comando[]) => marcas(comandos).flat();

describe('espelho da fala: o canal recebe o mesmo trecho que o WAV levaria', () => {
  it('canal aberto antes da fala: o silêncio não sai; a fala leva a pré-gravação e segue quadro a quadro', () => {
    const e = criaEspelhoDaFala({ preGravacao: 3 });
    e.abrindo();
    assert.deepEqual(e.abriu(), []);
    for (let n = 1; n <= 5; n++) assert.deepEqual(e.quadro(q(n)), [], 'silêncio antes da fala não entra no canal');
    // O detector entrega o quadro antes de dizer que a fala começou: ele já é pré-gravação.
    e.quadro(q(6));
    assert.deepEqual(marcas(e.inicio()), [[4, 5, 6]]);
    assert.deepEqual(marcas(e.quadro(q(7))), [[7]]);
    assert.deepEqual(marcas(e.quadro(q(8))), [[8]]);
    assert.equal(e.fim(), 'aoVivo');
  });

  it('a pré-gravação padrão é a do detector: 800 ms mais o quadro que disparou a fala', () => {
    assert.equal(QUADROS_DE_PRE_GRAVACAO, 26);
  });

  it('canal que abre no meio da fala recebe tudo de uma vez, em ordem, e depois segue ao vivo', () => {
    const e = criaEspelhoDaFala({ preGravacao: 2 });
    e.abrindo();
    e.quadro(q(1));
    e.quadro(q(2));
    assert.deepEqual(e.inicio(), []);
    assert.deepEqual(e.quadro(q(3)), []);
    assert.deepEqual(e.quadro(q(4)), []);
    assert.deepEqual(junta(e.abriu()), [1, 2, 3, 4]);
    assert.deepEqual(marcas(e.quadro(q(5))), [[5]]);
    assert.equal(e.fim(), 'aoVivo');
  });

  it('canal que não abriu até o fim da fala: cai no WAV', () => {
    const e = criaEspelhoDaFala({ preGravacao: 2 });
    e.abrindo();
    e.quadro(q(1));
    e.inicio();
    e.quadro(q(2));
    assert.equal(e.fim(), 'arquivo');
  });

  it('sem canal nenhum (bilhete negado): cai no WAV', () => {
    const e = criaEspelhoDaFala({ preGravacao: 2 });
    e.abrindo();
    e.caiu();
    e.quadro(q(1));
    e.inicio();
    e.quadro(q(2));
    assert.equal(e.fim(), 'arquivo');
  });

  it('canal que cai no meio da fala: cai no WAV, mesmo que outro abra antes do fim', () => {
    const e = criaEspelhoDaFala({ preGravacao: 2 });
    e.abrindo();
    e.abriu();
    e.quadro(q(1));
    e.inicio();
    e.quadro(q(2));
    e.caiu();
    e.quadro(q(3));
    e.abrindo();
    assert.deepEqual(e.abriu(), [], 'a fala pela metade não é reenviada');
    assert.deepEqual(e.quadro(q(4)), []);
    assert.equal(e.fim(), 'arquivo');
  });

  it('fala descartada pelo detector limpa o canal e não gruda na próxima', () => {
    const e = criaEspelhoDaFala({ preGravacao: 2 });
    e.abrindo();
    e.abriu();
    e.quadro(q(1));
    e.inicio();
    e.quadro(q(2));
    assert.deepEqual(marcas(e.descarte()), ['limpa']);
    // Depois do descarte o detector recomeça a pré-gravação do zero.
    e.quadro(q(10));
    e.quadro(q(11));
    e.quadro(q(12));
    assert.deepEqual(marcas(e.inicio()), [[11, 12]], 'a fala nova começa limpa, sem o 1 e o 2');
    assert.equal(e.fim(), 'aoVivo');
  });

  it('fala descartada antes de o canal abrir não manda nada nem pede limpeza', () => {
    const e = criaEspelhoDaFala({ preGravacao: 2 });
    e.abrindo();
    e.quadro(q(1));
    e.inicio();
    e.quadro(q(2));
    assert.deepEqual(e.descarte(), []);
    assert.deepEqual(e.abriu(), [], 'o canal abre vazio');
    assert.equal(e.fim(), 'arquivo', 'sem fala em curso não há o que confirmar');
  });

  it('fala que recomeça sem descarte (detector trocado no meio) limpa o que já tinha subido', () => {
    const e = criaEspelhoDaFala({ preGravacao: 1 });
    e.abrindo();
    e.abriu();
    e.quadro(q(1));
    e.inicio();
    e.quadro(q(2));
    e.quadro(q(9));
    assert.deepEqual(marcas(e.inicio()), ['limpa', [9]]);
  });

  it('depois do fim, o que o detector ainda entregar não entra no canal', () => {
    const e = criaEspelhoDaFala({ preGravacao: 1 });
    e.abrindo();
    e.abriu();
    e.quadro(q(1));
    e.inicio();
    assert.equal(e.fim(), 'aoVivo');
    assert.deepEqual(e.quadro(q(2)), []);
    assert.equal(e.fim(), 'arquivo', 'fim repetido não confirma de novo');
  });

  it('fala mais longa que o teto de espera do canal: solta a memória e cai no WAV', () => {
    const e = criaEspelhoDaFala({ preGravacao: 1, teto: 3 });
    e.abrindo();
    e.quadro(q(1));
    e.inicio();
    e.quadro(q(2));
    e.quadro(q(3));
    e.quadro(q(4));
    assert.deepEqual(e.abriu(), [], 'não sobe fala pela metade');
    assert.equal(e.fim(), 'arquivo');
  });

  it('fala que começou fora da vez (por cima, com fone) sobe inteira quando o canal abre', () => {
    const e = criaEspelhoDaFala({ preGravacao: 1 });
    e.quadro(q(1));
    e.inicio();
    e.quadro(q(2));
    e.abrindo();
    e.quadro(q(3));
    assert.deepEqual(junta(e.abriu()), [1, 2, 3]);
    assert.equal(e.fim(), 'aoVivo');
  });
});
