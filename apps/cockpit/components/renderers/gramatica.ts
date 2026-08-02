/**
 * A gramática da execução — o modelo. Sem React, sem DOM, testável inteiro.
 *
 * Contrato: `docs/cockpit-v2-estetica.md` §7. Dono: Daniel (pele).
 *
 * ---------------------------------------------------------------------------
 * 02/08 — A LINHA VIROU FRASE, e os sigilos morreram
 *
 * Até 30/07 a coluna da esquerda carregava um caractere de shell (`$ ? @ < > &
 * ~`) no lugar do nome da ferramenta: 7 formas em vez de 23 ícones, largura
 * idêntica pela mono. A tese estava certa — a informação à esquerda é o VERBO,
 * não a marca — mas a resposta ainda era terminal. Ordem do Rica em 02/08, com
 * print do app do Claude no iOS: "o texto tem que se parecer mais com esses
 * chats", a atividade é "uma linha cinza, em português natural, sem caixa, sem
 * fonte monoespacada" — `Executou 6 comandos, leu um arquivo…  +64 −0  >`.
 *
 * O verbo continua na esquerda — agora por extenso e em português: `Executou
 * npx tsc --noEmit`, `Leu …/gramatica.ts`, `Editou …/feed.tsx`. A frase É o
 * resumo; o que ela não diz (o nome exato da ferramenta, o comando inteiro, a
 * saída) está a um toque, na expansão — onde a mono é permitida de novo (§7.1:
 * mono só dentro de código e saída expandida, nunca em texto corrido).
 *
 * O RENDIMENTO à direita não mudou de ideia (duração não existe neste caminho,
 * ver nota histórica abaixo) — mas agora chega ESTRUTURADO: `+N −M` com os
 * números separados, porque a linha colore o par (verde/coral, §tokens
 * --ck-diff-add/--ck-diff-del) e somar cores a um texto pronto exigiria parse
 * do próprio formato. O `texto` continua sendo o que se mostra quando não há
 * diff — contagem de linhas, `erro`.
 *
 * ---------------------------------------------------------------------------
 * NOTA HISTÓRICA — por que rendimento e não duração
 *
 * A §7 pedia "duração à direita em tabular-nums". Ela não chega aqui:
 * `buildToolResultLookup` (render-items.ts) entrega `{ content, isError }` e
 * mais nada, e mesmo no cru o `durationMs` só existe em 412 dos 1.499
 * resultados (WebFetch, WebSearch, Agent) — Bash, Read, Write e Edit não têm
 * nenhum. `structuredPatch` também não chega, mas `Edit` traz
 * `old_string`/`new_string` nos próprios argumentos, então o diff sai exato
 * daqui, com o `calculateDiff` que já existe ao lado.
 */
// Extensão explícita porque este módulo é lido pelo `node --test` direto (o
// resolvedor ESM do Node não completa extensão). `allowImportingTsExtensions`
// no tsconfig cobre o tsc, e o bundler resolve caminho explícito sem reclamar.
import { calculateDiff, summarizeDiff } from './diff-lines.ts';

export type Desfecho = 'feito' | 'rodando' | 'aguarda' | 'falhou';

/**
 * O que se mostra à direita.
 *
 * SEM A PALAVRA "linhas", e isso saiu do primeiro print: sete linhas seguidas
 * terminando em `linhas` viram uma coluna de ruído. O número sozinho, alinhado
 * à direita em tabular-nums, já se lê como tamanho. Onde a unidade muda o
 * sentido (`+2 −1`, `erro`), ela fica.
 *
 * `adicoes`/`remocoes` vêm preenchidos quando o texto é um saldo de diff — a
 * linha e o grupo colorem o par (+ em --ck-diff-add, − em --ck-diff-del) e o
 * grupo SOMA os números dos membros; os dois trabalhos são impossíveis sobre
 * o texto pronto. U+2212 (−), não hífen, pelo mesmo motivo de sempre: é o que
 * alinha o par em tabular-nums.
 */
