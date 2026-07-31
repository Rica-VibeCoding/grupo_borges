import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { normalizarConteudoDeArquivo } from './file-content.ts';

const FIXTURE_DIR = join(import.meta.dirname, '../../../../fixtures/cockpit-v2/familias');

function resultadoDaFixture(nome: string): unknown {
  const bruto = JSON.parse(readFileSync(join(FIXTURE_DIR, nome), 'utf8'));
  return bruto.evento.tool_use_result;
}

describe('normalizarConteudoDeArquivo — fixtures reais', () => {
  it('normaliza a leitura via Read (result__file_type)', () => {
    const dados = normalizarConteudoDeArquivo(resultadoDaFixture('result__file_type.json'));

    assert.ok(dados);
    assert.equal(dados.binario, false);
    assert.equal(
      dados.caminho,
      '/home/clawd/repos/ze_claude/ze-shared/.claude/skills/canal-telegram/SKILL.md',
    );
    assert.equal(dados.totalDeLinhas, 147);
    assert.equal(typeof dados.conteudo, 'string');
    assert.ok(dados.conteudo.length > 0);
  });

  it('normaliza a leitura via MCP get_file (result__content_contentType_isBase64_method_path)', () => {
    const dados = normalizarConteudoDeArquivo(
      resultadoDaFixture('result__content_contentType_isBase64_method_path.json'),
    );

    assert.ok(dados);
    assert.equal(dados.binario, false);
    assert.equal(dados.caminho, 'FLUYT_UI_REFERENCE.md');
    assert.equal(typeof dados.conteudo, 'string');
    assert.ok(dados.conteudo.length > 0);
    // Fixture redigida (privacidade) — conteúdo real é um placeholder de uma
    // linha só, não os "18996 chars" que o texto do placeholder menciona.
    assert.equal(dados.totalDeLinhas, 1);
  });

  it('rejeita payload que não pertence à família G5', () => {
    assert.equal(normalizarConteudoDeArquivo(null), null);
    assert.equal(normalizarConteudoDeArquivo('texto'), null);
    assert.equal(normalizarConteudoDeArquivo({ file: {} }), null);
    assert.equal(
      normalizarConteudoDeArquivo(
        resultadoDaFixture('result__bytes_code_codeText_durationMs_result.json'),
      ),
      null,
    );
    assert.equal(
      normalizarConteudoDeArquivo(
        resultadoDaFixture('result__agentId_canReadOutputFile_description_isAsync_outputFile.json'),
      ),
      null,
    );
    assert.equal(
      normalizarConteudoDeArquivo(
        resultadoDaFixture('result__durationSeconds_query_results_searchCount.json'),
      ),
      null,
    );
  });

  it('MCP: method precisa ser get_file — outro method não casa a família', () => {
    assert.equal(
      normalizarConteudoDeArquivo({ method: 'outro_metodo', path: 'x.md', content: 'a' }),
      null,
    );
  });

  it('binário: isBase64 true (MCP) não tenta exibir texto', () => {
    const dados = normalizarConteudoDeArquivo({
      method: 'get_file',
      path: 'logo.png',
      content: 'YmFzZTY0',
      contentType: 'image/png',
      isBase64: true,
    });

    assert.ok(dados);
    assert.equal(dados.binario, true);
    assert.equal(dados.caminho, 'logo.png');
    assert.equal(dados.conteudo, '');
    assert.equal(dados.totalDeLinhas, 0);
  });

  it('binário: type diferente de text (Read, ramo previsto sem fixture) não tenta exibir texto', () => {
    const dados = normalizarConteudoDeArquivo({
      type: 'image',
      file: { filePath: '/tmp/screenshot.png', totalLines: 0 },
    });

    assert.ok(dados);
    assert.equal(dados.binario, true);
    assert.equal(dados.caminho, '/tmp/screenshot.png');
    assert.equal(dados.conteudo, '');
  });

  it('arquivo vazio via MCP conta zero linhas, não uma', () => {
    const dados = normalizarConteudoDeArquivo({
      method: 'get_file',
      path: 'vazio.md',
      content: '',
    });

    assert.ok(dados);
    assert.equal(dados.totalDeLinhas, 0);
  });
});
