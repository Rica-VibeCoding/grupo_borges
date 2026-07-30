import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  formatoBytes,
  formatoDuracao,
  normalizarFetchResult,
  tomDoStatus,
} from './fetch-result.ts';

const FIXTURE_DIR = join(import.meta.dirname, '../../../../fixtures/cockpit-v2/familias');

function resultadoDaFixture(nome: string): unknown {
  const bruto = JSON.parse(readFileSync(join(FIXTURE_DIR, nome), 'utf8'));
  return bruto.evento.tool_use_result;
}

describe('normalizarFetchResult — fixture real', () => {
  it('extrai o núcleo da família result__bytes_code_codeText_durationMs_result', () => {
    const dados = normalizarFetchResult(
      resultadoDaFixture('result__bytes_code_codeText_durationMs_result.json'),
    );

    assert.ok(dados);
    assert.equal(dados.codigo, 200);
    assert.equal(dados.textoDoCodigo, 'OK');
    assert.equal(dados.bytes, 2954287);
    assert.equal(dados.duracaoMs, 4211);
    assert.match(dados.url, /^https:\/\//);
    assert.equal(typeof dados.corpo, 'string');
  });

  it('rejeita payload que não é fetch', () => {
    assert.equal(normalizarFetchResult(null), null);
    assert.equal(normalizarFetchResult('texto'), null);
    assert.equal(normalizarFetchResult({ url: 'https://x' }), null);
    assert.equal(normalizarFetchResult({ code: 200, result: '' }), null);
    // Lista de busca NÃO é fetch — cada corpo reconhece só a própria família.
    assert.equal(
      normalizarFetchResult(resultadoDaFixture('result__durationSeconds_query_results_searchCount.json')),
      null,
    );
  });

  it('tolera fetch abortado sem os campos acessórios', () => {
    const dados = normalizarFetchResult({ url: 'https://x', code: 0, result: '' });
    assert.ok(dados);
    assert.equal(dados.textoDoCodigo, '');
    assert.equal(dados.bytes, 0);
    assert.equal(dados.duracaoMs, 0);
  });
});

describe('tomDoStatus', () => {
  it('2xx ok, 3xx neutro, resto erro', () => {
    assert.equal(tomDoStatus(200), 'ok');
    assert.equal(tomDoStatus(204), 'ok');
    assert.equal(tomDoStatus(301), 'neutro');
    assert.equal(tomDoStatus(404), 'erro');
    assert.equal(tomDoStatus(500), 'erro');
    assert.equal(tomDoStatus(0), 'erro');
  });
});

describe('formatoBytes', () => {
  it('formata em B, kB e MB com vírgula', () => {
    assert.equal(formatoBytes(512), '512 B');
    assert.equal(formatoBytes(2048), '2,0 kB');
    assert.equal(formatoBytes(2954287), '2,8 MB');
    assert.equal(formatoBytes(0), '0 B');
  });
});

describe('formatoDuracao', () => {
  it('milissegundos cheios abaixo de 1s, segundos com vírgula acima', () => {
    assert.equal(formatoDuracao(421), '421 ms');
    assert.equal(formatoDuracao(4211), '4,2 s');
    assert.equal(formatoDuracao(0), '0 ms');
  });
});
