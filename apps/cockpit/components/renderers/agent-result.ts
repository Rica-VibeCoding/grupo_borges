// Lógica do `agent-result.tsx` — normaliza as duas famílias G7 de resultado de
// subagente para uma união discriminada. Mora fora do `.tsx` de propósito: a
// suíte roda `node --test` sem transpilação de JSX, então o que precisa de
// prova não pode morar dentro de componente.
//
// O componente recebe o `tool_use_result` CRU por props. Cada variante exige
// as chaves observadas no fixture real para não capturar outra família por
// engano.

export type ContentPartDoAgente = {
  type: string;
  text?: string;
};

export type ToolStatsDoAgente = {
  readCount: number;
  searchCount: number;
  bashCount: number;
  editFileCount: number;
  linesAdded: number;
  linesRemoved: number;
  otherToolCount: number;
};

type AgentResultBase = {
  agentId: string;
  status: string;
  resolvedModel: string;
};

export type AgentResultAssincrono = AgentResultBase & {
  variante: 'assincrono';
  isAsync: true;
  outputFile: string;
  canReadOutputFile: boolean;
  description: string;
};

export type AgentResultConcluido = AgentResultBase & {
  variante: 'concluido';
  content: ContentPartDoAgente[];
  totalDurationMs: number;
  totalTokens: number;
  totalToolUseCount: number;
  toolStats: ToolStatsDoAgente;
  agentType: string;
  prompt: string;
};

export type AgentResultNormalizado = AgentResultAssincrono | AgentResultConcluido;

export function classeDeCorDoStatus(status: string): string {
  const statusNormalizado = status.trim().toLowerCase();

  if (
    statusNormalizado === 'completed' ||
    statusNormalizado.startsWith('completed_')
  ) {
    return 'text-[var(--ck-state-ok)]';
  }

  if (
    ['failed', 'error', 'interrupted'].some(
      (prefixo) =>
        statusNormalizado === prefixo || statusNormalizado.startsWith(`${prefixo}_`),
    )
  ) {
    return 'text-[var(--ck-state-fail)]';
  }

  return 'text-[var(--ck-text-secondary)]';
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function ehStringPreenchida(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length > 0;
}

function normalizarContent(valor: unknown): ContentPartDoAgente[] | null {
  if (!Array.isArray(valor)) return null;

  const partes: ContentPartDoAgente[] = [];
  for (const parte of valor) {
    if (!ehObjeto(parte) || !ehStringPreenchida(parte.type)) return null;
    if (parte.text !== undefined && typeof parte.text !== 'string') return null;
    partes.push({
      type: parte.type,
      ...(typeof parte.text === 'string' ? { text: parte.text } : {}),
    });
  }
  return partes;
}

function normalizarToolStats(valor: unknown): ToolStatsDoAgente | null {
  if (!ehObjeto(valor)) return null;
  const chaves = [
    'readCount',
    'searchCount',
    'bashCount',
    'editFileCount',
    'linesAdded',
    'linesRemoved',
    'otherToolCount',
  ] as const;

  if (chaves.some((chave) => typeof valor[chave] !== 'number')) return null;

  return {
    readCount: valor.readCount as number,
    searchCount: valor.searchCount as number,
    bashCount: valor.bashCount as number,
    editFileCount: valor.editFileCount as number,
    linesAdded: valor.linesAdded as number,
    linesRemoved: valor.linesRemoved as number,
    otherToolCount: valor.otherToolCount as number,
  };
}

/** Aceita o `tool_use_result` cru das duas famílias G7. Devolve null quando
 * não é resultado de subagente, para o chamador cair no corpo genérico. */
export function normalizarAgentResult(valor: unknown): AgentResultNormalizado | null {
  if (!ehObjeto(valor)) return null;
  if (
    !ehStringPreenchida(valor.agentId) ||
    !ehStringPreenchida(valor.status) ||
    !ehStringPreenchida(valor.resolvedModel)
  ) {
    return null;
  }

  if (
    valor.isAsync === true &&
    ehStringPreenchida(valor.outputFile) &&
    typeof valor.canReadOutputFile === 'boolean' &&
    ehStringPreenchida(valor.description)
  ) {
    return {
      variante: 'assincrono',
      agentId: valor.agentId,
      status: valor.status,
      resolvedModel: valor.resolvedModel,
      isAsync: true,
      outputFile: valor.outputFile,
      canReadOutputFile: valor.canReadOutputFile,
      description: valor.description,
    };
  }

  const content = normalizarContent(valor.content);
  const toolStats = normalizarToolStats(valor.toolStats);
  if (
    content &&
    toolStats &&
    ehStringPreenchida(valor.agentType) &&
    typeof valor.prompt === 'string' &&
    typeof valor.totalDurationMs === 'number' &&
    typeof valor.totalTokens === 'number' &&
    typeof valor.totalToolUseCount === 'number'
  ) {
    return {
      variante: 'concluido',
      agentId: valor.agentId,
      status: valor.status,
      resolvedModel: valor.resolvedModel,
      content,
      totalDurationMs: valor.totalDurationMs,
      totalTokens: valor.totalTokens,
      totalToolUseCount: valor.totalToolUseCount,
      toolStats,
      agentType: valor.agentType,
      prompt: valor.prompt,
    };
  }

  return null;
}