export type Rendimento = {
  texto: string;
  adicoes?: number;
  remocoes?: number;
};

export type Execucao = {
  /** O verbo da frase, no tempo do desfecho: `Executou` quando feito,
   *  `Executando` enquanto roda. Em português desde 02/08 (ver cabeçalho). */
  verbo: string;
  /** A coisa concreta: o comando, o caminho, a URL, a pergunta. Quando o
   *  streaming ainda não trouxe argumento, carrega o nome da ferramenta —
   *  linha muda é o modo de falha proibido. */
  alvo: string;
  /** Nome completo da ferramenta — a frase não o diz, a expansão mostra. */
  nome: string;
  /** Frase em linguagem natural que o agente escreveu junto (só o Bash tem). */
  intencao: string | null;
  rendimento: Rendimento | null;
  desfecho: Desfecho;
};

export type EntradaExecucao = {
  toolName: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  /** `status.type` da lib. Ausente = tratar como concluído. */
  estado?: 'running' | 'complete' | 'incomplete' | 'requires-action';
};

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
const usos: Verbo = {
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

/* -------------------------------------------------------------------------- */
/* Alvo                                                                       */
/* -------------------------------------------------------------------------- */

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

/** Primeira linha, espaços colapsados. Comando multilinha vira uma linha só —
 *  a íntegra fica na expansão, e é lá que ela é legível. */
function umaLinha(valor: string): string {
  const primeira = valor.split('\n').find((l) => l.trim()) ?? '';
  return primeira.replace(/\s+/g, ' ').trim();
}

/**
 * Trunca o DIRETÓRIO e preserva o nome do arquivo inteiro (§7 do contrato).
 * O nome é o que identifica; o caminho até ele é contexto que a expansão dá.
 */
export function encurtaCaminho(caminho: string, maximo = 44): string {
  if (caminho.length <= maximo) return caminho;
  const partes = caminho.split('/').filter(Boolean);
  const arquivo = partes.pop() ?? caminho;

  let saida = arquivo;
  for (let i = partes.length - 1; i >= 0; i -= 1) {
    const proxima = `${partes[i]}/${saida}`;
    if (proxima.length + 2 > maximo) break;
    saida = proxima;
  }
  return `…/${saida}`;
}

/** Host + caminho, sem o esquema e sem o `www.` — os dois são sempre iguais. */
function encurtaUrl(url: string): string {
  const semEsquema = url.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '');
  return semEsquema.replace(/\/$/, '');
}

function alvoDe(toolName: string, args: Record<string, unknown>): string {
  const caminho = texto(args.file_path) ?? texto(args.notebook_path);
  if (caminho) return encurtaCaminho(caminho);

  const url = texto(args.url);
  if (url) return encurtaUrl(url);

  const direto =
    texto(args.command) ??
    texto(args.query) ??
    texto(args.pattern) ??
    texto(args.skill) ??
    texto(args.description) ??
    texto(args.recipient) ??
    texto(args.to) ??
    texto(args.text) ??
    texto(args.prompt) ??
    texto(args.method) ??
    texto(args.task_id);
  if (direto) return umaLinha(direto);

  // Ferramenta sem argumento nomeado que sirva de alvo (TaskList, listagens de
  // MCP): o primeiro valor de texto é melhor do que linha muda. Nada disso
  // acontecendo, a linha fica só com sigilo e rótulo — que já é uma frase.
  for (const valor of Object.values(args)) {
    const t = texto(valor);
    if (t) return umaLinha(t);
  }
  return '';
}

/* -------------------------------------------------------------------------- */
/* Rendimento                                                                 */
/* -------------------------------------------------------------------------- */

function contaLinhas(valor: string): number {
  if (!valor) return 0;
  const semFimVazio = valor.replace(/\n+$/, '');
  return semFimVazio ? semFimVazio.split('\n').length : 0;
}

/**
 * Teto para o diff exato. LCS é O(n·m): dois blocos de 3.000 linhas seriam
 * 9 milhões de células por linha VISÍVEL do feed. Acima do teto a linha
 * colapsada informa o tamanho do bloco em vez do saldo — que é honesto e não
 * finge precisão que não calculou.
 */
