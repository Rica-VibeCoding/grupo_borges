import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { normalizarPaginaPublicada } from './published-page.ts';

const FIXTURE_DIR = join(import.meta.dirname, '../../../../fixtures/cockpit-v2/familias');

function resultadoDaFixture(nome: string): unknown {
  const bruto = JSON.parse(readFileSync(join(FIXTURE_DIR, nome), 'utf8'));
  return bruto.evento.tool_use_result;
}

describe('normalizarPaginaPublicada — fixture real', () => {
  it('normaliza a página publicada (result__liveSubscription_path_title_updated_url)', () => {
    const dados = normalizarPaginaPublicada(
      resultadoDaFixture('result__liveSubscription_path_title_updated_url.json'),
    );

    assert.ok(dados);
    assert.equal(dados.titulo, 'Redesenho das telas — o que decidir');
    assert.equal(dados.url, 'https://claude.ai/code/artifact/664e38c3-6d52-4343-bdeb-9f4a578815ea');
    assert.equal(dados.versao, '1785210866-7ce5');
    assert.equal(dados.atualizado, false);
    assert.equal(dados.liveSubscription, 'flag_off');
    // Fixture redigida (privacidade) — conteúdo real é um placeholder de uma
    // linha só, não os "115 chars" que o texto do placeholder menciona.
    assert.equal(typeof dados.caminho, 'string');
    assert.ok(dados.caminho.length > 0);
  });

  it('rejeita payload que não pertence à família G8', () => {
    assert.equal(normalizarPaginaPublicada(null), null);
    assert.equal(normalizarPaginaPublicada('texto'), null);
    assert.equal(normalizarPaginaPublicada({ url: 'https://x' }), null);
    assert.equal(
      normalizarPaginaPublicada(
        resultadoDaFixture('result__bytes_code_codeText_durationMs_result.json'),
      ),
      null,
    );
    assert.equal(normalizarPaginaPublicada(resultadoDaFixture('result__file_type.json')), null);
    assert.equal(
      normalizarPaginaPublicada(
        resultadoDaFixture('result__agentId_canReadOutputFile_description_isAsync_outputFile.json'),
      ),
      null,
    );
  });

  it('cada chave ausente sozinha já invalida a família (as 6 andam juntas)', () => {
    const base = {
      url: 'https://claude.ai/code/artifact/x',
      path: 'algum/caminho.md',
      title: 'Título',
      updated: true,
      version: '123-abc',
      liveSubscription: 'flag_on',
    };
    assert.ok(normalizarPaginaPublicada(base));

    const { url: _url, ...semUrl } = base;
    assert.equal(normalizarPaginaPublicada(semUrl), null);

    const { title: _title, ...semTitle } = base;
    assert.equal(normalizarPaginaPublicada(semTitle), null);

    const { updated: _updated, ...semUpdated } = base;
    assert.equal(normalizarPaginaPublicada(semUpdated), null);

    assert.equal(normalizarPaginaPublicada({ ...base, url: '' }), null);
    assert.equal(normalizarPaginaPublicada({ ...base, title: '' }), null);
    assert.equal(normalizarPaginaPublicada({ ...base, updated: 'true' }), null);
  });
});
