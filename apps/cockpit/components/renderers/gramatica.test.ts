import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { encurtaCaminho, encurtaNomeMcp, leExecucao } from './gramatica.ts';

describe('gramática da execução — o sigilo', () => {
  it('apaga a palavra Bash: o $ já é o nome, e são 738 linhas', () => {
    const e = leExecucao({ toolName: 'Bash', args: { command: 'git status --short' } });
    assert.equal(e.sigilo, '$');
    assert.equal(e.rotulo, null);
    assert.equal(e.alvo, 'git status --short');
  });

  it('mantém o rótulo onde o sigilo é ambíguo — > é Write E Edit', () => {
    assert.equal(leExecucao({ toolName: 'Write', args: {} }).rotulo, 'Write');
    assert.equal(leExecucao({ toolName: 'Edit', args: {} }).rotulo, 'Edit');
    assert.equal(leExecucao({ toolName: 'Read', args: {} }).rotulo, null);
  });

  it('classifica MCP pelo MÉTODO, não pelo servidor: a lista envelheceria', () => {
    assert.equal(leExecucao({ toolName: 'mcp__supabase_geral__execute_sql' }).sigilo, '?');
    assert.equal(leExecucao({ toolName: 'mcp__supabase_geral__list_tables' }).sigilo, '?');
    assert.equal(leExecucao({ toolName: 'mcp__plugin_telegram_telegram__reply' }).sigilo, '@');
  });

  it('ferramenta que não conhece cai em ~, nunca em linha muda', () => {
    const e = leExecucao({ toolName: 'FerramentaQueAindaNaoExiste', args: { alvo: 'x' } });
    assert.equal(e.sigilo, '~');
    assert.equal(e.rotulo, 'FerramentaQueAindaNaoExiste');
    assert.equal(e.alvo, 'x');
  });
});

describe('nome de MCP', () => {
  it('tira o transporte e a repetição do plugin', () => {
    assert.equal(encurtaNomeMcp('mcp__plugin_telegram_telegram__reply'), 'telegram/reply');
    assert.equal(
      encurtaNomeMcp('mcp__supabase_geral__execute_sql'),
      'supabase_geral/execute_sql',
    );
    assert.equal(encurtaNomeMcp('mcp__shadcn__get_project_registries'), 'shadcn/get_project_registries');
  });
});

describe('alvo', () => {
  it('preserva o nome do arquivo inteiro e come o diretório', () => {
    const longo = '/home/clawd/repos/grupo_borges/apps/cockpit/components/renderers/gramatica.ts';
    const curto = encurtaCaminho(longo);
    assert.ok(curto.endsWith('gramatica.ts'), curto);
    assert.ok(curto.startsWith('…/'), curto);
    assert.ok(curto.length <= 44, `${curto} (${curto.length})`);
  });

  it('não mexe em caminho que já cabe', () => {
    assert.equal(encurtaCaminho('apps/cockpit/app/page.tsx'), 'apps/cockpit/app/page.tsx');
  });

  it('nome de arquivo maior que o teto continua inteiro — cortar o nome é perder a identidade', () => {
    const nome = `${'z'.repeat(60)}.tsx`;
    assert.ok(encurtaCaminho(`/a/b/${nome}`).endsWith(nome));
  });

  it('URL perde esquema e www, que são iguais em todas', () => {
    assert.equal(
      leExecucao({ toolName: 'WebFetch', args: { url: 'https://www.react.dev/reference/react/' } })
        .alvo,
      'react.dev/reference/react',
    );
  });

  it('comando multilinha vira uma linha só — a íntegra é da expansão', () => {
    const e = leExecucao({ toolName: 'Bash', args: { command: 'cd /tmp \\\n  && ls -la' } });
    assert.equal(e.alvo, 'cd /tmp \\');
  });

  it('args parcial do streaming não quebra: linha nasce sem alvo e vive', () => {
    assert.equal(leExecucao({ toolName: 'Bash' }).alvo, '');
    assert.equal(leExecucao({ toolName: 'Bash', args: 'ainda-nao-e-json' }).alvo, '');
  });
});

