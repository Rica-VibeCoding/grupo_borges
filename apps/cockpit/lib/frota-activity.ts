import type {
  Agent,
  AgentActivityOverride,
  AgentActivityState,
  TaskEvent,
} from '@grupo_borges/cockpit-core/cockpit-types';
import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { efeitoNaCorrida } from './spike/corrida-em-voo.ts';

export const ACTIVITY_MIN_VISIBLE_MS: Record<AgentActivityState, number> = {
  trabalhando: 2_500,
  aguardando: 3_500,
  ocioso: 1_000,
  offline: 1_000,
};

export const ACTIVE_STATES: AgentActivityState[] = ['trabalhando', 'aguardando'];

export const FLEET_SSE_EVENT_KINDS = [
  'message',
  'hook:PreToolUse', 'hook:PostToolUse', 'hook:PostToolUseFailure',
  'hook:UserPromptSubmit', 'hook:SessionStart',
  'hook:SubagentStart', 'hook:SubagentStop', 'hook:Stop', 'hook:StopFailure',
  'PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart',
  'tara.exec.started', 'tara.exec.completed', 'tara.exec.failed',
  'codex.turn.started', 'codex.item.started', 'codex.item.updated',
  'codex.item.completed', 'codex.turn.completed', 'codex.turn.failed',
  'codex.error', 'dispatch', 'dispatch.failed', 'lifecycle.review',
  'lifecycle.blocked', 'status.changed', 'handoff',
  // O watcher publica o tipo cru do JSONL como nome do evento. Estes são hoje
  // o caminho real do Claude Code entre um envio e o snapshot seguinte.
  'jsonl:user', 'jsonl:assistant', 'jsonl:result', 'jsonl:system',
  'jsonl:summary', 'jsonl:attachment', 'jsonl:file-history-snapshot',
  'jsonl:queue-operation',
] as const;

function payloadBody(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  const body = payload?.body;
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : payload;
}

export function eventDetail(event: TaskEvent): string | null {
  const body = payloadBody(event.payload);
  const item = body?.item;
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const record = item as Record<string, unknown>;
    for (const value of [record.command, record.text, record.type]) {
      if (typeof value === 'string') return value;
    }
  }
  for (const value of [body?.tool_name, body?.matcher]) {
    if (typeof value === 'string') return value;
  }
  return event.kind;
}

function activityFromNamedEvent(kind: string): AgentActivityState | null {
  if (
    kind === 'hook:PostToolUseFailure' || kind === 'hook:StopFailure' ||
    kind === 'codex.turn.failed' || kind === 'codex.error' ||
    kind === 'tara.exec.failed' || kind === 'lifecycle.blocked' ||
    kind === 'dispatch.failed'
  ) return 'aguardando';
  if (
    kind === 'hook:Stop' || kind === 'Stop' ||
    kind === 'tara.exec.completed' || kind === 'codex.turn.completed' ||
    kind === 'lifecycle.review' || kind === 'lifecycle.done'
  ) return 'ocioso';
  if (
    kind === 'hook:PreToolUse' || kind === 'hook:PostToolUse' ||
    kind === 'hook:UserPromptSubmit' || kind === 'hook:SessionStart' ||
    kind === 'hook:SubagentStart' || kind === 'hook:SubagentStop' ||
    kind === 'UserPromptSubmit' || kind === 'SessionStart' ||
    kind === 'tara.exec.started' || kind === 'codex.turn.started' ||
    kind === 'codex.item.started' || kind === 'codex.item.updated' ||
    kind === 'codex.item.completed' || kind === 'dispatch' ||
    kind === 'handoff' || kind === 'status.changed'
  ) return 'trabalhando';
  return null;
}

/** Payload cru do watcher pro formato que `efeitoNaCorrida` espera. Só existe
 *  se tiver `message` reconhecível — sem isso o caller cai no fallback de
 *  sempre. `isSidechain` (camelCase) é como o JSONL do CC grava; a régua
 *  reusada do feed lê `is_sidechain` (canônico) — sem este mapa a guarda de
 *  sidechain nunca dispara aqui. */
function payloadParaCorrida(payload: TaskEvent['payload']): MessagePayload | null {
  if (!payload) return null;
  const message = payload.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  return {
    ...payload,
    is_sidechain: payload.is_sidechain === true || payload.isSidechain === true,
  } as unknown as MessagePayload;
}

export function activityFromTaskEvent(event: TaskEvent): AgentActivityState | null {
  if (event.kind === 'jsonl:user' || event.kind === 'jsonl:assistant') {
    const payload = payloadParaCorrida(event.payload);
    // Sem `message` reconhecível: fallback pessimista de sempre — melhor
    // acender "trabalhando" à toa do que perder um card preso de verdade.
    if (!payload) return 'trabalhando';
    // Mesma régua do "Pensando" na linha viva do feed (`corrida-em-voo.ts`,
    // 10/08): comando local (`/rename`, `/clear`, `/compact`) e
    // system-reminder puro não são turno, `null` não mexe no estado atual.
    // Achado de 16/08: o card do fleet tinha a régua velha (`jsonl:user`
    // sempre acende), presa depois do `/rename` que o boot injeta.
    const efeito = efeitoNaCorrida(payload);
    if (efeito === null) return null;
    return efeito ? 'trabalhando' : 'ocioso';
  }
  if (event.kind === 'jsonl:system' && event.payload?.subtype === 'turn_duration') {
    return 'ocioso';
  }
  return activityFromNamedEvent(event.kind);
}

export function pruneActivityOverrides(
  overrides: Record<string, AgentActivityOverride>,
  now = Date.now(),
): Record<string, AgentActivityOverride> {
  const entries = Object.entries(overrides).filter(([, value]) => value.visible_until_ms > now);
  return entries.length === Object.keys(overrides).length ? overrides : Object.fromEntries(entries);
}

export function applyActivityOverrides(
  agents: Agent[],
  overrides: Record<string, AgentActivityOverride>,
): Agent[] {
  const now = Date.now();
  return agents.map((agent) => {
    const override = overrides[agent.slug];
    if (!override || override.visible_until_ms <= now) return agent;
    return {
      ...agent,
      status: override.state,
      lifecycle_status: override.state,
      lifecycle_detail: override.detail,
    };
  });
}
