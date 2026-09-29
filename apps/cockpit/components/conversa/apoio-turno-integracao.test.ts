import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { criaRelogioDoApoio } from './apoio-da-espera.ts';
import { cabecalhoDaFerramenta } from './cabecalho-da-ferramenta.ts';

const ts = createRequire(import.meta.url)('typescript');
const fonte = readFileSync(new URL('./use-apoio-da-ferramenta.ts', import.meta.url), 'utf8');
const compilado = ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const ferramenta = (id: number, description?: string) => ({ id, message: { role: 'assistant', content: [{ type: 'tool_use', input: { description } }] } });

function monta() {
  let agora = 0;
  let tique = () => {};
  let caladas = 0;
  let tocando = false;
  const falas: string[] = [];
  const p = {
    slug: 'teste', sons() {}, cancelaTurno() {}, preparaApoio: () => true,
    conversaRef: { current: { estado: 'esperandoZe' } as Record<string, unknown> },
    sessaoAtivaRef: { current: true }, despachaRef: { current() {} },
    mensagens: [ferramenta(10, 'Conferindo a ferramenta antiga')],
  };
  const modulo = { exports: {} as any };
  const dependencias: Record<string, unknown> = {
    react: { useRef: (current: unknown) => ({ current }), useMemo: (fn: () => unknown) => fn(), useEffect: (fn: () => unknown) => fn() },
    '../feed/reprodutor-unico': { estaTocando: () => tocando },
    './apoio-da-espera': { criaRelogioDoApoio },
    './cabecalho-da-ferramenta': { cabecalhoDaFerramenta },
    './use-voz-de-apoio': { useVozDeApoio: () => ({ cabecalho: (texto: string) => falas.push(texto), cala: () => caladas++, erro() {} }) },
  };
  new Function('require', 'module', 'exports', 'window', 'performance', compilado)(
    (nome: string) => { assert.ok(nome in dependencias, nome); return dependencias[nome]; }, modulo, modulo.exports,
    { setInterval: (fn: () => void) => { tique = fn; }, clearInterval() {} }, { now: () => agora },
  );
  const apoio = modulo.exports.useApoioDaFerramenta(p);
  return { p, apoio, falas, caladas: () => caladas, ocupa: (valor: boolean) => { tocando = valor; }, avanca: (ms: number) => { agora = ms; tique(); } };
}

test('envio ainda sem eco não fala ferramenta do turno anterior', () => {
  const m = monta();
  m.apoio.preparaEnvio?.();
  m.apoio.evento({ tipo: 'enviou' });
  m.avanca(10_000);
  assert.deepEqual(m.falas, []);
  m.p.mensagens.push(ferramenta(11, 'Conferindo a ferramenta nova'));
  m.avanca(40_000);
  assert.deepEqual(m.falas, ['Conferindo a ferramenta nova']);
});

test('captura, vez segurada, transcrição e áudio bloqueiam; mudo não bloqueia apoio', () => {
  const m = monta();
  m.apoio.inicia();
  for (const estado of [{ estado: 'ouvindo', capturando: true }, { estado: 'ouvindo', segurando: true }, { estado: 'transcrevendo' }]) {
    m.p.conversaRef.current = estado;
    m.avanca(10_000);
    assert.deepEqual(m.falas, []);
  }
  m.p.conversaRef.current = { estado: 'esperandoZe', mudo: true };
  m.ocupa(true);
  m.avanca(10_000);
  assert.deepEqual(m.falas, []);
  m.ocupa(false);
  m.avanca(10_001);
  assert.equal(m.falas.length, 1);
  m.apoio.evento({ tipo: 'falaIniciou' });
  assert.equal(m.caladas(), 1);
  m.apoio.evento({ tipo: 'zeTerminou' });
  m.avanca(999_999);
  assert.equal(m.falas.length, 1);
});

test('fala real não rebaixa degrau; envio novo reinicia o prazo em 10 segundos', () => {
  const m = monta();
  m.apoio.inicia();
  m.avanca(10_000);
  m.apoio.silenciou();
  m.avanca(20_000);
  m.apoio.silenciou();
  m.avanca(49_999);
  assert.equal(m.falas.length, 1);
  m.avanca(50_000);
  assert.equal(m.falas.length, 2);
  m.apoio.preparaEnvio?.();
  m.apoio.evento({ tipo: 'enviou' });
  m.p.mensagens.push(ferramenta(11, 'Conferindo o pedido novo'));
  m.avanca(59_999);
  assert.equal(m.falas.length, 2);
  m.avanca(60_000);
  assert.equal(m.falas.at(-1), 'Conferindo o pedido novo');
});
