import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ContentPart, MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import type { RenderItem } from '@grupo_borges/cockpit-core/render-items';
import { buildToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import type { ItemDoFeed } from './grupo-ferramentas.ts';
import { idsQueOItemLe, mesmasPropsDoItem } from './mesmo-item.ts';

function payload(id: number, conteudo: ContentPart[] | string, kind: 'user' | 'assistant', rich?: unknown): MessagePayload {
  return {
    id,
    kind,
    uuid: `uuid-${id}`,
    parent_uuid: null,
    session_id: 'sessao',
    is_sidechain: false,
    user_type: 'external',
    timestamp: '2026-09-28T12:00:00Z',
    created_at: id,
    message: { role: kind, content: conteudo },
    ...(rich === undefined ? {} : { tool_use_result: rich }),
  } as MessagePayload;
}

const uso = (id: string): ContentPart => ({ type: 'tool_use', id, name: 'Bash', input: { command: `echo ${id}` } });
const resultado = (id: string, texto: string): ContentPart => ({ type: 'tool_result', tool_use_id: id, content: texto });

function assistente(id: number, partes: ContentPart[]): Extract<RenderItem, { kind: 'assistant' }> {
  return { kind: 'assistant', payload: payload(id, partes, 'assistant'), parts: partes };
}

function chip(id: number, partes: ContentPart[], classifierKind: 'tool' | 'skill' = 'tool'): Extract<RenderItem, { kind: 'chip' }> {
  return {
    kind: 'chip',
    payload: payload(id, partes, 'assistant'),
    chip: { icon: '$', label: 'Bash', summary: '' },
    expandBody: '',
    classifierKind,
  } as Extract<RenderItem, { kind: 'chip' }>;
}

describe('idsQueOItemLe', () => {
  it('assistant: os tool_use das partes, texto não conta', () => {
    const item = assistente(1, [{ type: 'text', text: 'oi' }, uso('a'), uso('b')]);
    assert.deepEqual(idsQueOItemLe(item), ['a', 'b']);
  });

  it('chip de ferramenta lê o tool_use da mensagem; chip de outra família não lê nada', () => {
    assert.deepEqual(idsQueOItemLe(chip(1, [uso('x')])), ['x']);
    assert.deepEqual(idsQueOItemLe(chip(1, [uso('x')], 'skill')), []);
  });

  it('grupo: os ids de todos os membros, na ordem', () => {
    const grupo: ItemDoFeed = { kind: 'grupo-ferramentas', itens: [assistente(1, [uso('a')]), chip(2, [uso('b')])] };
    assert.deepEqual(idsQueOItemLe(grupo), ['a', 'b']);
  });

  it('item sem ferramenta não lê o lookup', () => {
    assert.deepEqual(idsQueOItemLe({ kind: 'linha-viva', desdeMs: 1 }), []);
  });
});

describe('mesmasPropsDoItem', () => {
  const item = assistente(1, [uso('a')]);
  const base = [payload(1, [uso('a')], 'assistant')];

  it('lookup reconstruído das MESMAS mensagens não redesenha', () => {
    const msgs = [...base, payload(2, [resultado('a', 'ok')], 'user')];
    const antes = { item, lookup: buildToolResultLookup(msgs) };
    const depois = { item, lookup: buildToolResultLookup([...msgs]) };
    assert.notEqual(antes.lookup, depois.lookup);
    assert.equal(mesmasPropsDoItem(antes, depois), true);
  });

  it('resultado de OUTRA ferramenta chegando não redesenha', () => {
    const antes = { item, lookup: buildToolResultLookup(base) };
    const depois = { item, lookup: buildToolResultLookup([...base, payload(2, [resultado('z', 'ok')], 'user')]) };
    assert.equal(mesmasPropsDoItem(antes, depois), true);
  });

  it('resultado DA ferramenta do item chegando redesenha (rodando → concluído)', () => {
    const antes = { item, lookup: buildToolResultLookup(base) };
    const depois = { item, lookup: buildToolResultLookup([...base, payload(2, [resultado('a', 'ok')], 'user')]) };
    assert.equal(mesmasPropsDoItem(antes, depois), false);
  });

  it('corpo, erro ou rico diferentes redesenham', () => {
    const com = (texto: string, rich?: unknown) =>
      buildToolResultLookup([...base, payload(2, [resultado('a', texto)], 'user', rich)]);
    assert.equal(mesmasPropsDoItem({ item, lookup: com('um') }, { item, lookup: com('dois') }), false);
    assert.equal(mesmasPropsDoItem({ item, lookup: com('um', { a: 1 }) }, { item, lookup: com('um', { a: 1 }) }), false);
    const rico = { stdout: 'x' };
    assert.equal(mesmasPropsDoItem({ item, lookup: com('um', rico) }, { item, lookup: com('um', rico) }), true);
  });

  it('membro de grupo recebendo resultado redesenha o grupo', () => {
    const grupo: ItemDoFeed = { kind: 'grupo-ferramentas', itens: [assistente(1, [uso('a')]), assistente(3, [uso('b')])] };
    const antes = { item: grupo, lookup: buildToolResultLookup(base) };
    const depois = { item: grupo, lookup: buildToolResultLookup([...base, payload(4, [resultado('b', 'ok')], 'user')]) };
    assert.equal(mesmasPropsDoItem(antes, depois), false);
  });

  it('item novo, slug ou cursor de streaming diferentes redesenham', () => {
    const lookup = buildToolResultLookup(base);
    assert.equal(mesmasPropsDoItem({ item, lookup }, { item: assistente(1, [uso('a')]), lookup }), false);
    assert.equal(mesmasPropsDoItem({ item, lookup, agentSlug: 'a' }, { item, lookup, agentSlug: 'b' }), false);
    assert.equal(mesmasPropsDoItem({ item, lookup, estaRodando: false }, { item, lookup, estaRodando: true }), false);
    assert.equal(mesmasPropsDoItem({ item, lookup }, { item, lookup, estaRodando: false }), true);
  });
});
