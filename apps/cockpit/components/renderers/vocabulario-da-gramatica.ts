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
  /** Complemento fixo da frase quando falta alvo útil (`Baixou o anexo`).
   *  Quem tem `objeto` ignora os argumentos, salvo o `campo` legível. */
  objeto?: string;
  /** Argumento que serve de alvo (`entity_id`). Sem ele, vale o `objeto`. */
  campo?: string;
};

/** Verbo de frase pronta: `objeto` no lugar do alvo, `campo` quando houver. */
function frase(
  passado: string,
  gerundio: string,
  objeto: string,
  um: string,
  varios: string,
  campo?: string,
): Verbo {
  return { passado, gerundio, objeto, campo, unidade: (n) => (n === 1 ? um : `${n} ${varios}`) };
}

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
// A pergunta ao Rica. Em voo ela não fala no gerúndio: é `aguarda`, com
// frase própria em `leExecucao` — quem tem a vez é ele, não o agente. O
// `ask_user` do MCP é a mesma pergunta, pelo painel do cockpit.
const perguntas: Verbo = {
  passado: 'Perguntou',
  gerundio: 'Perguntando',
  unidade: (n) => (n === 1 ? 'uma vez' : `${n} vezes`),
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

  AskUserQuestion: perguntas,
  'mcp__ask-user__ask_user': perguntas,

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

  // As que caíam em "Usou <primeiro texto dos args>" — lista medida no corpus
  // (docs/pesquisas/feed-do-turno-2026-10.md, Dedução 2), por volume.
  ListAgents: frase('Listou', 'Listando', 'os agentes', 'uma listagem', 'listagens'),
  ScheduleWakeup: frase('Agendou', 'Agendando', 'a retomada', 'um agendamento', 'agendamentos'),
  Monitor: frase('Vigiou', 'Vigiando', 'um processo', 'um processo', 'processos', 'description'),
  ExitPlanMode: frase('Apresentou', 'Apresentando', 'o plano', 'um plano', 'planos'),
  EnterPlanMode: frase('Entrou', 'Entrando', 'no modo plano', 'uma vez', 'vezes'),
  ListMcpResourcesTool: frase('Listou', 'Listando', 'os recursos do MCP', 'uma listagem', 'listagens'),
  SendFeedback: frase('Enviou', 'Enviando', 'um retorno', 'um retorno', 'retornos'),

  mcp__plugin_telegram_telegram__download_attachment:
    frase('Baixou', 'Baixando', 'o anexo', 'um anexo', 'anexos'),
  mcp__plugin_telegram_telegram__reply:
    frase('Respondeu', 'Respondendo', 'no Telegram', 'uma mensagem', 'mensagens'),
  mcp__plugin_telegram_telegram__react:
    frase('Reagiu', 'Reagindo', 'no Telegram', 'uma reação', 'reações'),
  mcp__plugin_telegram_telegram__edit_message:
    frase('Editou', 'Editando', 'a mensagem no Telegram', 'uma mensagem', 'mensagens'),
  mcp__plugin_winnow_winnow__winnow_recall:
    frase('Consultou', 'Consultando', 'a memória', 'uma consulta', 'consultas'),
  mcp__supabase_geral__get_advisors:
    frase('Consultou', 'Consultando', 'os alertas do banco', 'uma consulta', 'consultas'),

  'mcp__ha-mcp__ha_get_camera_image':
    frase('Olhou', 'Olhando', 'a câmera', 'uma câmera', 'câmeras', 'entity_id'),
  'mcp__ha-mcp__ha_get_history':
    frase('Consultou', 'Consultando', 'o histórico da casa', 'uma consulta', 'consultas', 'entity_ids'),
  'mcp__ha-mcp__ha_get_logs':
    frase('Leu', 'Lendo', 'os logs da casa', 'um log', 'logs'),
  'mcp__ha-mcp__ha_get_automation_traces':
    frase('Rastreou', 'Rastreando', 'uma automação', 'uma automação', 'automações', 'automation_id'),
  'mcp__ha-mcp__ha_config_get_automation':
    frase('Leu', 'Lendo', 'uma automação', 'uma automação', 'automações', 'identifier'),
  'mcp__ha-mcp__ha_eval_template':
    frase('Calculou', 'Calculando', 'um valor da casa', 'um cálculo', 'cálculos'),
  'mcp__ha-mcp__ha_get_state':
    frase('Consultou', 'Consultando', 'o estado da casa', 'uma consulta', 'consultas', 'entity_id'),
  'mcp__ha-mcp__ha_get_entity':
    frase('Consultou', 'Consultando', 'uma entidade da casa', 'uma consulta', 'consultas', 'entity_id'),
  'mcp__ha-mcp__ha_call_service':
    frase('Acionou', 'Acionando', 'a casa', 'um comando', 'comandos', 'entity_id'),
  'mcp__ha-mcp__ha_config_set_automation':
    frase('Salvou', 'Salvando', 'uma automação', 'uma automação', 'automações', 'identifier'),
};

/**
 * O Context7 se registra com vários prefixos (`mcp__plugin_context7_context7__`,
 * `mcp__context7__`, `mcp__context7_global__`), e o que diz o que ele fez é o
 * método. `get-library-docs` é o nome antigo do `query-docs`.
 */
const CONTEXT7 = /^mcp__(?:plugin_context7_context7|context7\w*)__(.+)$/;
const consultaDocs = frase('Consultou', 'Consultando', 'a documentação', 'uma consulta', 'consultas');
const METODOS_CONTEXT7: Record<string, Verbo> = {
  'resolve-library-id':
    frase('Localizou', 'Localizando', 'a biblioteca', 'uma biblioteca', 'bibliotecas', 'libraryName'),
  'query-docs': consultaDocs,
  'get-library-docs': consultaDocs,
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
 * O verbo da ferramenta. MCP fora da tabela cai no genérico "Usou" + nome
 * curto; desde 02/10 os MCP medidos no buraco do alvo têm frase própria.
 */
export function verboDe(toolName: string): Verbo {
  const doContext7 = CONTEXT7.exec(toolName)?.[1];
  return VERBOS[toolName] ?? (doContext7 ? METODOS_CONTEXT7[doContext7] : undefined) ?? usos;
}
