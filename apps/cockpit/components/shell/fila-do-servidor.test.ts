import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { ItemDaFilaDoServidor } from '@grupo_borges/cockpit-core/fila-types';

import { PRAZO_DRENANDO_MS, espelhaFila } from './fila-do-servidor.ts';

/**
 * O ENCONTRO COM O SERVIDOR é este arquivo, não uma integração. A §10 acordou
 * teste de contrato contra fixture justamente para que Pavan e eu andemos sem
 * esperar um pelo outro: ele faz o lado que PRODUZ `itens`, eu faço o que
 * DERIVA o espelho, e a fixture é a única coisa que os dois leem.
 *
 * Se o contrato mudar, é aqui que os dois lados quebram juntos — que é o ponto.
 */
const CONTRATO = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../../fixtures/cockpit-v2/fila/espelho-do-painel.json'),
    'utf8',
  ),
) as {
  agora: string;
  prazo_drenando_ms: number;
  itens: ItemDaFilaDoServidor[];
  espelho_esperado: unknown[];
};

test('o espelho do painel bate com a fixture do contrato', () => {
  const espelho = espelhaFila(CONTRATO.itens, Date.parse(CONTRATO.agora));
  assert.deepEqual(espelho, CONTRATO.espelho_esperado);
});

test('o prazo da fixture é o mesmo que o módulo carrega', () => {
  assert.equal(
    CONTRATO.prazo_drenando_ms,
    PRAZO_DRENANDO_MS,
    'fixture e módulo discordando do prazo é o contrato mentindo para os dois lados',
  );
});

/**
 * A decisão 2 do módulo, isolada: a fixture já entrega os itens fora de ordem,
 * mas um teste que só olha o resultado final não distingue "ordenou pelo id" de
 * "veio ordenado por sorte". Aqui a ordem do array é o INVERSO da ordem do id.
 */
test('a posição sai do id v7, nunca da ordem do array', () => {
  const base = CONTRATO.itens.find((i) => i.estado === 'pendente');
  assert.ok(base, 'a fixture precisa de ao menos um pendente');

  const cedo: ItemDaFilaDoServidor = { ...base, id: '0198c0a1-0100-7000-8000-00000000000a', texto: 'primeiro' };
  const tarde: ItemDaFilaDoServidor = { ...base, id: '0198c0a1-0900-7000-8000-00000000000b', texto: 'segundo' };

  const espelho = espelhaFila([tarde, cedo], Date.parse(CONTRATO.agora));
  assert.deepEqual(
    espelho.map((i) => [i.posicao, i.texto]),
    [
      [1, 'primeiro'],
      [2, 'segundo'],
    ],
  );
});

/**
 * A fronteira que o módulo NÃO atravessa. `entregue` some porque o servidor
 * casou o item com o feed — o painel não refaz esse casamento, e não teria como:
 * ele só vê texto, e dois "ok" seguidos são indistinguíveis para quem não tem a
 * ordem das entregas.
 */
test('entregue e cancelada saem do espelho, e o painel não casa nada por conta', () => {
  const espelho = espelhaFila(CONTRATO.itens, Date.parse(CONTRATO.agora));
  const visiveis = new Set(espelho.map((i) => i.id));
  for (const item of CONTRATO.itens) {
    if (item.estado === 'entregue' || item.estado === 'cancelada') {
      assert.equal(visiveis.has(item.id), false, `${item.estado} não pode aparecer na fila`);
    }
  }
});

test('drenando vira falho na leitura, sem ninguém varrer', () => {
  const base = CONTRATO.itens.find((i) => i.estado === 'drenando' && i.motivo_falha === null);
  assert.ok(base, 'a fixture precisa de um drenando sem motivo carimbado');
  const agoraMs = Date.parse(CONTRATO.agora);
  const noPrazo: ItemDaFilaDoServidor = {
    ...base,
    drenando_desde: new Date(agoraMs - PRAZO_DRENANDO_MS).toISOString(),
  };
  const vencido: ItemDaFilaDoServidor = {
    ...base,
    drenando_desde: new Date(agoraMs - PRAZO_DRENANDO_MS - 1).toISOString(),
  };

  assert.equal(espelhaFila([noPrazo], agoraMs)[0]?.situacao, 'drenando', 'no limite ainda não venceu');
  assert.equal(espelhaFila([vencido], agoraMs)[0]?.situacao, 'falho');
  assert.ok(espelhaFila([vencido], agoraMs)[0]?.motivo, 'falho sem motivo é a recusa muda de volta');
});

/**
 * O carimbo do servidor vence a frase do prazo: ele sabe o que aconteceu
 * (`pane_incompativel`), o prazo só sabe que demorou. Dizer "passou de 30s"
 * por cima de um motivo real é trocar informação por relógio.
 */
test('motivo do servidor tem precedência sobre a frase genérica do prazo', () => {
  const carimbado = CONTRATO.itens.find((i) => i.motivo_falha !== null);
  assert.ok(carimbado, 'a fixture precisa de um item com motivo_falha');
  const espelhado = espelhaFila([carimbado], Date.parse(CONTRATO.agora))[0];
  assert.equal(espelhado?.situacao, 'falho');
  assert.equal(espelhado?.motivo, carimbado.motivo_falha);
});

/** Carimbo ilegível não pode condenar o item — nem travar a renderização. */
test('drenando_desde ilegível não vira falho', () => {
  const base = CONTRATO.itens.find((i) => i.estado === 'drenando' && i.motivo_falha === null);
  assert.ok(base);
  const torto: ItemDaFilaDoServidor = { ...base, drenando_desde: 'ontem de manhã' };
  assert.equal(espelhaFila([torto], Date.parse(CONTRATO.agora))[0]?.situacao, 'drenando');
});

test('fila vazia é lista vazia, não nulo', () => {
  assert.deepEqual(espelhaFila([], Date.now()), []);
});
