import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Agent } from '../lib/cockpit-types.ts';
import { agentLastActivityAt, compareAgentsByRecentActivity } from '../lib/agent-sort.ts';

function agent(overrides: Partial<Agent> & Pick<Agent, 'slug' | 'name' | 'status'>): Agent {
  const { slug, name, status, ...rest } = overrides;
  return {
    slug,
    name,
    role: '',
    emoji: null,
    tmux_session: slug,
    workspace_path: '',
    cli_default: 'claude_code',
    model_default: '',
    capabilities: [],
    created_at: 0,
    updated_at: 0,
    state_cli: null,
    state_model: null,
    current_task_id: null,
    current_task_last_heartbeat: null,
    last_seen: null,
    pane_excerpt: null,
    executor_kind: null,
    status_line: null,
    active_task_label: null,
    context_pct: null,
    session_started_at: null,
    last_assistant_message: null,
    token_usage_json: null,
    codex_tokens_used: null,
    codex_next_fresh: null,
    lifecycle_status: null,
    lifecycle_detail: null,
    lifecycle_event: null,
    lifecycle_updated_at: null,
    pane_session_started_at: null,
    status,
    sparkline: [],
    ...rest,
  };
}

test('agentLastActivityAt usa o maior marcador temporal disponível', () => {
  const a = agent({
    slug: 'barsi',
    name: 'Luiz Barsi',
    status: 'offline',
    last_seen: 100,
    lifecycle_updated_at: 120,
    current_task_last_heartbeat: 90,
    session_started_at: 80,
    pane_session_started_at: 110,
    updated_at: 70,
  });

  assert.equal(agentLastActivityAt(a), 120);
});

test('compareAgentsByRecentActivity prioriza atuação recente acima do status', () => {
  const offlineRecent = agent({
    slug: 'barsi',
    name: 'Luiz Barsi',
    status: 'offline',
    last_seen: 500,
    lifecycle_updated_at: 500,
  });
  const workingOlder = agent({
    slug: 'tara',
    name: 'Tara Kaur',
    status: 'trabalhando',
    current_task_last_heartbeat: 400,
    last_seen: 400,
  });

  const sorted = [workingOlder, offlineRecent].sort(compareAgentsByRecentActivity);

  assert.deepEqual(sorted.map((a) => a.slug), ['barsi', 'tara']);
});

test('compareAgentsByRecentActivity desempata por status e nome', () => {
  const agents = [
    agent({ slug: 'vinicius', name: 'Vinícius Zanella', status: 'offline', last_seen: 100 }),
    agent({ slug: 'daniel', name: 'Daniel Singh', status: 'ocioso', last_seen: 100 }),
    agent({ slug: 'felipe', name: 'Felipe Conti', status: 'ocioso', last_seen: 100 }),
  ].sort(compareAgentsByRecentActivity);

  assert.deepEqual(agents.map((a) => a.slug), ['daniel', 'felipe', 'vinicius']);
});
