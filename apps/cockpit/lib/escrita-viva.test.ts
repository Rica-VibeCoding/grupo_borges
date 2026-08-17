import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import type { AssistenteDeTrabalho, ItemDoFeed } from '../components/feed/grupo-ferramentas.ts';
import {
  escrevendoNoFim,
  JANELA_OUTPUT_CODEX_MS,
  saindoOutputNoCodex,
  saindoOutputNoFim,
} from './escrita-viva.ts';

let proximoId = 0;

function mensagem(role: string, content: unknown): MessagePayload {
  proximoId += 1;
  return {
    id: proximoId,
    kind: role,
    uuid: `ev-${proximoId}`,
    parent_uuid: null,
    is_sidechain: false,
    user_type: 'external',
    timestamp: '2026-08-17T03:00:00.000Z',
    created_at: 0,
    message: { role, content },
  } as unknown as MessagePayload;
}

function assistente(partes: readonly unknown[]): AssistenteDeTrabalho {
  return {
    kind: 'assistant',
    payload: mensagem('assistant', partes),
    parts: partes,
  } as unknown as AssistenteDeTrabalho;
}

const TEXTO = { type: 'text', text: 'A régua é a última parte' };
const FERRAMENTA = { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } };

describe('escrevendoNoFim', () => {
  it('feed vazio não está escrevendo', () => {
    assert.equal(escrevendoNoFim([]), false);
  });

  it('texto do assistente no fim é escrita viva', () => {
    assert.equal(escrevendoNoFim([assistente([TEXTO])]), true);
  });

  it('texto seguido de ferramenta NÃO é escrita: quem está no ar é a ferramenta', () => {
    // É o caso comum de um item de assistente — ele fala e então chama uma
    // ferramenta. Olhar "existe texto em algum lugar" acenderia errado.
    assert.equal(escrevendoNoFim([assistente([TEXTO, FERRAMENTA])]), false);
  });

  it('ferramenta seguida de texto volta a ser escrita', () => {
    assert.equal(escrevendoNoFim([assistente([FERRAMENTA, TEXTO])]), true);
  });

  it('último item que não é do assistente não conta', () => {
    const doUsuario = { kind: 'user', payload: mensagem('user', 'oi') } as unknown as ItemDoFeed;
    assert.equal(escrevendoNoFim([assistente([TEXTO]), doUsuario]), false);
  });
});

describe('saindoOutputNoFim', () => {
  it('ferramenta em voo é output saindo — o defeito que o Rica filmou em 17/08', () => {
    // Este é O caso: a bolinha ficava com cara de "pensando" o turno inteiro
    // porque o turno é quase todo ferramenta rodando, e a régua antiga só
    // olhava texto. Sem lookup não há resultado casado, então ela está em voo.
    assert.equal(saindoOutputNoFim([assistente([TEXTO, FERRAMENTA])]), true);
  });

  it('ferramenta que já voltou não é output saindo', () => {
    const lookup: ToolResultLookup = new Map([['tu-1', { content: 'ok', isError: false }]]);
    assert.equal(saindoOutputNoFim([assistente([TEXTO, FERRAMENTA])], lookup), false);
  });

  it('texto crescendo continua contando, sem ferramenta nenhuma', () => {
    assert.equal(saindoOutputNoFim([assistente([TEXTO])]), true);
  });

  it('feed vazio não tem output', () => {
    assert.equal(saindoOutputNoFim([]), false);
  });
});

describe('saindoOutputNoCodex', () => {
  const AGORA = Date.parse('2026-08-17T08:00:00.000Z');

  it('o lookup do Codex é vazio por construção, e por isso a régua do CC gruda', () => {
    // O DEFEITO DA FOTO DE 17/08, em uma linha: `function_call_output` chega
    // com o texto redigido e `visible=False`, então o lookup nunca casa o
    // `tool_use`. Vinte minutos depois do turno acabar, a régua do CC ainda diz
    // que tem ferramenta em voo — e a bolinha ficava olhando pra cima.
    const feed = [assistente([TEXTO, FERRAMENTA])];
    assert.equal(saindoOutputNoFim(feed, new Map()), true);
    assert.equal(saindoOutputNoCodex(AGORA - 20 * 60_000, AGORA), false);
  });

  it('rollout que acabou de crescer é output saindo', () => {
    assert.equal(saindoOutputNoCodex(AGORA - 4_000, AGORA), true);
  });

  it('o silêncio desliga sozinho no fim da janela', () => {
    assert.equal(saindoOutputNoCodex(AGORA - (JANELA_OUTPUT_CODEX_MS - 1), AGORA), true);
    assert.equal(saindoOutputNoCodex(AGORA - JANELA_OUTPUT_CODEX_MS, AGORA), false);
  });

  it('conversa sem nenhuma mensagem não tem âncora — e não produz nada', () => {
    assert.equal(saindoOutputNoCodex(null, AGORA), false);
  });
});
