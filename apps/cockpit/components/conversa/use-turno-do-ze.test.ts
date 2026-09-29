import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import { FOLGA_DO_FIM_MS, maiorIdDasMensagens, passosDoZeDepoisDe, textosDoZeDepoisDe } from './textos-do-ze.ts';

const ts = createRequire(import.meta.url)('typescript');
const fonte = readFileSync(new URL('./use-turno-do-ze.ts', import.meta.url), 'utf8');
const compilado = ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

const pedido = (id: number, texto: string) => ({ id, kind: 'user', message: { role: 'user', content: texto } });
const fala = (id: number, texto: string, stop_reason: string) => ({
  id, kind: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: texto }], stop_reason },
});

/** O hook rodado sem React: cada `render` chama os efeitos na hora, com os mesmos refs. */
function monta() {
  const refs: { current: unknown }[] = [];
  let indice = 0;
  const react = {
    useRef: (inicial: unknown) => (refs[indice++] ??= { current: inicial }),
    useEffect: (fn: () => unknown) => { fn(); },
  };
  const dependencias: Record<string, unknown> = {
    react,
    './textos-do-ze': { FOLGA_DO_FIM_MS, maiorIdDasMensagens, passosDoZeDepoisDe, textosDoZeDepoisDe },
  };
  const modulo = { exports: {} as any };
  new Function('require', 'module', 'exports', 'window', compilado)(
    (nome: string) => { assert.ok(nome in dependencias, nome); return dependencias[nome]; }, modulo, modulo.exports,
    { setTimeout: () => 0, clearTimeout() {} },
  );
  const eventos: string[] = [];
  const ao = {
    abre: () => eventos.push('abre'),
    texto: (texto: string) => eventos.push(`texto ${texto}`),
    pedidoEntrou: () => eventos.push('pedidoEntrou'),
    fecha: () => eventos.push('fecha'),
  };
  const render = (status: string, messages: unknown[], isRunning: boolean) => {
    indice = 0;
    modulo.exports.useTurnoDoZe({ status, messages, isRunning }, ao);
  };
  return { render, eventos };
}

test('o turno que chegou com a conexão caída toca quando ela volta, em vez de sumir no replay', () => {
  const { render, eventos } = monta();
  const antes = [pedido(1, 'e na Apple?')];
  render('replaying', antes, true);
  render('live', antes, true);

  // O iPhone congelou a página com o Zé trabalhando; a reconexão traz o turno inteiro.
  const depois = [...antes, fala(2, 'Vou puxar os preços.', 'tool_use'), fala(3, 'O Mac mini sai por mil dólares.', 'end_turn')];
  render('reconnecting', antes, true);
  render('replaying', depois, false);
  render('live', depois, false);

  assert.deepEqual(eventos, ['texto Vou puxar os preços.', 'texto O Mac mini sai por mil dólares.', 'fecha']);
});

test('o primeiro replay só posiciona o cursor: histórico não vira fala', () => {
  const { render, eventos } = monta();
  const historico = [pedido(1, 'oi'), fala(2, 'resposta velha', 'end_turn')];
  render('connecting', [], false);
  render('replaying', historico, false);
  render('live', historico, false);
  assert.deepEqual(eventos, []);
});

test('sessão nova zera o stream: o replay dela também só posiciona o cursor', () => {
  const { render, eventos } = monta();
  const velha = [pedido(1, 'oi'), fala(2, 'resposta', 'end_turn')];
  render('replaying', velha, false);
  render('live', velha, false);

  const nova = [pedido(40, 'outra conversa'), fala(41, 'resposta da sessão nova', 'end_turn')];
  render('connecting', [], false);
  render('replaying', nova, false);
  render('live', nova, false);
  assert.deepEqual(eventos, []);
});
