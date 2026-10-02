import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INTERROMPIDO } from '../feed/orfas-do-turno.ts';
import { encurtaCaminho, encurtaNomeMcp, leExecucao } from './gramatica.ts';

describe('gramática da execução — o verbo, em português desde 02/08', () => {
  it('Bash executa — e o verbo carrega o estado pelo tempo verbal', () => {
    const e = leExecucao({ toolName: 'Bash', args: { command: 'git status --short' } });
    assert.equal(e.verbo, 'Executou');
    assert.equal(e.alvo, 'git status --short');
    assert.equal(
      leExecucao({ toolName: 'Bash', args: { command: 'ls' }, estado: 'running' }).verbo,
      'Executando',
    );
  });

  it('Write cria, Edit edita — o verbo distingue o que o sigilo > não distinguia', () => {
    assert.equal(leExecucao({ toolName: 'Write', args: { file_path: '/a.ts' } }).verbo, 'Criou');
    assert.equal(leExecucao({ toolName: 'Edit', args: { file_path: '/a.ts' } }).verbo, 'Editou');
    assert.equal(leExecucao({ toolName: 'Read', args: { file_path: '/a.ts' } }).verbo, 'Leu');
  });

  it('MCP fora da tabela cai no genérico que nunca produz frase torta', () => {
    assert.equal(leExecucao({ toolName: 'mcp__supabase_geral__execute_sql' }).verbo, 'Usou');
  });

  it('sem argumento o nome vai no lugar do alvo — linha muda é o modo de falha proibido', () => {
    const e = leExecucao({ toolName: 'FerramentaQueAindaNaoExiste', args: { alvo: 'x' } });
    assert.equal(e.verbo, 'Usou');
    assert.equal(e.alvo, 'x');
    // Args parcial do streaming: "Leu Read" é torto, o genérico informa.
    const parcial = leExecucao({ toolName: 'Read' });
    assert.equal(parcial.verbo, 'Usou');
    assert.equal(parcial.alvo, 'Read');
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

  it('args parcial do streaming não quebra: a linha nasce com o nome no lugar do alvo', () => {
    assert.equal(leExecucao({ toolName: 'Bash' }).alvo, 'Bash');
    assert.equal(leExecucao({ toolName: 'Bash', args: 'ainda-nao-e-json' }).alvo, 'Bash');
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

  it('Edit sai com o saldo exato, estruturado para a linha colorir — e o sinal é U+2212', () => {
    const e = leExecucao({
      toolName: 'Edit',
      args: { file_path: '/a/b.ts', old_string: 'um\ndois\n', new_string: 'um\ndois\ntres\n' },
    });
    assert.deepEqual(e.rendimento, { texto: '+1 −0', adicoes: 1, remocoes: 0 });
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
    assert.deepEqual(e.rendimento, { texto: '+2', adicoes: 2 });
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

  it('órfã encerrada pelo fim do turno diz "interrompido", não "erro" — a marca de orfas-do-turno', () => {
    const e = leExecucao({ toolName: 'Bash', args: {}, result: INTERROMPIDO, isError: true });
    assert.equal(e.desfecho, 'falhou');
    assert.equal(e.rendimento?.texto, 'interrompido');
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
  it('só o Bash escreve, e é ela que vai na linha — o comando fica no alvo, pra expansão', () => {
    const e = leExecucao({
      toolName: 'Bash',
      args: { command: 'ls -la', description: 'Lista docs em andamento e de UI' },
    });
    assert.equal(e.intencao, 'Lista docs em andamento e de UI');
    assert.equal(e.alvo, 'ls -la');
    assert.equal(e.frase, 'Lista docs em andamento e de UI', 'a linha mostra a frase, não o comando');
  });

  it('Bash sem description mantém verbo e comando na linha', () => {
    const e = leExecucao({ toolName: 'Bash', args: { command: 'ls -la' }, estado: 'running' });
    assert.equal(e.frase, 'Executando ls -la');
  });

  it('description de outra ferramenta não vira intenção — lá ela é o alvo', () => {
    const e = leExecucao({ toolName: 'Agent', args: { description: 'Audita renderers' } });
    assert.equal(e.intencao, null);
    assert.equal(e.alvo, 'Audita renderers');
  });
});

describe('pergunta ao Rica (02/10)', () => {
  const args = { questions: [{ question: 'Qual cor do botão?', header: 'Cor', options: [] }] };

  it('esperando, a linha diz que a vez é dele e mostra a pergunta', () => {
    const e = leExecucao({ toolName: 'AskUserQuestion', args, estado: 'requires-action' });
    assert.equal(e.desfecho, 'aguarda');
    assert.equal(e.frase, 'Aguardando você: Qual cor do botão?');
  });

  it('respondida, vira passado com a pergunta — não "Usou AskUserQuestion"', () => {
    const e = leExecucao({ toolName: 'AskUserQuestion', args, result: 'Azul', estado: 'complete' });
    assert.equal(e.frase, 'Perguntou Qual cor do botão?');
  });

  it('sem argumento ainda (streaming), a espera mostra o nome — linha muda nunca', () => {
    const e = leExecucao({ toolName: 'AskUserQuestion', args: {}, estado: 'requires-action' });
    assert.equal(e.frase, 'Aguardando você: AskUserQuestion');
  });

  it('o ask_user do MCP é a mesma pergunta: "Perguntou <pergunta>"', () => {
    const e = leExecucao({ toolName: 'mcp__ask-user__ask_user', args, result: 'Azul' });
    assert.equal(e.frase, 'Perguntou Qual cor do botão?');
  });
});

describe('Context7 — o verbo sai do método, com qualquer prefixo', () => {
  const nomes = ['mcp__plugin_context7_context7', 'mcp__context7', 'mcp__context7_global'];

  it('resolve-library-id localiza a biblioteca pelo nome', () => {
    for (const prefixo of nomes) {
      const e = leExecucao({
        toolName: `${prefixo}__resolve-library-id`,
        args: { libraryName: 'Supabase', query: 'RLS performance' },
        result: 'ok',
      });
      assert.equal(e.frase, 'Localizou Supabase');
    }
  });

  it('query-docs consulta a documentação — nunca "Usou" nem o libraryId cru', () => {
    for (const prefixo of nomes) {
      const e = leExecucao({
        toolName: `${prefixo}__query-docs`,
        args: { libraryId: '/supabase/supabase', query: 'RLS' },
        result: 'ok',
      });
      assert.equal(e.frase, 'Consultou a documentação');
    }
    assert.equal(
      leExecucao({ toolName: 'mcp__context7__query-docs', args: {}, estado: 'running' }).frase,
      'Consultando a documentação',
    );
  });
});
