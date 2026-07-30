import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { normalizarListaResultado } from './result-list.ts';

const FIXTURE_DIR = join(import.meta.dirname, '../../../../fixtures/cockpit-v2/familias');

function resultadoDaFixture(nome: string): unknown {
  const bruto = JSON.parse(readFileSync(join(FIXTURE_DIR, nome), 'utf8'));
  return bruto.evento.tool_use_result;
}

describe('normalizarListaResultado — fixtures reais das 5 famílias G3', () => {
  it('WebSearch: extrai links do content aninhado e carrega a query', () => {
    const dados = normalizarListaResultado(
      resultadoDaFixture('result__durationSeconds_query_results_searchCount.json'),
    );

    assert.ok(dados);
    assert.equal(dados.titulo, 'clickable table row vs side panel drawer UX pattern data table accessibility');
    assert.equal(dados.total, 1);
    const links = dados.itens.filter((i) => i.tipo === 'link');
    assert.ok(links.length >= 3, `esperava ≥3 links, veio ${links.length}`);
    const primeiro = links[0];
    assert.equal(primeiro.tipo, 'link');
    if (primeiro.tipo === 'link') {
      assert.match(primeiro.titulo, /Data Table Design UX Patterns/);
      assert.ok(primeiro.url.length > 0);
    }
  });

  it('ToolSearch: matches viram caminhos, total vem de total_deferred_tools', () => {
    const dados = normalizarListaResultado(
      resultadoDaFixture('result__matches_query_total_deferred_tools.json'),
    );

    assert.ok(dados);
    assert.equal(dados.total, 137);
    assert.deepEqual(dados.itens, [
      { tipo: 'caminho', caminho: 'mcp__plugin_telegram_telegram__reply' },
    ]);
  });

  it('list_files: paths viram caminhos, method vira título', () => {
    const dados = normalizarListaResultado(resultadoDaFixture('result__method_paths.json'));

    assert.ok(dados);
    assert.equal(dados.titulo, 'list_files');
    assert.ok(dados.itens.length >= 3);
    assert.deepEqual(dados.itens[0], { tipo: 'caminho', caminho: 'assets' });
  });

  it('list_projects: objetos nomeados com id como detalhe', () => {
    const dados = normalizarListaResultado(resultadoDaFixture('result__method_projects.json'));

    assert.ok(dados);
    assert.equal(dados.titulo, 'list_projects');
    assert.deepEqual(dados.itens[0], {
      tipo: 'objeto',
      nome: 'WoodPro Design System',
      detalhe: '019e12e9-66da-7e85-97ac-bf3441b67654',
    });
  });

  it('tasks: array vazio não quebra e não é null', () => {
    const dados = normalizarListaResultado(resultadoDaFixture('result__tasks.json'));

    assert.ok(dados);
    assert.deepEqual(dados.itens, []);
  });

  it('rejeita payload que não é lista', () => {
    assert.equal(normalizarListaResultado(null), null);
    assert.equal(normalizarListaResultado('texto'), null);
    assert.equal(normalizarListaResultado({ foo: 1 }), null);
    // Fetch NÃO é lista — cada corpo reconhece só a própria família.
    assert.equal(
      normalizarListaResultado(resultadoDaFixture('result__bytes_code_codeText_durationMs_result.json')),
      null,
    );
  });
});
