import assert from 'node:assert/strict';
import { test } from 'node:test';
import { iniciaSequencia, type EscutaSequencia, type Sequencia } from './reprodutor-unico.ts';

class AudioFalso extends EventTarget {
  static atual: AudioFalso;
  src = '';
  preload = '';
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 2;
  constructor() { super(); AudioFalso.atual = this; }
  async play() { this.paused = false; this.ended = false; }
  pause() { this.paused = true; }
  termina() { this.currentTime = this.duration; this.ended = true; this.paused = true; this.dispatchEvent(new Event('ended')); }
}

Object.defineProperty(globalThis, 'Audio', { configurable: true, value: AudioFalso });
const escuta = (): EscutaSequencia => ({ aoProgredir() {}, aoTerminar() {}, aoFalhar() { assert.fail('reprodução falhou'); } });

test('apoio entre blocos não deixa referência morta para o próximo áudio', async () => {
  let fila: Sequencia | null = null;
  const abre = () => iniciaSequencia({ ...escuta(), aoTerminar: () => { fila = null; } });
  fila = abre();
  fila.enfileira('bloco-um');
  await Promise.resolve();
  AudioFalso.atual.termina();
  fila.cedeSeVazia?.();
  const apoio = iniciaSequencia(escuta());
  apoio.enfileira('apoio');
  apoio.fecha();
  await Promise.resolve();
  AudioFalso.atual.termina();
  fila ??= abre();
  fila.enfileira('bloco-dois');
  assert.equal(AudioFalso.atual.src, 'bloco-dois');
  fila.para();
});

test('só cede com fila realmente vazia, sem reprodução nem pausa', async () => {
  const fila = iniciaSequencia(escuta());
  fila.enfileira('um');
  fila.enfileira('dois');
  assert.equal(fila.cedeSeVazia?.(), false);
  await Promise.resolve();
  AudioFalso.atual.termina();
  assert.equal(fila.cedeSeVazia?.(), false);
  await Promise.resolve();
  AudioFalso.atual.termina();
  fila.pausa();
  assert.equal(fila.cedeSeVazia?.(), false);
  fila.retoma();
  assert.equal(fila.cedeSeVazia?.(), true);
});

test('fim audível chega no fim do bloco, sem esperar fechamento do turno', async () => {
  let fins = 0;
  const fila = iniciaSequencia({ ...escuta(), aoSilenciar: () => { fins++; } });
  fila.enfileira('um');
  fila.enfileira('dois');
  await Promise.resolve();
  AudioFalso.atual.termina();
  assert.equal(fins, 0);
  await Promise.resolve();
  AudioFalso.atual.termina();
  assert.equal(fins, 1);
  fila.fecha();
  assert.equal(fins, 1);
});
