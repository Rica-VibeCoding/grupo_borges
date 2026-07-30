/**
 * A gramática da execução — o modelo. Sem React, sem DOM, testável inteiro.
 *
 * Contrato: `docs/cockpit-v2-estetica.md` §7. Dono: Daniel (pele).
 *
 * ---------------------------------------------------------------------------
 * A TESE, aplicada no menor lugar possível
 *
 * 82% dos blocos gravados são execução, e o Bash sozinho é 738 de 1.535
 * chamadas — quase metade. Uma linha que começa com a palavra `Bash` repete a
 * mesma informação 738 vezes no lugar mais nobre da tela (a esquerda, onde o
 * olho pousa), enquanto a informação de verdade — QUAL comando — fica à direita
 * disputando espaço com o truncamento.
 *
 * Então a coluna da esquerda não carrega a marca da ferramenta: carrega o VERBO,
 * em um caractere. São 23 ferramentas no baseline e 7 verbos. O olho aprende 7
 * formas numa sessão; nunca aprende 23 ícones.
 *
 * E os 7 caracteres não são inventados — são a sintaxe do shell, que é o
 * vernáculo do próprio assunto:
 *
 *     $  rodar        Bash                                  738
 *     ?  procurar     WebSearch, ToolSearch, SQL, listagens  252
 *     @  atravessar   WebFetch, Telegram, Artifact           300
 *     <  ler          Read                                    83
 *     >  gravar       Write, Edit                              77
 *     &  delegar      Agent, SendMessage, Task*                29
 *     ~  a máquina    Skill, DesignSync, desconhecida          12
 *
 * Todos ASCII: zero risco de tofu quando a Geist Mono não cobrir um glifo, zero
 * bundle de ícone, largura idêntica garantida pela mono — que é o que faz a
 * coluna virar régua em vez de fileira torta.
 *
 * O nome da ferramenta não sumiu: foi COMPRIMIDO de quatro caracteres para um,
 * onde o sigilo é unívoco (`$` só é Bash, `<` só é Read). Onde não é, o nome
 * aparece — e na expansão ele aparece sempre.
 *
 * ---------------------------------------------------------------------------
 * DOIS ACHADOS QUE O CONTRATO NÃO PODIA SABER, e que mudam a §7
 *
 * 1. DURAÇÃO NÃO EXISTE NESTE CAMINHO. A §7 manda "duração à direita em
 *    tabular-nums". Ela não chega aqui: `buildToolResultLookup`
 *    (render-items.ts:9) entrega `{ content, isError }` e mais nada, então o
 *    `durationMs` que o payload cru traz morre antes da ponte. E mesmo no cru
 *    ele só existe em 412 dos 1.499 resultados (WebFetch, WebSearch, Agent) —
 *    Bash, Read, Write e Edit não têm nenhum. Reservar a coluna da direita para
 *    um número ausente em 73% das linhas é criar vazio permanente.
 *
 *    No lugar vai o RENDIMENTO: o que a chamada produziu. É a pergunta que
 *    quem lê um log realmente faz, e ela tem resposta em todas as linhas.
 *
 * 2. `structuredPatch` TAMBÉM NÃO CHEGA — mesma causa. Mas `Edit` traz
 *    `old_string`/`new_string` nos próprios argumentos, então o diff sai exato
 *    daqui mesmo, com o `calculateDiff` que já existe ao lado.
 */
// Extensão explícita porque este módulo é lido pelo `node --test` direto (o
// resolvedor ESM do Node não completa extensão). `allowImportingTsExtensions`
// no tsconfig cobre o tsc, e o bundler resolve caminho explícito sem reclamar.
import { calculateDiff, summarizeDiff } from './diff-lines.ts';

/** Os sete verbos. O caractere É o identificador — não há enum paralelo. */
export type Sigilo = '$' | '?' | '@' | '<' | '>' | '&' | '~';

export type Desfecho = 'feito' | 'rodando' | 'aguarda' | 'falhou';

