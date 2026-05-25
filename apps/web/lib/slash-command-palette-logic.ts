// Helpers puros do slash command palette (DS-62). Separados do .tsx pra
// permitir teste via node:test (que strip-types nativo não cobre JSX).
// O componente em components/slash-command-palette.tsx re-exporta tudo
// daqui pra manter API estável.

export type SlashCommand = {
  value: string;
  label: string;
  desc: string;
};

export function getSlashCommands(agentName: string): SlashCommand[] {
  const name = agentName.trim() || 'agente';
  return [
    { value: 'checkpoint', label: '/checkpoint', desc: `${name} salva memória da sessão + gera bloco copiável de retomada` },
    { value: 'compact', label: '/compact', desc: `compacta o contexto de ${name}` },
    { value: 'dispatch', label: '/dispatch', desc: `sub-agentes em paralelo (explore · context7 · backend · frontend · shadcn)` },
    { value: 'encerrar', label: '/encerrar', desc: `faxina de fim de sessão — salva memória, limpa temp, reporta entrega` },
    { value: 'impl-go', label: '/impl-go', desc: `implementação multi-arquivo com Tara (explore → write → review → push)` },
    { value: 'reload-plugins', label: '/reload-plugins', desc: 'recarrega plugins (skills, hooks, MCP)' },
    { value: 'revisar', label: '/revisar', desc: `code review + simplificação em paralelo no diff atual` },
  ];
}

export function filterSlashCommands(query: string, agentName: string): SlashCommand[] {
  const commands = getSlashCommands(agentName);
  const q = query.toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => c.value.toLowerCase().startsWith(q));
}

/**
 * Detecta contexto de slash command na posição do caret.
 * Retorna `null` se não está num slash trigger; senão retorna
 * `{ sliceStart, query }` onde sliceStart é o índice do `/` no texto.
 *
 * Trigger: `/` precedido por início-de-string OU whitespace, e sem whitespace
 * entre o `/` e o caret.
 */
export function detectSlashContext(
  text: string,
  caret: number,
): { sliceStart: number; query: string } | null {
  if (caret < 1) return null;
  const before = text.slice(0, caret);
  const match = before.match(/(?:^|\s)(\/\S*)$/);
  if (!match) return null;
  const slashFragment = match[1];
  const sliceStart = before.length - slashFragment.length;
  return { sliceStart, query: slashFragment.slice(1) };
}

/**
 * Calcula o novo texto + posição do caret após inserir `cmd` no slash context
 * identificado por `sliceStart..caret`.
 */
export function applySlashSelection(
  text: string,
  caret: number,
  sliceStart: number,
  cmd: SlashCommand,
): { text: string; caret: number } {
  const before = text.slice(0, sliceStart);
  const after = text.slice(caret);
  const insert = `/${cmd.value} `;
  return { text: before + insert + after, caret: sliceStart + insert.length };
}
