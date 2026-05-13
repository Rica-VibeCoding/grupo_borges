'use client';

import { useEffect, useState } from 'react';
import type { Agent, TaskEvent } from '../lib/cockpit-types';
import { useFleet } from '../lib/fleet-context';

const FEED_LIMIT = 40;

export function formatRelativeShort(deltaSec: number): string {
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
  if (typeof toolInput.notebook_path === 'string') return shortPath(toolInput.notebook_path);
  if (typeof toolInput.command === 'string') return truncate(toolInput.command, 60);
  if (typeof toolInput.pattern === 'string') return toolInput.pattern;
  if (typeof toolInput.query === 'string') return toolInput.query;
  if (typeof toolInput.url === 'string') return toolInput.url;
  if (typeof toolInput.prompt === 'string') return truncate(toolInput.prompt, 60);
  return null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function tick(value: string): string {
  return `\`${value}\``;
}

function codexItemPhrase(payload: Record<string, unknown>, tense: 'pre' | 'post'): string {
  const body = (payload.body ?? {}) as Record<string, unknown>;
  const item = (body.item ?? {}) as Record<string, unknown>;
  const itemType = typeof item.type === 'string' ? item.type : null;
  const command = typeof item.command === 'string' ? item.command : null;
  const text = typeof item.text === 'string' ? item.text : null;

  if (itemType === 'command_execution' && command) {
    return tense === 'pre' ? `rodando ${tick(truncate(command, 60))}` : `rodou ${tick(truncate(command, 60))}`;
  }
  if (itemType === 'agent_message' && text) {
    return tense === 'pre' ? 'respondendo' : 'respondeu';
  }
  if (itemType === 'reasoning') {
    return tense === 'pre' ? 'pensando' : 'pensou';
  }
  return tense === 'pre' ? 'executando item' : 'executou item';
}

function hasUserText(payload: Record<string, unknown>): boolean {
  const message = (payload.message ?? {}) as Record<string, unknown>;
  const content = message.content;
  if (typeof content === 'string') return content.trim().length >= 3;
  if (!Array.isArray(content)) return false;
  return content.some((item) => {
    const part = item as Record<string, unknown>;
    return part.type === 'text' && typeof part.text === 'string' && part.text.trim().length >= 3;
  });
}

export function toolPhrase(
  toolName: string,
  toolInput: Record<string, unknown>,
  tense: 'pre' | 'post',
): string {
  const target = pickToolTarget(toolInput);
  const withTarget = (pre: string, post: string) => {
    const verb = tense === 'pre' ? pre : post;
    return target ? `${verb} ${tick(target)}` : verb;
  };

  switch (toolName) {
    case 'Read':
      return withTarget('lendo', 'leu');
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return withTarget('escrevendo', 'escreveu');
    case 'Bash':
      return withTarget('rodando', 'rodou');
    case 'Grep':
      return withTarget('buscando', 'buscou');
    case 'WebFetch':
    case 'WebSearch':
      return withTarget('pesquisando', 'pesquisou');
    case 'Task':
      return tense === 'pre' ? 'chamando subagente' : 'subagente terminou';
    case 'TodoWrite':
    case 'TaskUpdate':
      return tense === 'pre' ? 'atualizando plano' : 'atualizou plano';
    default:
      if (toolName.startsWith('mcp__')) {
        return tense === 'pre' ? 'usando ferramenta externa' : 'usou ferramenta externa';
      }
      return tense === 'pre' ? `usando ${tick(toolName)}` : `usou ${tick(toolName)}`;
  }
}

export function summarize(ev: TaskEvent): string | null {
  const payload = (ev.payload ?? {}) as Record<string, unknown>;
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : null;
  const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;

  switch (ev.kind) {
    case 'hook:PreToolUse':
      return toolName ? toolPhrase(toolName, toolInput, 'pre') : null;
    case 'hook:PostToolUse':
      return toolName ? toolPhrase(toolName, toolInput, 'post') : null;
    case 'hook:Stop':
      return 'passou a bola';
    case 'hook:SubagentStop':
      return 'subagente terminou';
    case 'hook:StopFailure':
      return 'erro ao parar';
    case 'lifecycle.review':
      return 'task enviada para revisão';
    case 'lifecycle.blocked':
      return 'task bloqueada';
    case 'lifecycle.done':
      return 'concluído';
    case 'lifecycle.running':
      return 'rodando';
    case 'lifecycle.failed':
      return 'falhou';
    case 'tara.exec.started':
      return 'Tara iniciada';
    case 'tara.exec.completed':
      return 'Tara terminou';
    case 'tara.exec.failed':
      return 'Tara falhou';
    case 'codex.turn.started':
      return 'turno iniciado';
    case 'codex.turn.completed':
      return 'turno concluído';
    case 'codex.item.started':
      return codexItemPhrase(payload, 'pre');
    case 'codex.item.completed':
      return codexItemPhrase(payload, 'post');
    case 'jsonl:user':
      return hasUserText(payload) ? 'mensagem do usuário' : null;
    case 'jsonl:assistant':
      return 'resposta do assistente';
    case 'UserPromptSubmit':
      return 'prompt submetido';
    case 'SessionStart':
      return 'sessão iniciada';
    default:
      return null;
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

  const rows = events.slice(0, FEED_LIMIT).filter((ev) => summarize(ev) !== null);

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
          const summary = summarize(ev);
          return (
            <div className="af-row" key={ev.id} data-kind={ev.kind}>
              <span className="af-time mono num" suppressHydrationWarning>há {formatRelativeShort(delta)}</span>
              <span className="af-agent">
                <span className="af-emoji" aria-hidden>{agentEmoji(ev.agent_slug, fleet.agents)}</span>
                <span className="af-slug mono">{ev.agent_slug ?? '—'}</span>
              </span>
              <span className="af-kind mono">{ev.kind}</span>
              <span className="af-summary">{summary}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
