import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  formatoBytesDeShell,
  normalizarSaidaDeShell,
  separarCaminhoDeShell,
  separarLinksDeShell,
  temCorpoDeShell,
} from './shell-output.ts';

const FIXTURE_DIR = join(import.meta.dirname, '../../../../fixtures/cockpit-v2/familias');

function resultadoDaFixture(nome: string): unknown {
  const bruto = JSON.parse(readFileSync(join(FIXTURE_DIR, nome), 'utf8'));
  return bruto.evento.tool_use_result;
}

describe('normalizarSaidaDeShell — cinco famílias G1 reais', () => {
  it('normaliza o núcleo stdout/stderr (679 ocorrências)', () => {
    const dados = normalizarSaidaDeShell(
      resultadoDaFixture('result__interrupted_isImage_noOutputExpected_stderr_stdout.json'),
    );

    assert.ok(dados);
    assert.equal(dados.interrompido, false);
    assert.equal(dados.semSaidaEsperada, false);
    assert.equal(typeof dados.stdout, 'string');
    assert.equal(dados.stderr, '');
    assert.equal(temCorpoDeShell(dados), true);
  });

  it('normaliza backgroundTaskId mesmo com os canais vazios', () => {
    const dados = normalizarSaidaDeShell(
      resultadoDaFixture(
        'result__backgroundTaskId_interrupted_isImage_noOutputExpected_stderr.json',
      ),
    );

    assert.ok(dados);
    assert.equal(dados.backgroundTaskId, 'b0bmcpxe8');
    assert.equal(dados.stdout, '');
    assert.equal(temCorpoDeShell(dados), true);
  });

  it('normaliza arquivo persistido e tamanho', () => {
    const dados = normalizarSaidaDeShell(
      resultadoDaFixture(
        'result__interrupted_isImage_noOutputExpected_persistedOutputPath_persistedOutputSize.json',
      ),
    );

    assert.ok(dados);
    assert.equal(typeof dados.caminhoDaSaidaCompleta, 'string');
    assert.equal(dados.tamanhoDaSaidaCompleta, 53240);
    assert.equal(formatoBytesDeShell(dados.tamanhoDaSaidaCompleta), '52,0 kB');
  });

  it('normaliza operação git e preserva o branch', () => {
    const dados = normalizarSaidaDeShell(
      resultadoDaFixture('result__gitOperation_interrupted_isImage_noOutputExpected_stderr.json'),
    );

    assert.ok(dados);
    assert.deepEqual(dados.operacaoGit, { acao: 'push', branch: 'main' });
    assert.match(dados.stderr, /Shell cwd was reset/);
  });

  it('normaliza interpretação de retorno quando não houve saída', () => {
    const dados = normalizarSaidaDeShell(
      resultadoDaFixture(
        'result__interrupted_isImage_noOutputExpected_returnCodeInterpretation_stderr.json',
      ),
    );

    assert.ok(dados);
    assert.equal(dados.interpretacaoDoRetorno, 'No matches found');
    assert.equal(temCorpoDeShell(dados), true);
  });
});

describe('normalizarSaidaDeShell — bordas', () => {
  it('silêncio puro não cria corpo', () => {
    const dados = normalizarSaidaDeShell({
      stdout: '',
      stderr: '',
      interrupted: false,
      isImage: false,
      noOutputExpected: true,
    });

    assert.ok(dados);
    assert.equal(temCorpoDeShell(dados), false);
  });

  it('stderr não implica falha; interrupted é o desfecho explícito', () => {
    const dados = normalizarSaidaDeShell({
      stdout: '',
      stderr: 'progresso',
      interrupted: false,
      isImage: false,
      noOutputExpected: false,
    });

    assert.ok(dados);
    assert.equal(dados.interrompido, false);
    assert.equal(temCorpoDeShell(dados), true);
  });

  it('noOutputExpected não apaga saída que veio de fato', () => {
    const dados = normalizarSaidaDeShell({
      stdout: 'saída inesperada, mas real',
      stderr: '',
      interrupted: false,
      isImage: false,
      noOutputExpected: true,
    });

    assert.ok(dados);
    assert.equal(temCorpoDeShell(dados), true);
  });

  it('rejeita outras famílias, shape incompleto e imagem sem fixture real', () => {
    assert.equal(normalizarSaidaDeShell(null), null);
    assert.equal(normalizarSaidaDeShell({ stderr: '' }), null);
    assert.equal(
      normalizarSaidaDeShell(resultadoDaFixture('result__bytes_code_codeText_durationMs_result.json')),
      null,
    );
    assert.equal(
      normalizarSaidaDeShell({
        stdout: 'base64',
        stderr: '',
        interrupted: false,
        isImage: true,
        noOutputExpected: false,
      }),
      null,
    );
  });
});

describe('separarLinksDeShell', () => {
  it('transforma URLs http(s) em links e preserva pontuação e whitespace', () => {
    assert.deepEqual(separarLinksDeShell('ver https://example.com/a?q=1, depois'), [
      { tipo: 'texto', valor: 'ver ' },
      { tipo: 'link', valor: 'https://example.com/a?q=1' },
      { tipo: 'texto', valor: ',' },
      { tipo: 'texto', valor: ' depois' },
    ]);
  });

  it('não interpreta protocolo perigoso nem shell comum', () => {
    assert.deepEqual(separarLinksDeShell('javascript:alert(1)\n$ echo ok'), [
      { tipo: 'texto', valor: 'javascript:alert(1)\n$ echo ok' },
    ]);
  });
});

describe('separarCaminhoDeShell', () => {
  it('separa diretório do nome para o CSS truncar só a parte descartável', () => {
    assert.deepEqual(separarCaminhoDeShell('/tmp/logs/saida-completa.txt'), {
      diretorio: '/tmp/logs/',
      arquivo: 'saida-completa.txt',
    });
    assert.deepEqual(separarCaminhoDeShell('saida.txt'), {
      diretorio: '',
      arquivo: 'saida.txt',
    });
  });
});
