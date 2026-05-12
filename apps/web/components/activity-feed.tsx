'use client';

import { useEffect, useState } from 'react';
import type { Agent, TaskEvent } from '../lib/cockpit-types';
import { useFleet } from '../lib/fleet-context';

const FEED_LIMIT = 40;

function formatRelativeShort(deltaSec: number): string {
  if (deltaSec < 60) return `${deltaSec}s`;
  const m = Math.floor(deltaSec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function shortPath(p: string): string {
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 3) return p;
  return `…/${parts.slice(-3).join('/')}`;
}

function pickToolTarget(toolInput: Record<string, unknown>): string | null {
  if (typeof toolInput.file_path === 'string') return shortPath(toolInput.file_path);
  if (typeof toolInput.command === 'string') return toolInput.command.slice(0, 60);
  if (typeof toolInput.pattern === 'string') return toolInput.pattern;
  return null;
}

function summarize(ev: TaskEvent): string {
  const payload = (ev.payload ?? {}) as Record<string, unknown>;

  // hook:* events vindo do PostToolUse
  if (ev.kind.startsWith('hook:')) {
    const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : null;
    const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
    const target = pickToolTarget(toolInput);
    return target ? `${toolName ?? ev.kind} · ${target}` : (toolName ?? ev.kind);
  }

  switch (ev.kind) {
    case 'jsonl:attachment': {
      const att = (payload.attachment ?? {}) as Record<string, unknown>;
      const hook = typeof att.hookName === 'string' ? att.hookName : null;
      if (!hook) return 'attachment';
      let cmd: string | null = null;
      if (typeof att.command === 'string') {
        try {
          cmd = new URL(att.command, 'http://x').pathname;
        } catch {
          cmd = att.command.split(/\s+/)[0] ?? null;
        }
      }
      return cmd ? `${hook} → ${cmd}` : hook;
    }
    case 'jsonl:user':
      return 'mensagem do usuário';
    case 'jsonl:assistant':
      return 'resposta do assistente';
    case 'jsonl:summary':
      return typeof payload.summary === 'string' ? payload.summary.slice(0, 80) : 'summary';
    case 'UserPromptSubmit':
      return 'prompt submetido';
    case 'SessionStart':
      return 'sessão iniciada';
    case 'Stop':
      return 'turno finalizado';
    case 'PostToolUse':
      return typeof payload.tool_name === 'string' ? payload.tool_name : 'tool executada';
    case 'lifecycle.review':
      return 'task enviada para revisão';
    case 'lifecycle.blocked':
      return 'task bloqueada por falha';
    default:
      return ev.kind;
  }
}

function agentEmoji(slug: string | null, agents: Agent[]): string {
  if (!slug) return '·';
  const a = agents.find((x) => x.slug === slug);
  return a?.emoji ?? '·';
}

export function ActivityFeed() {
  const { events, fleet } = useFleet();
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(t);
  }, []);

  const rows = events.slice(0, FEED_LIMIT);

  return (
    <div className="activity-feed" aria-live="off">
      {rows.length === 0 ? (
        <div className="af-empty">
          <span>▸ AGUARDANDO O PRIMEIRO EVENTO</span>
          <span className="hint">hooks PostToolUse alimentam este feed em tempo real</span>
        </div>
      ) : (
        rows.map((ev) => {
          const delta = Math.max(0, now - ev.created_at);
          return (
            <div className="af-row" key={ev.id} data-kind={ev.kind}>
              <span className="af-time mono num" suppressHydrationWarning>há {formatRelativeShort(delta)}</span>
              <span className="af-agent">
                <span className="af-emoji" aria-hidden>{agentEmoji(ev.agent_slug, fleet.agents)}</span>
                <span className="af-slug mono">{ev.agent_slug ?? '—'}</span>
              </span>
              <span className="af-kind mono">{ev.kind}</span>
              <span className="af-summary">{summarize(ev)}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
