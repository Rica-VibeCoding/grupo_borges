import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchesStatus, matchesTab } from './mcp-filter.ts';
import type { McpServer } from './api.ts';

function servidor(parcial: Partial<McpServer>): McpServer {
  return {
    kind: 'mcp_json',
    id: 'x',
    name: 'x',
    enabled: true,
    ...parcial,
  };
}

describe('matchesTab — por TIPO de recurso, não por kind sozinho', () => {
  it('mcps pega os três kinds legados de MCP mesmo sem provides', () => {
    // O back nem sempre popula `provides` pra remote/user_scope — o fallback
    // por kind é o que garante que eles não desaparecem da tab.
    for (const kind of ['mcp_json', 'remote', 'user_scope'] as const) {
      assert.equal(matchesTab(servidor({ kind, provides: null }), 'mcps'), true);
    }
  });

  it('plugin só entra em mcps se DECLARAR provides mcp', () => {
    // Plugin skill-only (ex: frontend-design) não é servidor MCP — sem isso
    // ele vazaria pra tab errada e a contagem mentiria.
    assert.equal(matchesTab(servidor({ kind: 'plugin', provides: ['skill'] }), 'mcps'), false);
    assert.equal(matchesTab(servidor({ kind: 'plugin', provides: ['mcp'] }), 'mcps'), true);
  });

  it('agent_user só entra em subagents, nunca em mcps', () => {
    const s = servidor({ kind: 'agent_user', provides: ['subagent'] });
    assert.equal(matchesTab(s, 'subagents'), true);
    assert.equal(matchesTab(s, 'mcps'), false);
    assert.equal(matchesTab(s, 'skills'), false);
  });

  it('plugin multi-tipo aparece em TODAS as tabs que declara', () => {
    // O caso do vercel-plugin real: skill + mcp + subagent + hook no mesmo id.
    const s = servidor({ kind: 'plugin', provides: ['skill', 'mcp', 'subagent', 'hook'] });
    assert.equal(matchesTab(s, 'skills'), true);
    assert.equal(matchesTab(s, 'mcps'), true);
    assert.equal(matchesTab(s, 'subagents'), true);
  });

  it('sem provides e kind não-MCP não entra em nenhuma tab conhecida', () => {
    const s = servidor({ kind: 'plugin', provides: null });
    assert.equal(matchesTab(s, 'skills'), false);
    assert.equal(matchesTab(s, 'mcps'), false);
    assert.equal(matchesTab(s, 'subagents'), false);
  });
});

describe('matchesStatus', () => {
  it('all sempre passa, enabled/disabled filtram pelo booleano', () => {
    const ligado = servidor({ enabled: true });
    const desligado = servidor({ enabled: false });
    assert.equal(matchesStatus(ligado, 'all'), true);
    assert.equal(matchesStatus(desligado, 'all'), true);
    assert.equal(matchesStatus(ligado, 'enabled'), true);
    assert.equal(matchesStatus(desligado, 'enabled'), false);
    assert.equal(matchesStatus(ligado, 'disabled'), false);
    assert.equal(matchesStatus(desligado, 'disabled'), true);
  });
});
