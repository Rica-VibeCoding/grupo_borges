import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ContentPart, MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import type { EntradaDaExecucao } from './execucao-do-item.ts';
import type { MembroDoGrupo } from './grupo-ferramentas.ts';
import { duracaoCurta, duracaoDoGrupo, entradasDoGrupo, resumeGrupo } from './resumo-do-grupo.ts';

function bash(command: string, result?: string, isError?: boolean): EntradaDaExecucao {
  return {
    toolName: 'Bash',
    args: { command },
    result,
    isError,
    estado: result === undefined ? 'running' : 'complete',
  };
}

function edicao(antes: string, depois: string): EntradaDaExecucao {
  return {
    toolName: 'Edit',
    args: { file_path: '/a.ts', old_string: antes, new_string: depois },
    result: 'ok',
    estado: 'complete',
  };
}

describe('resumo do grupo — a frase', () => {
  it('agrega por verbo na ordem da conversa, com "e" antes da última parte', () => {
    const resumo = resumeGrupo([
      bash('ls', 'a'),
      bash('pwd', '/tmp'),
      { toolName: 'Read', args: { file_path: '/a.ts' }, result: 'x', estado: 'complete' },
      bash('git status', 'ok'),
      edicao('um\n', 'um\ndois\n'),
      edicao('a', 'b'),
    ]);
    assert.equal(resumo.frase, 'Executou 3 comandos, leu um arquivo e editou 2 arquivos');
    assert.equal(resumo.estado, 'feito');
    assert.equal(resumo.atual, null);
  });

  it('uma parte só não tem "e" nem vírgula', () => {
    assert.equal(resumeGrupo([bash('ls', 'a')]).frase, 'Executou um comando');
  });

  it('ferramentas do mesmo verbo fundem — Bash e BashOutput são a mesma ação', () => {
    const resumo = resumeGrupo([
      bash('npm test', 'ok'),
      { toolName: 'BashOutput', args: {}, result: 'saida', estado: 'complete' },
    ]);
    assert.equal(resumo.frase, 'Executou 2 comandos');
  });

  it('enquanto trabalha, a linha é a execução em voo no gerúndio — nunca o passado pela metade', () => {
    const resumo = resumeGrupo([
      bash('ls', 'a'),
      bash('npm test'), // sem resultado: rodando
    ]);
    assert.equal(resumo.estado, 'rodando');
    assert.deepEqual(resumo.atual, { verbo: 'Executando', alvo: 'npm test', frase: 'Executando npm test' });
  });

  it('a em voo é a ÚLTIMA — é a que acabou de começar', () => {
    const resumo = resumeGrupo([
      bash('primeiro'),
      { toolName: 'Read', args: { file_path: '/a.ts' }, estado: 'running' },
    ]);
    assert.deepEqual(resumo.atual, { verbo: 'Lendo', alvo: '/a.ts', frase: 'Lendo /a.ts' });
  });
});

