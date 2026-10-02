import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { leExecucao } from './gramatica.ts';
import { ehIdentificadorOpaco } from './identificador-opaco.ts';

const FILE_ID = 'AwACAgEAAxkBAAI-eGq_lxLX4h3dPINpG';

describe('identificador cru nunca vira alvo (02/10)', () => {
  it('reconhece file_id, UUID, hash e token', () => {
    assert.equal(ehIdentificadorOpaco(FILE_ID), true);
    assert.equal(ehIdentificadorOpaco('3f2c9a1e-7b4d-4e2a-9c1f-0a8b7d6e5f43'), true);
    assert.equal(ehIdentificadorOpaco('a00e1dc5b33fb7c0dd33e6c84e69bf4f'), true);
    assert.equal(ehIdentificadorOpaco('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc'), true);
  });

  it('deixa passar o que é legível: caminho, comando, entidade, camelCase, palavra curta', () => {
    for (const legivel of [
      '/home/clawd/repos/grupo_borges/apps/cockpit/Componente2Novo',
      'components/renderers/gramatica.ts',
      'git status --short',
      'npm test',
      'light.sala_de_estar',
      'useEstadoDaLinha2',
      'a00e1dc',
    ]) {
      assert.equal(ehIdentificadorOpaco(legivel), false, legivel);
    }
  });

  it('download_attachment com o file_id: "Baixou o anexo", sem o id', () => {
    const e = leExecucao({
      toolName: 'mcp__plugin_telegram_telegram__download_attachment',
      args: { file_id: FILE_ID },
    });
    assert.equal(e.frase, 'Baixou o anexo');
    assert.ok(!e.frase.includes('AwACAg'));
    assert.equal(
      leExecucao({
        toolName: 'mcp__plugin_telegram_telegram__download_attachment',
        args: { file_id: FILE_ID },
        estado: 'running',
      }).frase,
      'Baixando o anexo',
    );
  });

  it('ferramenta fora da tabela com só id: verbo + nome amigável, nunca o id', () => {
    const e = leExecucao({ toolName: 'mcp__servidor_novo__busca', args: { id: FILE_ID } });
    assert.equal(e.frase, 'Usou servidor_novo/busca');
  });

  it('id num campo nomeado também cai: o nome amigável vai no lugar', () => {
    const e = leExecucao({ toolName: 'TaskStop', args: { task_id: FILE_ID } });
    assert.equal(e.frase, 'Usou TaskStop');
  });

  it('alvo legítimo não é cortado: caminho e comando curto', () => {
    assert.equal(
      leExecucao({ toolName: 'Read', args: { file_path: '/a/gramatica.ts' } }).frase,
      'Leu /a/gramatica.ts',
    );
    assert.equal(leExecucao({ toolName: 'Bash', args: { command: 'npm test' } }).frase, 'Executou npm test');
  });

  it('o primeiro texto legível depois do id ainda serve de alvo', () => {
    const e = leExecucao({ toolName: 'mcp__x__y', args: { id: FILE_ID, nome: 'relatório' } });
    assert.equal(e.frase, 'Usou relatório');
  });
});

describe('frases das ferramentas que caíam no buraco do alvo', () => {
  it('Telegram responde, reage e edita sem ecoar o texto', () => {
    const reply = leExecucao({
      toolName: 'mcp__plugin_telegram_telegram__reply',
      args: { chat_id: '836123', text: 'Bom dia, chefe' },
    });
    assert.equal(reply.frase, 'Respondeu no Telegram');
    assert.equal(
      leExecucao({ toolName: 'mcp__plugin_telegram_telegram__react', args: { emoji: '👍' } }).frase,
      'Reagiu no Telegram',
    );
  });

  it('casa: a entidade legível vira alvo; sem ela, o objeto completa', () => {
    assert.equal(
      leExecucao({ toolName: 'mcp__ha-mcp__ha_get_state', args: { entity_id: 'light.sala' } }).frase,
      'Consultou light.sala',
    );
    assert.equal(
      leExecucao({ toolName: 'mcp__ha-mcp__ha_get_logs', args: { source: 'system' } }).frase,
      'Leu os logs da casa',
    );
    assert.equal(
      leExecucao({ toolName: 'mcp__ha-mcp__ha_get_history', args: { entity_ids: ['a', 'b'] } }).frase,
      'Consultou o histórico da casa',
    );
  });

  it('ExitPlanMode não despeja o plano na linha; ListAgents sem argumento fala', () => {
    assert.equal(
      leExecucao({ toolName: 'ExitPlanMode', args: { plan: 'Refatorar o feed do turno' } }).frase,
      'Apresentou o plano',
    );
    assert.equal(leExecucao({ toolName: 'ListAgents' }).frase, 'Listou os agentes');
  });
});
