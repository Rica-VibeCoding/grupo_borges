import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { normalizarLinhaDeStatus } from './status-line.ts';

const FIXTURE_DIR = join(import.meta.dirname, '../../../../fixtures/cockpit-v2/familias');

function resultadoDaFixture(nome: string): unknown {
  const bruto = JSON.parse(readFileSync(join(FIXTURE_DIR, nome), 'utf8'));
  return bruto.evento.tool_use_result;
}

describe('normalizarLinhaDeStatus — fixtures reais', () => {
  it('normaliza commandName (result__commandName_success)', () => {
    const dados = normalizarLinhaDeStatus(resultadoDaFixture('result__commandName_success.json'));

    assert.ok(dados);
    assert.equal(dados.sucesso, true);
    assert.equal(dados.texto, 'canal-telegram');
    assert.equal(dados.pin, undefined);
    assert.equal(dados.resumedAgentId, undefined);
  });

  it('normaliza message + pin (result__message_pin_success)', () => {
    const dados = normalizarLinhaDeStatus(resultadoDaFixture('result__message_pin_success.json'));

    assert.ok(dados);
    assert.equal(dados.sucesso, true);
    assert.match(dados.texto, /^Message queued/);
    assert.deepEqual(dados.pin, {
      id: 'a2c44a4ca9248dcd0',
      name: 'a2c44a4ca9248dcd0',
      ref: '9de3d4',
    });
    assert.equal(dados.resumedAgentId, undefined);
  });

  it('normaliza message + pin + resumedAgentId (result__message_pin_resumedAgentId_success)', () => {
    const dados = normalizarLinhaDeStatus(
      resultadoDaFixture('result__message_pin_resumedAgentId_success.json'),
    );

    assert.ok(dados);
    assert.equal(dados.sucesso, true);
    assert.equal(typeof dados.texto, 'string');
    assert.ok(dados.texto.length > 0);
    assert.equal(dados.resumedAgentId, 'a13ed7dac76527954');
    assert.ok(dados.pin);
    assert.equal(dados.pin.id, 'a13ed7dac76527954');
  });

  it('normaliza success:false como falha (result__message_success)', () => {
    const dados = normalizarLinhaDeStatus(resultadoDaFixture('result__message_success.json'));

    assert.ok(dados);
    assert.equal(dados.sucesso, false);
    assert.equal(typeof dados.texto, 'string');
    assert.ok(dados.texto.length > 0);
    assert.equal(dados.pin, undefined);
  });

  it('rejeita payload que não pertence à família G4', () => {
    assert.equal(normalizarLinhaDeStatus(null), null);
    assert.equal(normalizarLinhaDeStatus('texto'), null);
    assert.equal(normalizarLinhaDeStatus({ success: true }), null);
    assert.equal(normalizarLinhaDeStatus({ message: 'sem success' }), null);
    assert.equal(
      normalizarLinhaDeStatus(
        resultadoDaFixture('result__bytes_code_codeText_durationMs_result.json'),
      ),
      null,
    );
    assert.equal(normalizarLinhaDeStatus(resultadoDaFixture('result__file_type.json')), null);
    assert.equal(
      normalizarLinhaDeStatus(
        resultadoDaFixture('result__agentId_canReadOutputFile_description_isAsync_outputFile.json'),
      ),
      null,
    );
  });

  it('pin malformado (faltando chave) não quebra — vira undefined, resto do corpo normaliza', () => {
    const dados = normalizarLinhaDeStatus({
      success: true,
      message: 'ok',
      pin: { id: 'x', name: 'x' },
    });

    assert.ok(dados);
    assert.equal(dados.pin, undefined);
  });
});
