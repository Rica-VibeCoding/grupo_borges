import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { ContentPart, MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import type { RenderItem, ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';
import { buildToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { execucaoDaParte, execucaoDoChip, familiaDoRich, usoDoChip } from './execucao-do-item.ts';

// `buildToolResultLookup` só olha mensagens de kind `user` — é assim que o
// Claude Code emite o resultado de uma ferramenta, e um fixture com kind
// `assistant` produz lookup vazio sem erro nenhum.
function payload(
  id: number,
  conteudo: ContentPart[],
  kind: 'user' | 'assistant' = 'assistant',
): MessagePayload {
  return {
    id,
    kind,
    uuid: `uuid-${id}`,
    parent_uuid: null,
    session_id: 'sessao',
    is_sidechain: false,
    user_type: 'external',
    timestamp: '2026-07-30T12:00:00Z',
    created_at: id,
    message: { role: 'assistant', content: conteudo },
  };
}

function chip(conteudo: ContentPart[], extras: Partial<Extract<RenderItem, { kind: 'chip' }>> = {}) {
  const item: Extract<RenderItem, { kind: 'chip' }> = {
    kind: 'chip',
    payload: payload(1, conteudo),
    chip: { icon: '$', label: 'Bash', summary: '' },
    expandBody: '',
    classifierKind: 'tool',
    ...extras,
  };
  return item;
}

const USO: ContentPart = { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } };

describe('execução — resultado que ainda não chegou', () => {
  it('sem resultado casado a execução está RODANDO, não concluída', () => {
    const entrada = execucaoDaParte(USO as Extract<ContentPart, { type: 'tool_use' }>, undefined);
    assert.equal(entrada.estado, 'running');
    assert.equal(entrada.result, undefined);
    assert.equal(entrada.toolName, 'Bash');
  });

  it('com resultado casado vira concluída, e o erro atravessa', () => {
    const lookup = buildToolResultLookup([
      payload(1, [USO]),
      payload(
        2,
        [{ type: 'tool_result', tool_use_id: 't1', content: 'estourou', is_error: true }],
        'user',
      ),
    ]);
    const entrada = execucaoDaParte(USO as Extract<ContentPart, { type: 'tool_use' }>, lookup);
    assert.equal(entrada.estado, 'complete');
    assert.equal(entrada.result, 'estourou');
    assert.equal(entrada.isError, true);
  });
});

describe('execução — resultado rico', () => {
  it('lookup com rich propaga o valor para a entrada', () => {
    const rich = { code: 200, bytes: 2_954_287 };
    const lookup: ToolResultLookup = new Map([
      ['t1', { content: 'ok', isError: false, rich }],
    ]);
    const entrada = execucaoDaParte(
      USO as Extract<ContentPart, { type: 'tool_use' }>,
      lookup,
    );
    assert.equal(entrada.rich, rich);
  });

  it('lookup sem rich deixa o campo undefined sem quebrar', () => {
    const lookup: ToolResultLookup = new Map([
      ['t1', { content: 'ok', isError: false }],
    ]);
    const entrada = execucaoDaParte(
      USO as Extract<ContentPart, { type: 'tool_use' }>,
      lookup,
    );
    assert.equal(entrada.rich, undefined);
  });

  it('sem lookup deixa rich undefined enquanto a execução está em voo', () => {
    const entrada = execucaoDaParte(
      USO as Extract<ContentPart, { type: 'tool_use' }>,
      undefined,
    );
    assert.equal(entrada.rich, undefined);
  });
});

describe('família do rich — quem renderiza o tool_use_result cru', () => {
  const FAMILIAS = join(import.meta.dirname, '../../../../fixtures/cockpit-v2/familias');
  const richDaFixture = (nome: string): unknown =>
    (JSON.parse(readFileSync(join(FAMILIAS, nome), 'utf8')) as { evento: { tool_use_result: unknown } })
      .evento.tool_use_result;

  it('o fetch do WebFetch cai na família fetch', () => {
    assert.equal(
      familiaDoRich(richDaFixture('result__bytes_code_codeText_durationMs_result.json')),
      'fetch',
    );
  });

  it('busca e matches caem na família lista', () => {
    assert.equal(
      familiaDoRich(richDaFixture('result__durationSeconds_query_results_searchCount.json')),
      'lista',
    );
    assert.equal(
      familiaDoRich(richDaFixture('result__matches_query_total_deferred_tools.json')),
      'lista',
    );
  });

  it('as duas formas de resultado de subagente caem na família agente', () => {
    assert.equal(
      familiaDoRich(richDaFixture('result__agentId_agentType_content_prompt_resolvedModel.json')),
      'agente',
    );
    assert.equal(
      familiaDoRich(richDaFixture('result__agentId_canReadOutputFile_description_isAsync_outputFile.json')),
      'agente',
    );
  });

  it('as duas origens de conteúdo de arquivo caem na família arquivo', () => {
    assert.equal(familiaDoRich(richDaFixture('result__file_type.json')), 'arquivo');
    assert.equal(
      familiaDoRich(richDaFixture('result__content_contentType_isBase64_method_path.json')),
      'arquivo',
    );
  });

  it('linhas de status caem na família status — inclusive a de falha', () => {
    assert.equal(familiaDoRich(richDaFixture('result__commandName_success.json')), 'status');
    assert.equal(familiaDoRich(richDaFixture('result__message_pin_success.json')), 'status');
    // success:false é da família G4 igual — antes da ramificação do G4 este
    // teste morava no "null" de baixo; quem mudar o contrato do status-line
    // tem de passar por aqui.
    assert.equal(familiaDoRich(richDaFixture('result__message_success.json')), 'status');
  });

  it('página publicada cai na família pagina-publicada', () => {
    assert.equal(
      familiaDoRich(richDaFixture('result__liveSubscription_path_title_updated_url.json')),
      'pagina-publicada',
    );
  });

  it('saída de shell cai na família shell', () => {
    assert.equal(
      familiaDoRich(richDaFixture('result__interrupted_isImage_noOutputExpected_stderr_stdout.json')),
      'shell',
    );
  });

  it('fora de qualquer família devolve null — o Saida genérico continua mandando', () => {
    assert.equal(familiaDoRich('texto cru'), null);
    assert.equal(familiaDoRich(null), null);
    assert.equal(familiaDoRich(undefined), null);
  });
});

describe('execução — bordas do chip', () => {
  it('chip com tool_use por baixo usa o nome REAL da ferramenta, não o rótulo', () => {
    const item = chip([{ type: 'tool_use', id: 't9', name: 'Grep', input: {} }], {
      chip: { icon: '?', label: 'rótulo do classificador', summary: '' },
    });
    assert.equal(usoDoChip(item)?.name, 'Grep');
    assert.equal(execucaoDoChip(item).toolName, 'Grep');
  });

  it('chip SEM tool_use casável cai no rótulo em vez de quebrar', () => {
    const item = chip([{ type: 'text', text: 'sem uso de ferramenta aqui' }]);
    assert.equal(usoDoChip(item), undefined);
    assert.equal(execucaoDoChip(item).toolName, 'Bash');
  });

  it('conteúdo vazio: corpo vazio NÃO vira concluído com resultado vazio', () => {
    const item = chip([], { expandBody: '' });
    const entrada = execucaoDoChip(item);
    assert.equal(entrada.estado, 'running');
    assert.equal(entrada.result, undefined, 'string vazia não pode virar resultado');
  });

  it('conteúdo vazio: mensagem sem content não derruba a leitura', () => {
    const item = chip([]);
    item.payload = { ...item.payload, message: null };
    assert.equal(usoDoChip(item), undefined);
    assert.doesNotThrow(() => execucaoDoChip(item));
  });

  it('conteúdo gigante atravessa inteiro — quem trunca é o renderer, não a ponte', () => {
    const gigante = 'x'.repeat(500_000);
    const item = chip([], { expandBody: gigante });
    const entrada = execucaoDoChip(item);
    assert.equal(entrada.estado, 'complete');
    assert.equal(entrada.result, gigante);
  });

  it('chip em tom de erro sem tool_use marca erro; sem tom, não inventa', () => {
    assert.equal(execucaoDoChip(chip([], { expandBody: 'x', tone: 'error' })).isError, true);
    assert.equal(execucaoDoChip(chip([], { expandBody: 'x' })).isError, undefined);
  });
});
