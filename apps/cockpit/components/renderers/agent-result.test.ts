import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { classeDeCorDoStatus, normalizarAgentResult } from './agent-result.ts';

const FIXTURE_DIR = join(import.meta.dirname, '../../../../fixtures/cockpit-v2/familias');

function resultadoDaFixture(nome: string): unknown {
  const bruto = JSON.parse(readFileSync(join(FIXTURE_DIR, nome), 'utf8'));
  return bruto.evento.tool_use_result;
}

describe('normalizarAgentResult — fixtures reais', () => {
  it('normaliza o subagente assíncrono lançado', () => {
    const dados = normalizarAgentResult(
      resultadoDaFixture(
        'result__agentId_canReadOutputFile_description_isAsync_outputFile.json',
      ),
    );

    assert.ok(dados);
    assert.equal(dados.variante, 'assincrono');
    assert.equal(dados.agentId, 'a8d94ead4f11ef0db');
    assert.equal(dados.status, 'async_launched');
    assert.equal(dados.resolvedModel, 'claude-opus-5[1m]');
    if (dados.variante !== 'assincrono') assert.fail('variante assíncrona esperada');
    assert.equal(dados.isAsync, true);
    assert.equal(dados.canReadOutputFile, true);
    assert.equal(dados.description, 'Base factual código das telas');
    assert.equal(typeof dados.outputFile, 'string');
  });

  it('normaliza o subagente síncrono concluído', () => {
    const dados = normalizarAgentResult(
      resultadoDaFixture('result__agentId_agentType_content_prompt_resolvedModel.json'),
    );

    assert.ok(dados);
    assert.equal(dados.variante, 'concluido');
    assert.equal(dados.agentId, 'a52cc756ebf5ff9c9');
    assert.equal(dados.status, 'completed');
    assert.equal(dados.resolvedModel, 'claude-opus-5[1m]');
    if (dados.variante !== 'concluido') assert.fail('variante concluída esperada');
    assert.equal(dados.agentType, 'Explore');
    assert.equal(dados.content[0]?.type, 'text');
    assert.equal(dados.totalDurationMs, 193145);
    assert.equal(dados.totalTokens, 131685);
    assert.equal(dados.totalToolUseCount, 33);
    assert.deepEqual(dados.toolStats, {
      readCount: 5,
      searchCount: 0,
      bashCount: 28,
      editFileCount: 0,
      linesAdded: 0,
      linesRemoved: 0,
      otherToolCount: 0,
    });
  });

  it('rejeita payload que não pertence à família G7', () => {
    assert.equal(normalizarAgentResult(null), null);
    assert.equal(normalizarAgentResult({ status: 'completed', content: [] }), null);
    assert.equal(
      normalizarAgentResult(
        resultadoDaFixture('result__durationSeconds_query_results_searchCount.json'),
      ),
      null,
    );
  });
});

describe('classeDeCorDoStatus', () => {
  it('pinta status failed como falha, mesmo no shape concluído', () => {
    const fixture = resultadoDaFixture(
      'result__agentId_agentType_content_prompt_resolvedModel.json',
    );
    assert.ok(fixture && typeof fixture === 'object');

    const dados = normalizarAgentResult({ ...fixture, status: 'failed' });

    assert.ok(dados);
    assert.equal(dados.variante, 'concluido');
    assert.equal(classeDeCorDoStatus(dados.status), 'text-[var(--ck-state-fail)]');
  });

  it('mantém sucesso verde e status desconhecido neutro', () => {
    assert.equal(classeDeCorDoStatus('completed'), 'text-[var(--ck-state-ok)]');
    assert.equal(
      classeDeCorDoStatus('async_launched'),
      'text-[var(--ck-text-secondary)]',
    );
  });
});
