import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import * as reprodutor from '../feed/reprodutor-unico.ts';
import * as frases from './frases-da-voz.ts';
import * as nivel from './nivel-da-voz.ts';

const requer = createRequire(import.meta.url);
const ts = requer('typescript');
const fonte = readFileSync(new URL('./use-fila-de-voz.ts', import.meta.url), 'utf8');
const compilado = ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

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
  termina() { this.currentTime = 2; this.ended = true; this.paused = true; this.dispatchEvent(new Event('ended')); }
}
Object.defineProperty(globalThis, 'Audio', { configurable: true, value: AudioFalso });
Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });

function monta() {
  const pendentes: any[] = [];
  let terminou = 0;
  let silenciou = 0;
  const ouvidos: number[] = [];
  const modulo = { exports: {} as any };
  const dependencias: Record<string, unknown> = {
    react: {
      useRef: (current: unknown) => ({ current }),
      useCallback: (fn: unknown) => fn,
      useEffect: () => {},
      useState: (valor: unknown) => [valor, () => {}],
    },
    '@/components/feed/reprodutor-unico': reprodutor,
    '@/components/feed/stream-voz': {
      pedeFala: (_texto: string, _slug: string, escuta: unknown) => { pendentes.push(escuta); return { cancela() {} }; },
    },
    './frases-da-voz': frases,
    './nivel-da-voz': nivel,
  };
  new Function('require', 'module', 'exports', compilado)((nome: string) => {
    assert.ok(nome in dependencias, nome);
    return dependencias[nome];
  }, modulo, modulo.exports);
  const fila = modulo.exports.useFilaDeVoz({
    slug: 'teste', aoTerminar: () => terminou++, aoSilenciar: () => silenciou++,
    aoFalhar: () => assert.fail('voz falhou'), aoOuvir: (id: number) => ouvidos.push(id),
  });
  const sintetiza = (url: string) => {
    const escuta = pendentes.shift();
    escuta.aoPeaks(0, 2, [1, 1]);
    escuta.aoAudio(0, url);
    escuta.aoFim();
  };
  return { fila, sintetiza, pendentes, ouvidos, contagem: () => ({ terminou, silenciou }) };
}

test('fila real: bloco 1 → cessão → apoio → bloco 2 não deixa sequência morta', async () => {
  const m = monta();
  m.fila.abreTurno();
  m.fila.enfileira('Primeiro.', 1);
  m.sintetiza('bloco-um');
  await Promise.resolve();
  AudioFalso.atual.termina();
  m.fila.preparaApoio?.();
  const apoio = reprodutor.iniciaSequencia({ aoProgredir() {}, aoTerminar() {}, aoFalhar() { assert.fail(); } });
  apoio.enfileira('apoio');
  apoio.fecha();
  await Promise.resolve();
  AudioFalso.atual.termina();
  m.fila.enfileira('Segundo.', 2);
  m.sintetiza('bloco-dois');
  assert.equal(AudioFalso.atual.src, 'bloco-dois');
  await Promise.resolve();
  m.fila.fechaTurno();
  AudioFalso.atual.termina();
  assert.deepEqual(m.ouvidos, [1, 2]);
  assert.equal(m.contagem().silenciou, 2);
  m.fila.cancela();
});

test('fila real nega cessão durante síntese, reprodução, pausa e turno encerrado', async () => {
  const m = monta();
  m.fila.abreTurno();
  m.fila.enfileira('Primeiro.');
  assert.equal(m.fila.preparaApoio?.(), false);
  m.sintetiza('um');
  assert.equal(m.fila.preparaApoio?.(), false);
  await Promise.resolve();
  AudioFalso.atual.termina();
  m.fila.pausa();
  assert.equal(m.fila.preparaApoio?.(), false);
  m.fila.retoma();
  assert.equal(m.fila.preparaApoio?.(), true);
  m.fila.fechaTurno();
  assert.equal(m.fila.preparaApoio?.(), false);
  m.fila.cancela();
});
