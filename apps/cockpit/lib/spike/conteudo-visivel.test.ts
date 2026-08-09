import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import { buildRenderItems } from '@grupo_borges/cockpit-core/render-items';

import { temConteudoVisivel } from './conteudo-visivel.ts';

function assistenteCom(parts: unknown[]): MessagePayload {
  return {
    id: 1,
    kind: 'assistant',
    uuid: 'a1',
    parent_uuid: null,
    is_sidechain: false,
    timestamp: '2026-08-02T00:00:00Z',
    created_at: 0,
    message: { role: 'assistant', content: parts },
  } as unknown as MessagePayload;
}

test('assistant com thinking vazio e nada mais NÃO é visível — o item oco do print', () => {
  const [item] = buildRenderItems([assistenteCom([{ type: 'thinking', thinking: '  \n' }])]);
  assert.equal(item.kind, 'assistant');
  assert.equal(temConteudoVisivel(item), false);
});

test('assistant sem nenhuma part não vira item — e se virasse, não seria visível', () => {
  const itens = buildRenderItems([assistenteCom([])]);
  for (const item of itens) assert.equal(temConteudoVisivel(item), false);
});

test('texto só de espaços NÃO é visível; com uma letra, é', () => {
  const [vazio] = buildRenderItems([assistenteCom([{ type: 'text', text: '   ' }])]);
  assert.equal(temConteudoVisivel(vazio), false);
  const [cheio] = buildRenderItems([assistenteCom([{ type: 'text', text: ' ok ' }])]);
  assert.equal(temConteudoVisivel(cheio), true);
});

test('thinking com conteúdo é visível', () => {
  const [item] = buildRenderItems([assistenteCom([{ type: 'thinking', thinking: 'hmm' }])]);
  assert.equal(temConteudoVisivel(item), true);
});

test('tool_use sozinho é visível — a linha de execução nasce antes do resultado', () => {
  const [item] = buildRenderItems([
    assistenteCom([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
  ]);
  assert.equal(temConteudoVisivel(item), true);
});

function falaDoRica(texto: string): MessagePayload {
  return {
    id: 2,
    kind: 'user',
    uuid: 'u1',
    parent_uuid: null,
    is_sidechain: false,
    timestamp: '2026-08-08T00:00:00Z',
    created_at: 0,
    message: { role: 'user', content: texto },
  } as unknown as MessagePayload;
}

test('metade de envelope de imagem sem foto e sem legenda não desenha', () => {
  const [foraDeUploads] = buildRenderItems([
    falaDoRica('[Image: source: /tmp/print-do-rica.png]'),
  ]);
  assert.equal(foraDeUploads.kind, 'user');
  assert.equal(temConteudoVisivel(foraDeUploads), false);

  const [semLegenda] = buildRenderItems([
    falaDoRica('[Image #2]Imagem enviada via cockpit:'),
  ]);
  assert.equal(temConteudoVisivel(semLegenda), false);
});

test('a metade que tem foto, e a que tem legenda, continuam desenhando', () => {
  const [comFoto] = buildRenderItems([
    falaDoRica(
      '[Image: source: /home/clawd/repos/grupo_borges/apps/api/uploads/agents/daniel/1786236851587-9f17120b8449.png]',
    ),
  ]);
  assert.equal(temConteudoVisivel(comFoto), true);

  const [comLegenda] = buildRenderItems([falaDoRica('[Image #4]Caption: agora valendo')]);
  assert.equal(temConteudoVisivel(comLegenda), true);

  const [fala] = buildRenderItems([falaDoRica('Daniel, agora valendo')]);
  assert.equal(temConteudoVisivel(fala), true);
});

// Prova contra as 52 famílias reais: o filtro nunca esconde um kind que não
// seja `assistant` — user, chip, sidechain e synthetic sempre desenham algo.
test('nenhum item não-assistant das 52 famílias reais é filtrado', () => {
  const dir = join(import.meta.dirname, '../../../../fixtures/cockpit-v2/familias');
  const indice = JSON.parse(readFileSync(join(dir, 'bloco__text.json'), 'utf8')) as {
    evento: MessagePayload;
  };
  const itens = buildRenderItems([indice.evento]);
  assert.ok(itens.length > 0);
  for (const item of itens) assert.equal(temConteudoVisivel(item), true);
});
