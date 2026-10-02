/**
 * O vocabulário da gramática — o verbo de cada ferramenta, em português, e o
 * nome curto do MCP. Saiu de `gramatica.ts` (02/10) para o arquivo caber no
 * teto de 300 linhas; quem importa continua importando de lá, que reexporta.
 */

/* -------------------------------------------------------------------------- */
/* Vocabulário                                                                */
/* -------------------------------------------------------------------------- */

/**
 * O verbo de cada ferramenta, em português. `passado` fecha a linha concluída,
 * `gerundio` é a linha em voo — o tempo verbal É o estado, e é o que permite
 * a linha ficar cinza quieta quando termina (sucesso é silêncio) sem perder o
 * sinal de "ainda trabalhando".
 *
 * `unidade` é o substantivo contável para o RESUMO DO GRUPO
 * (grupo-ferramentas.ts): "Executou 6 comandos, leu um arquivo". Singular
 * com artigo ("um arquivo"), plural com número ("6 comandos") — a frase
 * agregada não sabe montar isso sozinha sem uma tabela.
 */
export type Verbo = {
  passado: string;
  gerundio: string;
  unidade: (n: number) => string;
};

const comandos: Verbo = {
  passado: 'Executou',
  gerundio: 'Executando',
  unidade: (n) => (n === 1 ? 'um comando' : `${n} comandos`),
};
const leituras: Verbo = {
  passado: 'Leu',
  gerundio: 'Lendo',
  unidade: (n) => (n === 1 ? 'um arquivo' : `${n} arquivos`),
};
const criacoes: Verbo = {
  passado: 'Criou',
  gerundio: 'Criando',
  unidade: (n) => (n === 1 ? 'um arquivo' : `${n} arquivos`),
};
const edicoes: Verbo = {
  passado: 'Editou',
  gerundio: 'Editando',
  unidade: (n) => (n === 1 ? 'um arquivo' : `${n} arquivos`),
};
const buscas: Verbo = {
  passado: 'Procurou',
  gerundio: 'Procurando',
  unidade: (n) => (n === 1 ? 'uma busca' : `${n} buscas`),
};
const delegacoes: Verbo = {
  passado: 'Delegou',
  gerundio: 'Delegando',
  unidade: (n) => (n === 1 ? 'uma tarefa' : `${n} tarefas`),
};
/** MCP e desconhecida: o nome curto da ferramenta vai no lugar do alvo quando
 *  falta argumento, então o verbo genérico é o que nunca produz frase torta. */
export const usos: Verbo = {
  passado: 'Usou',
  gerundio: 'Usando',
  unidade: (n) => (n === 1 ? 'uma ferramenta' : `${n} ferramentas`),
};

const VERBOS: Record<string, Verbo> = {
  Bash: comandos,
  BashOutput: comandos,
  KillShell: comandos,

  Read: leituras,
  NotebookRead: leituras,

  Write: criacoes,

  Edit: edicoes,
  NotebookEdit: edicoes,

  Grep: buscas,
  Glob: buscas,
  ToolSearch: buscas,

  WebSearch: {
    passado: 'Pesquisou',
    gerundio: 'Pesquisando',
    unidade: (n) => (n === 1 ? 'uma busca' : `${n} buscas`),
  },
  WebFetch: {
    passado: 'Buscou',
    gerundio: 'Buscando',
    unidade: (n) => (n === 1 ? 'uma página' : `${n} páginas`),
  },
  Artifact: {
    passado: 'Publicou',
    gerundio: 'Publicando',
    unidade: (n) => (n === 1 ? 'uma página' : `${n} páginas`),
  },
  SendUserFile: {
    passado: 'Enviou',
    gerundio: 'Enviando',
    unidade: (n) => (n === 1 ? 'um arquivo' : `${n} arquivos`),
  },

  // A pergunta ao Rica. Em voo ela não fala no gerúndio: é `aguarda`, com
  // frase própria em `leExecucao` — quem tem a vez é ele, não o agente.
  AskUserQuestion: {
    passado: 'Perguntou',
    gerundio: 'Perguntando',
    unidade: (n) => (n === 1 ? 'uma vez' : `${n} vezes`),
  },

  Agent: delegacoes,
  Task: delegacoes,
  SendMessage: delegacoes,
  TaskCreate: delegacoes,
  TaskList: delegacoes,
  TaskStop: delegacoes,
  TaskUpdate: delegacoes,
  Workflow: delegacoes,

  Skill: {
    passado: 'Carregou',
    gerundio: 'Carregando',
    unidade: (n) => (n === 1 ? 'uma skill' : `${n} skills`),
  },
  DesignSync: {
    passado: 'Sincronizou',
    gerundio: 'Sincronizando',
    unidade: (n) => (n === 1 ? 'uma vez' : `${n} vezes`),
  },
};

/** Pedaço de nome de MCP que só diz "isto é um MCP" — não diz QUAL. */
const RUIDO_MCP = /^(mcp|plugin)$/;

/**
 * `mcp__plugin_telegram_telegram__reply` → `telegram/reply`.
 *
 * Os prefixos de transporte não informam nada (todo MCP tem), e a repetição do
 * nome do servidor é artefato de como o plugin se registra. O que sobra é
 * servidor + método, que é o que distingue `supabase_geral/execute_sql` de um
 * `execute_sql` que poderia estar batendo em qualquer banco.
 */
export function encurtaNomeMcp(nome: string): string {
  const partes = nome
    .split('__')
    .map((p) => p.replace(/^(mcp|plugin)_/, ''))
    .filter((p) => p && !RUIDO_MCP.test(p));
  if (partes.length === 0) return nome;

  const servidor = partes[0]
    .split('_')
    .filter((palavra, i, todas) => palavra !== todas[i - 1])
    .join('_');
  const metodo = partes[partes.length - 1];
  return servidor === metodo ? metodo : `${servidor}/${metodo}`;
}

/**
 * O verbo da ferramenta. MCP não entra na tabela: ele é aberto por natureza e
 * a lista envelheceria a cada servidor novo — o método diz a ação melhor do
 * que o servidor, e o genérico "Usou" nunca produz frase torta.
 */
export function verboDe(toolName: string): Verbo {
  return VERBOS[toolName] ?? usos;
}
