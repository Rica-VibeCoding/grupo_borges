import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ContentPart, MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import { buildToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { entradasDoGrupo, resumeGrupo } from './resumo-do-grupo.ts';
import { execucaoDaParte } from './execucao-do-item.ts';
import { encerraOrfas, foiInterrompida, INTERROMPIDO } from './orfas-do-turno.ts';

type Uso = Extract<ContentPart, { type: 'tool_use' }>;

function resposta(
  n: number,
  partes: ContentPart[],
  extras: { msgId?: string; sidechain?: boolean; agente?: string } = {},
): MessagePayload {
  return {
    id: n,
    kind: 'assistant',
    uuid: `uuid-${n}`,
    parent_uuid: null,
    session_id: 'sessao',
    is_sidechain: extras.sidechain ?? false,
    agent_id: extras.agente ?? null,
    user_type: 'external',
    timestamp: '2026-10-01T04:01:12Z',
    created_at: n,
    message: { role: 'assistant', id: 'msgId' in extras ? extras.msgId : `msg-${n}`, content: partes },
  };
}

function resultado(n: number, idDoUso: string): MessagePayload {
  return {
    id: n,
    kind: 'user',
    uuid: `uuid-${n}`,
    parent_uuid: null,
    session_id: 'sessao',
    is_sidechain: false,
    user_type: 'external',
    timestamp: '2026-10-01T04:01:13Z',
    created_at: n,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: idDoUso, content: 'ok' }] },
  };
}

const uso = (id: string, name = 'Bash'): Uso => ({ type: 'tool_use', id, name, input: { command: 'ls' } });
const fecha = (messages: MessagePayload[], turnoAcabou: boolean) =>
  encerraOrfas(messages, buildToolResultLookup(messages), turnoAcabou);

describe('órfãs do turno — só o último turno em voo pode ter running', () => {
  it('com o turno em voo, a ferramenta do fim continua rodando', () => {
    const msgs = [resposta(1, [uso('a')])];
    const lookup = fecha(msgs, false);
    assert.equal(lookup.has('a'), false);
    assert.equal(execucaoDaParte(uso('a'), lookup).estado, 'running');
  });

  it('turno acabou: a sem resultado vira erro interrompido, não running', () => {
    const msgs = [resposta(1, [uso('a')])];
    const entrada = execucaoDaParte(uso('a'), fecha(msgs, true));
    assert.equal(entrada.estado, 'complete');
    assert.equal(entrada.isError, true);
    assert.equal(entrada.result, INTERROMPIDO);
    assert.equal(foiInterrompida(entrada), true);
  });

  it('resposta posterior do agente encerra a órfã mesmo com o turno em voo (o caso das 04:01 de 01/10)', () => {
    const msgs = [resposta(1, [uso('orfa')]), resposta(2, [uso('nova')])];
    const lookup = fecha(msgs, false);
    assert.equal(execucaoDaParte(uso('orfa'), lookup).estado, 'complete');
    assert.equal(execucaoDaParte(uso('nova'), lookup).estado, 'running');
  });

  it('várias ferramentas da MESMA resposta (mesmo message.id) esperam juntas', () => {
    const msgs = [resposta(1, [uso('a')], { msgId: 'm' }), resposta(2, [uso('b')], { msgId: 'm' })];
    const lookup = fecha(msgs, false);
    assert.equal(lookup.has('a'), false);
    assert.equal(lookup.has('b'), false);
  });

  it('resposta de subagente não encerra ferramenta do principal', () => {
    const msgs = [resposta(1, [uso('a')]), resposta(2, [uso('s')], { sidechain: true, agente: 'x' })];
    assert.equal(fecha(msgs, false).has('a'), false);
  });

  it('AskUserQuestion: o fim do turno não encerra; resposta posterior encerra', () => {
    const pergunta = uso('q', 'AskUserQuestion');
    assert.equal(fecha([resposta(1, [pergunta])], true).has('q'), false);
    const lookup = fecha([resposta(1, [pergunta]), resposta(2, [{ type: 'text', text: 'segui' }])], false);
    assert.equal(execucaoDaParte(pergunta, lookup).estado, 'complete');
  });

  it('ferramenta com resultado de verdade não é tocada, e sem órfã o lookup é o mesmo objeto', () => {
    const msgs = [resposta(1, [uso('a')]), resultado(2, 'a'), resposta(3, [uso('b')])];
    const base = buildToolResultLookup(msgs);
    assert.equal(encerraOrfas(msgs, base, false), base);
    const fechado = encerraOrfas(msgs, base, true);
    assert.equal(fechado.get('a')?.content, 'ok');
    assert.equal(fechado.get('b')?.content, INTERROMPIDO);
  });

  it('resposta sem message.id não conta como posterior (não dá pra provar que é outra)', () => {
    const msgs = [resposta(1, [uso('a')], { msgId: undefined }), resposta(2, [uso('b')], { msgId: undefined })];
    assert.equal(fecha(msgs, false).has('a'), false);
  });
});

describe('órfãs do turno — o grupo', () => {
  it('grupo cujo último passo foi interrompido sai de rodando e diz "interrompido"', () => {
    const msgs = [resposta(1, [uso('a')]), resultado(2, 'a'), resposta(3, [uso('b')])];
    const itens = msgs.filter((m) => m.kind === 'assistant').map((payload) => ({
      kind: 'assistant' as const,
      payload,
      parts: payload.message!.content as ContentPart[],
    }));
    const resumo = resumeGrupo(entradasDoGrupo(itens, fecha(msgs, true)));
    assert.equal(resumo.estado, 'falhou');
    assert.equal(resumo.rendimento?.texto, 'interrompido');
    assert.equal(resumo.atual, null);
  });

  it('erro de verdade continua "erro"', () => {
    assert.equal(foiInterrompida({ result: 'estourou', isError: true }), false);
  });
});
