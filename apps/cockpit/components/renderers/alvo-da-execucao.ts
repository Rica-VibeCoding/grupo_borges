/**
 * O alvo da execução — a coisa concreta que a frase nomeia: o comando, o
 * caminho, a URL, a pergunta. Saiu de `gramatica.ts` (02/10) para o arquivo
 * caber no teto de 300 linhas; `encurtaCaminho` continua saindo de lá, reexportado.
 */

import { ehIdentificadorOpaco } from './identificador-opaco.ts';

/* -------------------------------------------------------------------------- */
/* Alvo                                                                       */
/* -------------------------------------------------------------------------- */

export function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

/** Primeira linha, espaços colapsados. Comando multilinha vira uma linha só —
 *  a íntegra fica na expansão, e é lá que ela é legível. */
export function umaLinha(valor: string): string {
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

/** A primeira pergunta do `AskUserQuestion` e do `ask_user` (`questions[0].question`). */
function perguntaDe(args: Record<string, unknown>): string | null {
  const perguntas = args.questions;
  if (!Array.isArray(perguntas)) return null;
  const primeira: unknown = perguntas[0];
  if (!primeira || typeof primeira !== 'object') return null;
  return texto((primeira as Record<string, unknown>).question);
}

export function alvoDe(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'AskUserQuestion' || toolName === 'mcp__ask-user__ask_user') {
    const pergunta = perguntaDe(args);
    if (pergunta) return umaLinha(pergunta);
  }

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
  if (direto && !ehIdentificadorOpaco(direto)) return umaLinha(direto);

  // Ferramenta sem argumento nomeado que sirva de alvo (TaskList, listagens de
  // MCP): o primeiro valor de texto é melhor do que linha muda. Nada disso
  // acontecendo, a linha fica só com sigilo e rótulo — que já é uma frase.
  // Identificador cru (`file_id`, UUID, token) é pulado: nunca vira alvo.
  for (const valor of Object.values(args)) {
    const t = texto(valor);
    if (t && !ehIdentificadorOpaco(t)) return umaLinha(t);
  }
  return '';
}