/**
 * O que se mostra à direita, já formatado.
 *
 * SEM A PALAVRA "linhas", e isso saiu do primeiro print: sete linhas seguidas
 * terminando em `linhas` viram uma coluna de ruído — exatamente o defeito que o
 * sigilo existe para consertar do outro lado da tela. O número sozinho, alinhado
 * à direita em tabular-nums, já se lê como tamanho. Onde a unidade muda o
 * sentido (`+2 −1`, `erro`), ela fica.
 */
export type Rendimento = { texto: string };

export type Execucao = {
  sigilo: Sigilo;
  /** Nome da ferramenta na linha colapsada, ou `null` quando o sigilo basta. */
  rotulo: string | null;
  /** Nome completo, sempre presente — a expansão mostra mesmo quando o rótulo é null. */
  nome: string;
  /** A coisa concreta: o comando, o caminho, a URL, a pergunta. */
  alvo: string;
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
 * `rotulo: false` significa "o sigilo já diz tudo" — é o que apaga a palavra
 * `Bash` de 738 linhas. Só vale onde o sigilo é unívoco no vocabulário inteiro.
 */
const VOCABULARIO: Record<string, { sigilo: Sigilo; rotulo: boolean }> = {
  Bash: { sigilo: '$', rotulo: false },
  BashOutput: { sigilo: '$', rotulo: true },
  KillShell: { sigilo: '$', rotulo: true },

  Read: { sigilo: '<', rotulo: false },
  NotebookRead: { sigilo: '<', rotulo: true },

  Write: { sigilo: '>', rotulo: true },
  Edit: { sigilo: '>', rotulo: true },
  NotebookEdit: { sigilo: '>', rotulo: true },

  Grep: { sigilo: '?', rotulo: true },
  Glob: { sigilo: '?', rotulo: true },
  WebSearch: { sigilo: '?', rotulo: true },
  ToolSearch: { sigilo: '?', rotulo: true },

  WebFetch: { sigilo: '@', rotulo: true },
  Artifact: { sigilo: '@', rotulo: true },
  SendUserFile: { sigilo: '@', rotulo: true },

  Agent: { sigilo: '&', rotulo: true },
  Task: { sigilo: '&', rotulo: true },
  SendMessage: { sigilo: '&', rotulo: true },
  TaskCreate: { sigilo: '&', rotulo: true },
  TaskList: { sigilo: '&', rotulo: true },
  TaskStop: { sigilo: '&', rotulo: true },
  TaskUpdate: { sigilo: '&', rotulo: true },
  Workflow: { sigilo: '&', rotulo: true },

  Skill: { sigilo: '~', rotulo: true },
  DesignSync: { sigilo: '~', rotulo: true },
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

function vocabulo(toolName: string): { sigilo: Sigilo; rotulo: boolean } {
  const conhecido = VOCABULARIO[toolName];
  if (conhecido) return conhecido;

  // MCP não entra na tabela: ele é aberto por natureza e a lista envelheceria a
  // cada servidor novo. O método diz o verbo melhor do que o servidor.
  if (toolName.startsWith('mcp__')) {
    const metodo = toolName.slice(toolName.lastIndexOf('__') + 2);
    if (/^(list|search|get|read|view|describe|execute_sql|query)/.test(metodo)) {
      return { sigilo: '?', rotulo: true };
    }
    return { sigilo: '@', rotulo: true };
  }
  return { sigilo: '~', rotulo: true };
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
  // U+2212 (−), não hífen: o contrato herda isso do Codex e é o que faz o par
  // +/− alinhar em tabular-nums.
  return { texto: `+${additions} −${removals}` };
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
    return n ? { texto: `+${n}` } : null;
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
  const { sigilo, rotulo } = vocabulo(entrada.toolName);
  const nome = entrada.toolName.startsWith('mcp__')
    ? encurtaNomeMcp(entrada.toolName)
    : entrada.toolName;
  const desfecho = desfechoDe(entrada);

  return {
    sigilo,
    rotulo: rotulo ? nome : null,
    nome,
    alvo: alvoDe(entrada.toolName, args),
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
