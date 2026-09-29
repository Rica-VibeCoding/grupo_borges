import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { ContentPart, MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { cabecalhoDaFerramenta } from './cabecalho-da-ferramenta.ts';

const exemplo = JSON.parse(readFileSync(new URL(
  '../../../../fixtures/cockpit-v2/familias/tool__Bash.json', import.meta.url,
), 'utf8')).evento as MessagePayload;
const mensagem = (role: 'user' | 'assistant', content: string | ContentPart[]): MessagePayload => ({
  ...exemplo, kind: role, message: { role, content },
});
const ferramenta = (input: unknown): ContentPart => ({ type: 'tool_use', id: 't1', name: 'Bash', input });
const usa = (description: unknown) => mensagem('assistant', [ferramenta({ description })]);
const pedido = mensagem('user', 'Confira os documentos.');
const antiga = usa('Conferindo os arquivos da conversa');
const resultado = mensagem('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]);

describe('cabeçalho da ferramenta do turno atual', () => {
  it('lê input.description do exemplo real do fluxo SSE', () => {
    assert.equal(cabecalhoDaFerramenta([exemplo]), 'Lista docs em andamento e de UI');
  });

  it('seleciona a última ferramenta, entre mensagens e entre blocos', () => {
    assert.equal(cabecalhoDaFerramenta([pedido, antiga, usa('Conferindo a resposta')]), 'Conferindo a resposta');
    assert.equal(cabecalhoDaFerramenta([pedido, mensagem('assistant', [
      ferramenta({ description: 'Conferindo a primeira' }),
      ferramenta({ description: 'Conferindo a segunda' }),
      { type: 'text', text: 'Um momento.' },
    ])]), 'Conferindo a segunda');
  });

  it('não recua quando a última ferramenta não tem descrição utilizável', () => {
    for (const input of [{}, null, 'Conferindo a resposta', [], { description: 42 }, { description: '' }, { description: '   ' }, { description: 'Run tests' }]) {
      assert.equal(cabecalhoDaFerramenta([pedido, antiga, mensagem('assistant', [ferramenta(input)])]), null);
      assert.equal(cabecalhoDaFerramenta([mensagem('assistant', [
        ferramenta({ description: 'Conferindo a primeira' }), ferramenta(input),
      ])]), null);
    }
  });

  it('resultado e raciocínio não escondem a última ferramenta do mesmo turno', () => {
    assert.equal(cabecalhoDaFerramenta([pedido, antiga, resultado,
      mensagem('assistant', [{ type: 'thinking', thinking: '...' }]),
    ]), 'Conferindo os arquivos da conversa');
  });

  it('pedido novo impede reaproveitar descrição antiga, mesmo com resultado depois', () => {
    assert.equal(cabecalhoDaFerramenta([antiga, pedido]), null);
    assert.equal(cabecalhoDaFerramenta([antiga, pedido, resultado]), null);
    assert.equal(cabecalhoDaFerramenta([antiga, mensagem('user', [{ type: 'text', text: 'Outro pedido' }])]), null);
    assert.equal(cabecalhoDaFerramenta([antiga, pedido, usa('Conferindo o novo pedido')]), 'Conferindo o novo pedido');
  });

  it('ignora mensagens laterais de subagentes', () => {
    assert.equal(cabecalhoDaFerramenta([antiga, { ...usa('Conferindo a lateral'), is_sidechain: true },
      { ...pedido, is_sidechain: true },
    ]), 'Conferindo os arquivos da conversa');
  });

  it('retorna null sem ferramenta, inclusive com conteúdo nulo do fluxo real', () => {
    const nulo = { ...exemplo, message: { role: 'assistant', content: null } } as unknown as MessagePayload;
    for (const mensagens of [[], [pedido], [mensagem('assistant', 'Tudo certo.')], [nulo], [{ ...exemplo, message: null }]]) {
      assert.equal(cabecalhoDaFerramenta(mensagens), null);
    }
  });
});

describe('filtro exato da descrição', () => {
  it('rejeita cada caractere proibido sem voltar à descrição anterior', () => {
    for (const caractere of ['/', '\\', '`', '|', '$', '=', '{', '}', '<', '>']) {
      assert.equal(cabecalhoDaFerramenta([antiga, usa(`Conferindo a resposta ${caractere}`)]), null, caractere);
    }
  });

  it('aceita 120 caracteres e rejeita 121', () => {
    const limite = `a ${'x'.repeat(118)}`;
    assert.equal(cabecalhoDaFerramenta([usa(limite)]), limite);
    assert.equal(cabecalhoDaFerramenta([antiga, usa(`${limite}x`)]), null);
  });

  it('aceita palavra acentuada ou cada marcador português isolado', () => {
    for (const texto of ['Verificação', 'TÔ conferindo', 'o documento', 'a resposta', 'de documentos', 'do documento', 'da conversa', 'e documentos', 'que documentos', 'pra conferir', 'Conferindo (QUE) documentos']) {
      assert.equal(cabecalhoDaFerramenta([usa(texto)]), texto);
    }
  });

  it('não confunde trecho de palavra com marcador português', () => {
    for (const texto of ['Run tests', 'Load data', 'decode', 'queue', 'upgrade', '123']) {
      assert.equal(cabecalhoDaFerramenta([usa(texto)]), null, texto);
    }
  });
});