describe('rendimento — o que substituiu a duração ausente', () => {
  it('conta as linhas do resultado', () => {
    const e = leExecucao({ toolName: 'Bash', args: { command: 'ls' }, result: 'a\nb\nc\n' });
    assert.deepEqual(e.rendimento, { texto: '3' });
  });

  it('a palavra sai: sete linhas terminando em "linhas" viram coluna de ruído', () => {
    assert.equal(
      leExecucao({ toolName: 'Bash', args: {}, result: 'só isso' }).rendimento?.texto,
      '1',
    );
  });

  it('resultado vazio não vira palavra: a ausência já é a informação', () => {
    assert.equal(leExecucao({ toolName: 'Bash', args: {}, result: '' }).rendimento, null);
    assert.equal(leExecucao({ toolName: 'Bash', args: {}, result: '\n\n' }).rendimento, null);
  });

  it('Edit sai com o saldo exato, e o sinal é U+2212', () => {
    const e = leExecucao({
      toolName: 'Edit',
      args: { file_path: '/a/b.ts', old_string: 'um\ndois\n', new_string: 'um\ndois\ntres\n' },
    });
    assert.deepEqual(e.rendimento, { texto: '+1 −0' });
    assert.ok(e.rendimento!.texto.includes('−'));
  });

  it('Edit gigante não roda LCS — informa tamanho em vez de fingir precisão', () => {
    const grande = 'linha\n'.repeat(3_000);
    const e = leExecucao({
      toolName: 'Edit',
      args: { file_path: '/a/b.ts', old_string: grande, new_string: grande },
    });
assert.equal(e.rendimento?.texto, '3000 trocadas');
  });

  it('Write conta o que escreveu, não o que o resultado ecoou', () => {
    const e = leExecucao({
      toolName: 'Write',
      args: { file_path: '/a/b.ts', content: 'um\ndois\n' },
      result: 'File created successfully',
    });
    assert.deepEqual(e.rendimento, { texto: '+2' });
  });

  it('resultado em partes de texto (MCP) é lido igual', () => {
    const e = leExecucao({
      toolName: 'mcp__supabase_geral__execute_sql',
      args: { query: 'select 1' },
      result: [{ type: 'text', text: 'a\nb' }],
    });
    assert.equal(e.rendimento?.texto, '2');
  });
});

describe('desfecho', () => {
  it('falha vira palavra, não só cor — §3 proíbe cor como portadora única', () => {
    const e = leExecucao({ toolName: 'Bash', args: {}, result: 'stack trace', isError: true });
    assert.equal(e.desfecho, 'falhou');
    assert.equal(e.rendimento?.texto, 'erro');
  });

  it('rodando não mostra rendimento: contar o que ainda chega seria mentira', () => {
    const e = leExecucao({ toolName: 'Bash', args: {}, result: 'parcial', estado: 'running' });
    assert.equal(e.desfecho, 'rodando');
    assert.equal(e.rendimento, null);
  });

  it('esperar humano vence tudo — é o único estado que chama o Rica', () => {
    const e = leExecucao({ toolName: 'Bash', args: {}, estado: 'requires-action' });
    assert.equal(e.desfecho, 'aguarda');
  });

  it('sem estado nenhum é concluído', () => {
    assert.equal(leExecucao({ toolName: 'Read', args: {} }).desfecho, 'feito');
  });
});

describe('intenção', () => {
  it('só o Bash escreve, e ela não some — vai para a expansão', () => {
    const e = leExecucao({
      toolName: 'Bash',
      args: { command: 'ls -la', description: 'Lista docs em andamento e de UI' },
    });
    assert.equal(e.intencao, 'Lista docs em andamento e de UI');
    assert.equal(e.alvo, 'ls -la', 'a linha mostra o comando, não a frase');
  });

  it('description de outra ferramenta não vira intenção — lá ela é o alvo', () => {
    const e = leExecucao({ toolName: 'Agent', args: { description: 'Audita renderers' } });
    assert.equal(e.intencao, null);
    assert.equal(e.alvo, 'Audita renderers');
  });
});
