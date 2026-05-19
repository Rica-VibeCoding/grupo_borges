// Filtros puros do painel /mcp. Funções separadas pra fácil teste com node --test
// (sem React Testing Library). Vide tests/mcp-filter.test.ts.

import type { McpServer } from './api.ts';

export type McpTabKey = 'skills' | 'mcps' | 'subagents';
export type McpStatusFilter = 'all' | 'enabled' | 'disabled';

/**
 * Decide se um server aparece numa tab por TIPO de recurso.
 *
 * - `skills` → `provides` inclui `'skill'`
 * - `subagents` → `provides` inclui `'subagent'` (também kind `agent_user`)
 * - `mcps` → `provides` inclui `'mcp'` OU kind legacy de MCP (mcp_json / remote / user_scope)
 *
 * Hooks/LSP ficam fora das 3 tabs principais por enquanto.
 */
export function matchesTab(server: McpServer, tab: McpTabKey): boolean {
  const provides = server.provides ?? [];
  if (tab === 'skills') return provides.includes('skill');
  if (tab === 'subagents') {
    return provides.includes('subagent') || server.kind === 'agent_user';
  }
  if (tab === 'mcps') {
    return (
      provides.includes('mcp') ||
      server.kind === 'mcp_json' ||
      server.kind === 'remote' ||
      server.kind === 'user_scope'
    );
  }
  return false;
}

/**
 * Filtro secundário Ativos / Desativados / Todos.
 */
export function matchesStatus(server: McpServer, status: McpStatusFilter): boolean {
  if (status === 'all') return true;
  if (status === 'enabled') return server.enabled;
  return !server.enabled;
}