describe('resumo do grupo — estado e saldo', () => {
  it('aguarda vence rodando: é o único estado que chama o Rica', () => {
    const resumo = resumeGrupo([
      bash('ls'),
      { toolName: 'Bash', args: { command: 'rm -rf' }, estado: 'requires-action' },
    ]);
    assert.equal(resumo.estado, 'aguarda');
  });

  it('rodando vence falhou: a corrida continua', () => {
    const resumo = resumeGrupo([bash('ls', 'x', true), bash('pwd')]);
    assert.equal(resumo.estado, 'rodando');
  });

  it('grupo que TERMINOU falhando é falha — e vira a palavra erro, não só cor', () => {
    const resumo = resumeGrupo([bash('ls', 'a'), bash('pwd', 'stack', true)]);
    assert.equal(resumo.estado, 'falhou');
    assert.deepEqual(resumo.rendimento, { texto: 'erro' });
    assert.equal(resumo.retentativas, 0);
  });

  it('erro no meio que o agente refez e seguiu é retentativa, não falha do grupo', () => {
    const resumo = resumeGrupo([bash('ls', 'stack', true), bash('ls', 'a'), bash('pwd', '/tmp')]);
    assert.equal(resumo.estado, 'feito');
    assert.equal(resumo.retentativas, 1);
    assert.equal(resumo.passos, 3);
    assert.equal(resumo.rendimento, null);
  });

  it('a linha em voo mostra a intenção do Bash, nunca o comando cru', () => {
    const resumo = resumeGrupo([
      bash('ls', 'a'),
      { toolName: 'Bash', args: { command: 'C=/home/x/chrome --shot', description: 'Tira o print do chat' }, estado: 'running' },
    ]);
    assert.equal(resumo.atual?.frase, 'Tira o print do chat');
  });

  it('o saldo soma os diffs estruturados dos membros', () => {
    const resumo = resumeGrupo([
      edicao('um\n', 'um\ndois\n'), // +1 −0
      {
        toolName: 'Write',
        args: { file_path: '/b.ts', content: 'a\nb\nc\n' },
        result: 'ok',
        estado: 'complete',
      }, // +3
    ]);
    assert.deepEqual(resumo.rendimento, { texto: '+4 −0', adicoes: 4, remocoes: 0 });
  });

  it('grupo de leituras não inventa número', () => {
    const resumo = resumeGrupo([
      { toolName: 'Read', args: { file_path: '/a.ts' }, result: 'x', estado: 'complete' },
      bash('ls', 'a\nb'),
    ]);
    assert.equal(resumo.rendimento, null);
  });
});

describe('entradas do grupo — o achatamento', () => {
  function assistantCom(parts: ContentPart[], uuid: string): MembroDoGrupo {
    return {
      kind: 'assistant',
      payload: {
        id: 1,
        kind: 'assistant',
        uuid,
        parent_uuid: null,
        is_sidechain: false,
        timestamp: '2026-08-02T00:00:00Z',
        created_at: 0,
        message: { role: 'assistant', content: parts },
      } as unknown as MessagePayload,
      parts,
    };
  }

  it('um assistant com VÁRIOS tool_use vira uma execução por tool_use', () => {
    const membro = assistantCom(
      [
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/a.ts' } },
      ],
      'a1',
    );
    const entradas = entradasDoGrupo([membro]);
    assert.equal(entradas.length, 2);
    assert.deepEqual(entradas.map((e) => e.toolName), ['Bash', 'Read']);
  });

  it('chip entra como uma execução, com o tool_use do payload', () => {
    const chip = {
      kind: 'chip',
      payload: {
        id: 2,
        kind: 'assistant',
        uuid: 'c1',
        parent_uuid: null,
        is_sidechain: false,
        timestamp: '2026-08-02T00:00:00Z',
        created_at: 0,
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't9', name: 'Grep', input: { pattern: 'foo' } }],
        },
      },
      chip: { icon: '', label: 'Grep', summary: '' },
      expandBody: '',
      classifierKind: 'tool',
    } as unknown as MembroDoGrupo;
    const entradas = entradasDoGrupo([chip]);
    assert.equal(entradas.length, 1);
    assert.equal(entradas[0].toolName, 'Grep');
  });
});

describe('duração do grupo', () => {
  function membro(timestamp: string): MembroDoGrupo {
    return {
      kind: 'assistant',
      payload: { timestamp } as unknown as MessagePayload,
      parts: [],
    };
  }

  it('mede do primeiro ao último carimbo', () => {
    const ms = duracaoDoGrupo([membro('2026-09-28T03:11:00Z'), membro('2026-09-28T03:11:20Z')]);
    assert.equal(ms, 20_000);
    assert.equal(duracaoCurta(ms!), '20 s');
  });

  it('grupo de um instante ou carimbo torto não inventa duração', () => {
    assert.equal(duracaoDoGrupo([membro('2026-09-28T03:11:00Z'), membro('2026-09-28T03:11:00Z')]), null);
    assert.equal(duracaoDoGrupo([membro('lixo'), membro('2026-09-28T03:11:00Z')]), null);
  });

  it('minutos e horas arredondados', () => {
    assert.equal(duracaoCurta(70_000), '1 min');
    assert.equal(duracaoCurta(2 * 3_600_000), '2 h');
  });
});
