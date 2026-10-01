import assert from 'node:assert/strict';
import { it } from 'node:test';

import { chaveDaFila, criaFilaDaFala, type Armazem } from './fila-da-fala.ts';
import { chaveDaRetomada } from './retomada-da-conversa.ts';

function armazemDeTeste(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial));
  const armazem: Armazem = {
    le: (c) => dados.get(c) ?? null,
    grava: (c, v) => void dados.set(c, v),
    apaga: (c) => void dados.delete(c),
  };
  return { armazem, dados };
}

const CHAVE = chaveDaFila('ze');
const fecha = (f: ReturnType<typeof criaFilaDaFala>) => (f.fechou(), f.tenta(false));
let n = 0;
const ids = () => `f${++n}`;

it('a chave é por agente e não é a da retomada', () => {
  assert.notEqual(chaveDaFila('ze'), chaveDaFila('outro'));
  assert.notEqual(chaveDaFila('ze'), chaveDaRetomada('ze'));
});

it('livre: a fala sai na hora; com o turno dele em voo, espera', () => {
  const { armazem } = armazemDeTeste();
  const fila = criaFilaDaFala(armazem, CHAVE, ids);
  const livre = fila.fala('oi', false);
  assert.equal(livre.tipo, 'posta');
  fila.entrou(livre.tipo === 'posta' ? livre.lote : null!);
  fila.abriu();
  assert.deepEqual(fila.fala('e o tempo?', false), { tipo: 'esperou' });
  assert.equal(fila.pendentes(), 1);
});

it('o stream rodando (recarga, turno sem `abre`) também é ocupado', () => {
  const fila = criaFilaDaFala(armazemDeTeste().armazem, CHAVE, ids);
  assert.deepEqual(fila.fala('oi', true), { tipo: 'esperou' });
});

it('FIFO: as que esperaram saem juntas, na ordem, quando o turno fecha — uma vez só', () => {
  const fila = criaFilaDaFala(armazemDeTeste().armazem, CHAVE, ids);
  fila.abriu();
  fila.fala('primeira', false);
  fila.fala('segunda', false);
  const lote = fecha(fila);
  assert.equal(lote?.texto, 'primeira segunda');
  assert.equal(fila.pendentes(), 0);
  assert.equal(fecha(fila), null, 'nada pendente, nada sai de novo');
  fila.entrou(lote!);
  assert.equal(fecha(fila), null);
});

it('fim seguido de `abre` no mesmo lote (pedido de outro canal): a fila segue esperando', () => {
  const fila = criaFilaDaFala(armazemDeTeste().armazem, CHAVE, ids);
  fila.abriu();
  fila.fala('espera', false);
  fila.fechou();
  fila.abriu();
  assert.equal(fila.tenta(false), null);
  assert.equal(fecha(fila)?.texto, 'espera');
});

it('uma entrega em voo de cada vez: a fala que chega no meio espera o próximo fim', () => {
  const fila = criaFilaDaFala(armazemDeTeste().armazem, CHAVE, ids);
  fila.abriu();
  fila.fala('primeira', false);
  const lote = fecha(fila)!;
  assert.deepEqual(fila.fala('segunda', false), { tipo: 'esperou' }, 'POST em voo é ocupado');
  fila.entrou(lote);
  fila.abriu();
  assert.equal(fecha(fila)?.texto, 'segunda');
});

it('persiste ANTES do POST: a fila e o lote que sai já estão no armazém', () => {
  const { armazem, dados } = armazemDeTeste();
  const fila = criaFilaDaFala(armazem, CHAVE, ids);
  fila.abriu();
  fila.fala('guardada', false);
  assert.match(dados.get(CHAVE) ?? '', /guardada/);
  fecha(fila);
  assert.match(dados.get(CHAVE) ?? '', /"saindo":true/);
});

it('recarga: a pendente volta; a que já tinha saído (resultado incerto) nunca é reenviada', () => {
  const { armazem } = armazemDeTeste();
  const antes = criaFilaDaFala(armazem, CHAVE, ids);
  antes.abriu();
  antes.fala('saiu', false);
  fecha(antes); // POST saiu e a página recarregou antes da resposta
  antes.fala('esperando', false);
  const depois = criaFilaDaFala(armazem, CHAVE, ids);
  assert.equal(depois.pendentes(), 1);
  assert.equal(depois.tenta(false)?.texto, 'esperando');
});

it('recarga com o Zé ainda rodando: a recuperada espera o fim dele', () => {
  const { armazem } = armazemDeTeste();
  const antes = criaFilaDaFala(armazem, CHAVE, ids);
  antes.abriu();
  antes.fala('esperando', false);
  const depois = criaFilaDaFala(armazem, CHAVE, ids);
  assert.equal(depois.tenta(true), null);
  assert.equal(fecha(depois)?.texto, 'esperando');
});

it('fala nova com outras recuperadas e o Zé livre: sai tudo junto, na ordem', () => {
  const { armazem } = armazemDeTeste();
  const antes = criaFilaDaFala(armazem, CHAVE, ids);
  antes.abriu();
  antes.fala('velha', false);
  const depois = criaFilaDaFala(armazem, CHAVE, ids);
  const r = depois.fala('nova', false);
  assert.equal(r.tipo === 'posta' && r.lote.texto, 'velha nova');
});

it('falha definitiva tira o lote (o erro aparece) e libera; descarta limpa tudo e o armazém', () => {
  const { armazem, dados } = armazemDeTeste();
  const fila = criaFilaDaFala(armazem, CHAVE, ids);
  fila.abriu();
  fila.fala('a', false);
  const lote = fecha(fila)!;
  fila.falhou(lote);
  assert.equal(fila.pendentes(), 0);
  assert.equal(fila.fala('b', false).tipo, 'posta');
  fila.descarta();
  assert.equal(fila.pendentes(), 0);
  assert.equal(dados.has(CHAVE), false);
  assert.equal(fila.fala('c', false).tipo, 'posta', 'descartar também solta o voo');
});

it('armazém ilegível ou de outra versão: fila vazia', () => {
  for (const bruto of ['{', '{"v":2,"itens":[]}', '{"v":1,"itens":[{"id":1}]}']) {
    const fila = criaFilaDaFala(armazemDeTeste({ [CHAVE]: bruto }).armazem, CHAVE, ids);
    assert.equal(fila.pendentes(), 0, bruto);
  }
});
