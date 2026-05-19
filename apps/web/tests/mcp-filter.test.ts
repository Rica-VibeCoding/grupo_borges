import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { McpServer } from '../lib/api.ts';
import { matchesStatus, matchesTab } from '../lib/mcp-filter.ts';

function srv(overrides: Partial<McpServer> & Pick<McpServer, 'kind' | 'id' | 'name'>): McpServer {
  return {
    enabled: true,
    transport: null,
    description: null,
    command_redacted: null,
    provides: null,
    ...overrides,
  };
}

// ---------- matchesTab ----------

test('matchesTab.skills — passa quando provides inclui "skill"', () => {
  const s = srv({ kind: 'plugin', id: 'code-review', name: 'code-review', provides: ['skill'] });
  assert.equal(matchesTab(s, 'skills'), true);
  assert.equal(matchesTab(s, 'mcps'), false);
  assert.equal(matchesTab(s, 'subagents'), false);
});

test('matchesTab.skills — falha quando provides está vazio/null', () => {
  const s = srv({ kind: 'mcp_json', id: 'supabase-ze', name: 'supabase-ze' });
  assert.equal(matchesTab(s, 'skills'), false);
});

test('matchesTab.mcps — passa quando provides inclui "mcp"', () => {
  const s = srv({ kind: 'plugin', id: 'context7', name: 'context7', provides: ['mcp'] });
  assert.equal(matchesTab(s, 'mcps'), true);
});

test('matchesTab.mcps — fallback por kind legacy (mcp_json / remote / user_scope)', () => {
  for (const kind of ['mcp_json', 'remote', 'user_scope'] as const) {
    const s = srv({ kind, id: 'x', name: 'x' });
    assert.equal(matchesTab(s, 'mcps'), true, `kind=${kind} deveria cair em mcps`);
    assert.equal(matchesTab(s, 'skills'), false);
    assert.equal(matchesTab(s, 'subagents'), false);
  }
});

test('matchesTab.subagents — passa quando provides inclui "subagent"', () => {
  const s = srv({ kind: 'plugin', id: 'agents-pack', name: 'agents-pack', provides: ['subagent'] });
  assert.equal(matchesTab(s, 'subagents'), true);
});

test('matchesTab.subagents — passa quando kind=agent_user (sem provides)', () => {
  const s = srv({ kind: 'agent_user', id: 'reviewer', name: 'reviewer' });
  assert.equal(matchesTab(s, 'subagents'), true);
  assert.equal(matchesTab(s, 'mcps'), false);
  assert.equal(matchesTab(s, 'skills'), false);
});

test('matchesTab — plugin multi-tipo aparece em mais de uma tab', () => {
  const s = srv({
    kind: 'plugin',
    id: 'multi',
    name: 'multi-pack',
    provides: ['skill', 'mcp'],
  });
  assert.equal(matchesTab(s, 'skills'), true);
  assert.equal(matchesTab(s, 'mcps'), true);
  assert.equal(matchesTab(s, 'subagents'), false);
});

test('matchesTab — hook/lsp puros não caem em nenhuma das 3 tabs', () => {
  const s = srv({ kind: 'plugin', id: 'hooks-only', name: 'hooks-only', provides: ['hook'] });
  assert.equal(matchesTab(s, 'skills'), false);
  assert.equal(matchesTab(s, 'mcps'), false);
  assert.equal(matchesTab(s, 'subagents'), false);
});

// ---------- matchesStatus ----------

test('matchesStatus.all — passa sempre', () => {
  assert.equal(matchesStatus(srv({ kind: 'plugin', id: 'a', name: 'a', enabled: true }), 'all'), true);
  assert.equal(matchesStatus(srv({ kind: 'plugin', id: 'a', name: 'a', enabled: false }), 'all'), true);
});

test('matchesStatus.enabled — só servers ligados', () => {
  assert.equal(matchesStatus(srv({ kind: 'plugin', id: 'a', name: 'a', enabled: true }), 'enabled'), true);
  assert.equal(matchesStatus(srv({ kind: 'plugin', id: 'a', name: 'a', enabled: false }), 'enabled'), false);
});

test('matchesStatus.disabled — só servers desligados', () => {
  assert.equal(matchesStatus(srv({ kind: 'plugin', id: 'a', name: 'a', enabled: false }), 'disabled'), true);
  assert.equal(matchesStatus(srv({ kind: 'plugin', id: 'a', name: 'a', enabled: true }), 'disabled'), false);
});
