import assert from 'node:assert/strict';
import { it } from 'node:test';
import { iniciaSequencia } from '../feed/reprodutor-unico.ts';

class AudioSimulado extends EventTarget {
  src = '';
  preload = '';
  currentTime = 0;
  duration = 8;
  paused = true;
  ended = false;
  tocadas: string[] = [];
  async play() { this.paused = false; this.tocadas.push(this.src); }
  pause() { this.paused = true; }
}

it('pausa preserva posição, bloqueia sentença nova e descarta toda a sequência', async () => {
  let audio!: AudioSimulado;
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: class extends AudioSimulado {
    constructor() { super(); audio = this; }
  } });
  let terminou = 0;
  const sequencia = iniciaSequencia({ aoProgredir() {}, aoTerminar() { terminou++; }, aoFalhar() { assert.fail('play falhou'); } });
  sequencia.enfileira('primeiro');
  audio.currentTime = 1.25;
  sequencia.pausa();
  sequencia.enfileira('segundo');
  assert.equal(audio.paused, true);
  assert.deepEqual(audio.tocadas, ['primeiro']);
  sequencia.retoma();
  assert.equal(audio.currentTime, 1.25);
  assert.deepEqual(audio.tocadas, ['primeiro', 'primeiro']);
  sequencia.pausa();
  audio.dispatchEvent(new Event('ended'));
  assert.deepEqual(audio.tocadas, ['primeiro', 'primeiro']);
  sequencia.retoma();
  assert.equal(audio.src, 'segundo');
  sequencia.para();
  sequencia.enfileira('tardio');
  sequencia.retoma();
  sequencia.fecha();
  audio.dispatchEvent(new Event('ended'));
  assert.equal(audio.paused, true);
  assert.equal(terminou, 0);
  assert.deepEqual(audio.tocadas, ['primeiro', 'primeiro', 'segundo']);

  const nova = iniciaSequencia({ aoProgredir() {}, aoTerminar() {}, aoFalhar() {} });
  nova.enfileira('novo turno');
  sequencia.para();
  assert.equal(audio.paused, false, 'sequência cancelada não pode parar o próximo dono');
  nova.para();

  // pause() pode abortar um play() cuja promessa ainda não resolveu.
  let rejeita!: (erro: Error) => void;
  audio.play = () => new Promise<void>((_resolve, reject) => { rejeita = reject; });
  let falhas = 0;
  const abrindo = iniciaSequencia({ aoProgredir() {}, aoTerminar() {}, aoFalhar() { falhas++; } });
  abrindo.enfileira('abrindo');
  abrindo.pausa();
  rejeita(new DOMException('play interrompido pela pausa', 'AbortError'));
  await Promise.resolve();
  assert.equal(falhas, 0, 'pausa intencional não é falha de autoplay');
  abrindo.para();
});