const TETO_DIFF_CHARS = 20_000;

function rendimentoDeEdicao(args: Record<string, unknown>): Rendimento | null {
  const antes = typeof args.old_string === 'string' ? args.old_string : null;
  const depois = typeof args.new_string === 'string' ? args.new_string : null;
  if (antes === null || depois === null) return null;

  if (antes.length + depois.length > TETO_DIFF_CHARS) {
    return { texto: `${contaLinhas(depois)} trocadas` };
  }
  const { additions, removals } = summarizeDiff(calculateDiff(antes, depois));
  return { texto: `+${additions} −${removals}`, adicoes: additions, remocoes: removals };
}

function corpoDoResultado(result: unknown): string {
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    return result
      .map((p) =>
        p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string'
          ? (p as { text: string }).text
          : '',
      )
      .join('\n');
  }
  return '';
}

function rendimentoDe(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  falhou: boolean,
): Rendimento | null {
  // Falha não conta volume: o que importa é que falhou, e a palavra é o que
  // cumpre "cor nunca é portadora única" (§3).
  if (falhou) return { texto: 'erro' };

  if (toolName === 'Edit' || toolName === 'NotebookEdit') return rendimentoDeEdicao(args);

  if (toolName === 'Write') {
    const conteudo = typeof args.content === 'string' ? args.content : null;
    if (conteudo === null) return null;
    const n = contaLinhas(conteudo);
    return n ? { texto: `+${n}`, adicoes: n } : null;
  }

  const n = contaLinhas(corpoDoResultado(result));
  // Zero linha não vira "sem saída": a ausência já é a informação, e uma palavra
  // ali só ensinaria o olho a parar onde não há nada.
  return n ? { texto: String(n) } : null;
}

/* -------------------------------------------------------------------------- */
/* Montagem                                                                   */
/* -------------------------------------------------------------------------- */

function desfechoDe(entrada: EntradaExecucao): Desfecho {
  if (entrada.estado === 'requires-action') return 'aguarda';
  if (entrada.isError) return 'falhou';
  if (entrada.estado === 'running') return 'rodando';
  return 'feito';
}

export function leExecucao(entrada: EntradaExecucao): Execucao {
  const args =
    entrada.args && typeof entrada.args === 'object' && !Array.isArray(entrada.args)
      ? (entrada.args as Record<string, unknown>)
      : {};
  const verbo = verboDe(entrada.toolName);
  const nome = entrada.toolName.startsWith('mcp__')
    ? encurtaNomeMcp(entrada.toolName)
    : entrada.toolName;
  const desfecho = desfechoDe(entrada);

  const alvo = alvoDe(entrada.toolName, args);
  // Sem argumento (streaming parcial, ferramenta sem alvo nomeado), o nome vai
  // no lugar e o verbo cai no genérico: "Leu Read" é torto, "Usou TaskList"
  // informa. Linha muda continua sendo o modo de falha proibido.
  const temAlvo = alvo.length > 0;

  return {
    verbo:
      desfecho === 'rodando'
        ? temAlvo ? verbo.gerundio : usos.gerundio
        : temAlvo ? verbo.passado : usos.passado,
    alvo: temAlvo ? alvo : nome,
    nome,
    // Só o Bash escreve isto, e são 738 frases em português que hoje o painel
    // joga fora. Não cabe na linha sem dobrar a altura — vai para a expansão.
    intencao: entrada.toolName === 'Bash' ? texto(args.description) : null,
    rendimento:
      desfecho === 'rodando'
        ? null
        : rendimentoDe(entrada.toolName, args, entrada.result, desfecho === 'falhou'),
    desfecho,
  };
}

/** O corpo integral do resultado, para a expansão. Exportado porque a linha e o
 *  bloco precisam da MESMA leitura — duas versões divergiriam em silêncio. */
export function corpoDe(result: unknown): string {
  return corpoDoResultado(result);
}
