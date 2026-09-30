import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import type { EscutaVoz, MetaVoz } from '../feed/stream-voz.ts';

const ts = createRequire(import.meta.url)('typescript');
const fonte = readFileSync(new URL('./use-voz-de-apoio.ts', import.meta.url), 'utf8');
const compilado = ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const vez = () => new Promise<void>((r) => setImmediate(r));
const meta = (degraded: boolean) => ({ degraded }) as MetaVoz;

/** A síntese do apoio, com a rota de voz falsa: devolve a escuta e o que foi cortado/liberado. */
function monta() {
  const escutas: EscutaVoz[] = [];
  const liberados: string[] = [];
  let cortes = 0;
  let sintetiza: (texto: string) => Promise<string[]> = () => Promise.reject(new Error('sem apoio'));
  const modulo = { exports: {} as any };
  const dependencias: Record<string, unknown> = {
    react: { useRef: (current: unknown) => ({ current }), useMemo: (fn: () => unknown) => fn(), useEffect() {} },
    '@/components/feed/reprodutor-unico': { estaTocando: () => false, iniciaSequencia() {} },
    '@/components/feed/stream-voz': {
      pedeFala: (_texto: string, _slug: string, escuta: EscutaVoz) => { escutas.push(escuta); return { cancela: () => { cortes++; } }; },
    },
    './enfeite-do-apoio': { criaEnfeiteDoApoio: () => (texto: string) => texto },
    './voz-de-apoio': { criaVozDeApoio: (p: { sintetiza: typeof sintetiza }) => { sintetiza = p.sintetiza; return { cala() {} }; } },
  };
  const URLFalsa = { revokeObjectURL: (url: string) => liberados.push(url) };
  new Function('require', 'module', 'exports', 'URL', compilado)(
    (nome: string) => { assert.ok(nome in dependencias, nome); return dependencias[nome]; }, modulo, modulo.exports, URLFalsa,
  );
  modulo.exports.useVozDeApoio({ slug: 'teste', cancelaTurno() {}, cabecalhoAtual: () => null });
  return { sintetiza: (texto: string) => sintetiza(texto), escutas, liberados, cortes: () => cortes };
}

test('voz do agente inteira vira as URLs do apoio', async () => {
  const m = monta();
  const pedido = m.sintetiza('Conferir a fila');
  const e = m.escutas[0];
  e.aoMeta(meta(false));
  e.aoAudio(0, 'blob:1');
  e.aoFim(1);
  assert.deepEqual(await pedido, ['blob:1']);
});

test('voz trocada no meta é descartada: falha, corta o stream e libera o que chegar', async () => {
  const m = monta();
  const pedido = m.sintetiza('Conferir a fila');
  const e = m.escutas[0];
  e.aoMeta(meta(true));
  e.aoAudio(0, 'blob:edge');
  e.aoFim(1);
  await assert.rejects(pedido);
  assert.equal(m.cortes(), 1);
  assert.deepEqual(m.liberados, ['blob:edge']);
});

test('voz trocada no meio da fala descarta também o áudio que já tinha chegado', async () => {
  const m = monta();
  const pedido = m.sintetiza('Conferir a fila. E a resposta.');
  const e = m.escutas[0];
  e.aoMeta(meta(false));
  e.aoAudio(0, 'blob:1');
  e.aoDegradou?.();
  e.aoFim(2);
  await assert.rejects(pedido);
  await vez();
  assert.deepEqual(m.liberados, ['blob:1']);
});
