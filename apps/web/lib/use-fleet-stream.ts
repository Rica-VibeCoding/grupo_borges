'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { AgentActivityOverride, AgentActivityState, FleetResponse, Task, TaskEvent } from './cockpit-types';

export type SseStatus = 'connecting' | 'open' | 'closed';

export type FleetState = {
  fleet: FleetResponse;
  tasks: Task[];
  events: TaskEvent[];
  activityOverrides: Record<string, AgentActivityOverride>;
  sseStatus: SseStatus;
};

export type FleetStreamState = FleetState & {
  reconnect: () => void;
  mutate: () => Promise<void>;
};

const REFETCH_INTERVAL_MS = 5_000;
const SSE_TRIGGERED_REFETCH_DEBOUNCE_MS = 250;
const SSE_MAX_BACKOFF_SECONDS = 60;
const EVENT_BUFFER_CAP = 200;
const INITIAL_EVENT_FETCH_LIMIT = 50;
const ACTIVITY_MIN_VISIBLE_MS: Record<AgentActivityState, number> = {
  thinking: 2_500,
  reading: 2_500,
  writing: 3_500,
  executing: 3_500,
  handoff: 3_500,
  searching: 3_500,
  tool: 3_500,
  subagent: 3_500,
  blocked: 4_000,
  idle: 1_200,
  offline: 1_200,
  done: 2_000,
};

type Snapshot = { fleet: FleetResponse; tasks: Task[]; events: TaskEvent[] };

function mergeEvents(a: TaskEvent[], b: TaskEvent[]): TaskEvent[] {
  const seen = new Set<number>();
  const merged: TaskEvent[] = [];
  for (const ev of [...a, ...b]) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    merged.push(ev);
  }
  merged.sort((x, y) => y.id - x.id);
  return merged.slice(0, EVENT_BUFFER_CAP);
}

async function fetchSnapshot(): Promise<Snapshot> {
  const [fleetRes, tasksRes, eventsRes] = await Promise.all([
    fetch('/api/fleet', { cache: 'no-store' }),
    fetch('/api/tasks', { cache: 'no-store' }),
    fetch(`/api/events?limit=${INITIAL_EVENT_FETCH_LIMIT}`, { cache: 'no-store' }),
  ]);
  if (!fleetRes.ok) throw new Error(`/api/fleet ${fleetRes.status}`);
  if (!tasksRes.ok) throw new Error(`/api/tasks ${tasksRes.status}`);
  if (!eventsRes.ok) throw new Error(`/api/events ${eventsRes.status}`);
  const [fleet, tasks, events] = await Promise.all([fleetRes.json(), tasksRes.json(), eventsRes.json()]);
  return { fleet, tasks, events };
}

function applySnapshot(
  snapshot: Snapshot,
  mySeq: number,
  setState: Dispatch<SetStateAction<FleetState>>,
  reqSeqRef: MutableRefObject<number>,
) {
  if (mySeq !== reqSeqRef.current) return;
  setState((prev) => ({
    fleet: snapshot.fleet,
    tasks: snapshot.tasks,
    events: mergeEvents(prev.events, snapshot.events),
    activityOverrides: pruneActivityOverrides(prev.activityOverrides),
    sseStatus: prev.sseStatus,
  }));
}

function pruneActivityOverrides(
  overrides: Record<string, AgentActivityOverride>,
  nowMs = Date.now(),
): Record<string, AgentActivityOverride> {
  const next = Object.fromEntries(
    Object.entries(overrides).filter(([, override]) => override.visible_until_ms > nowMs),
  );
  return Object.keys(next).length === Object.keys(overrides).length ? overrides : next;
}

function payloadBody(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  const body = payload?.body;
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : payload;
}

function eventDetail(ev: TaskEvent): string | null {
  const body = payloadBody(ev.payload);
  const item = body?.item;
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const itemRecord = item as Record<string, unknown>;
    const command = itemRecord.command;
    const text = itemRecord.text;
    const type = itemRecord.type;
    if (typeof command === 'string') return command;
    if (typeof text === 'string') return text;
    if (typeof type === 'string') return type;
  }
  const toolName = body?.tool_name;
  const matcher = body?.matcher;
  if (typeof toolName === 'string') return toolName;
  if (typeof matcher === 'string') return matcher;
  return ev.kind;
}

function activityFromEvent(ev: TaskEvent): AgentActivityState | null {
  const kind = ev.kind;
  if (
    kind === 'hook:PostToolUseFailure' ||
    kind === 'hook:StopFailure' ||
    kind === 'codex.turn.failed' ||
    kind === 'codex.error' ||
    kind === 'tara.exec.failed' ||
    kind === 'lifecycle.blocked'
  ) return 'blocked';
  if (kind === 'hook:PreToolUse') {
    // Discrimina micro-estado por tool_name no payload (mesma lógica do backend
    // _pre_tool_lifecycle em apps/api/routers/hooks.py). Default cai em 'tool'
    // genérico se payload não tiver tool_name reconhecido.
    const body = payloadBody(ev.payload);
    const toolName = typeof body?.tool_name === 'string' ? body.tool_name : null;
    const toolInput =
      body?.tool_input && typeof body.tool_input === 'object' && !Array.isArray(body.tool_input)
        ? (body.tool_input as Record<string, unknown>)
        : null;
    if (toolName === 'Read') return 'reading';
    if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') return 'writing';
    if (toolName === 'Bash') {
      const cmd = typeof toolInput?.command === 'string' ? toolInput.command : '';
      return /\btmux send-keys -t [\"']?[\w-]+/.test(cmd) ? 'handoff' : 'executing';
    }
    if (toolName === 'WebFetch' || toolName === 'WebSearch') return 'searching';
    if (toolName === 'Task') return 'subagent';
    return 'tool';
  }
  if (kind === 'codex.item.started' || kind === 'codex.item.updated') {
    return 'tool';
  }
  if (kind === 'hook:SubagentStart') return 'subagent';
  if (
    kind === 'hook:UserPromptSubmit' ||
    kind === 'hook:SessionStart' ||
    kind === 'UserPromptSubmit' ||
    kind === 'SessionStart' ||
    kind === 'tara.exec.started' ||
    kind === 'codex.turn.started' ||
    kind === 'hook:PostToolUse' ||
    kind === 'hook:SubagentStop' ||
    kind === 'codex.item.completed'
  ) return 'thinking';
  if (
    kind === 'hook:Stop' ||
    kind === 'Stop' ||
    kind === 'tara.exec.completed' ||
    kind === 'codex.turn.completed' ||
    kind === 'lifecycle.review'
  ) return 'idle';
  return null;
}

const ACTIVE_STATES: AgentActivityState[] = [
  'thinking',
  'reading',
  'writing',
  'executing',
  'handoff',
  'searching',
  'tool',
  'subagent',
];

function isDowngrade(from: AgentActivityState, to: AgentActivityState): boolean {
  return ACTIVE_STATES.includes(from) && ['idle', 'done'].includes(to);
}

function getReconnectDelay(attempt: number): number {
  const baseMs = Math.min(2 ** (attempt - 1), SSE_MAX_BACKOFF_SECONDS) * 1000;
  const jitter = 0.9 + Math.random() * 0.2;
  return baseMs * jitter;
}

export function useFleetStream(initial: FleetState): FleetStreamState {
  const [state, setState] = useState<FleetState>(initial);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSource = useRef<EventSource | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectRef = useRef<() => void>(() => {});
  const reqSeq = useRef(0);
  const reconnect = useCallback(() => reconnectRef.current(), []);
  const mutate = useCallback(async () => {
    const mySeq = ++reqSeq.current;
    const snapshot = await fetchSnapshot();
    applySnapshot(snapshot, mySeq, setState, reqSeq);
  }, []);

  useEffect(() => {
    let alive = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const refetch = async () => {
      const mySeq = ++reqSeq.current;
      try {
        const snapshot = await fetchSnapshot();
        if (!alive) return;
        applySnapshot(snapshot, mySeq, setState, reqSeq);
      } catch {
        if (!alive || mySeq !== reqSeq.current) return;
        setState((prev) => ({ ...prev, sseStatus: 'closed' }));
      }
    };

    const ingestEvent = (raw: string, kind: string) => {
      let obj: Partial<TaskEvent> & { id?: number };
      try {
        obj = JSON.parse(raw) as Partial<TaskEvent> & { id?: number };
      } catch {
        return;
      }
      if (typeof obj.id !== 'number') return;
      const ev: TaskEvent = {
        id: obj.id,
        task_id: obj.task_id ?? null,
        agent_slug: obj.agent_slug ?? null,
        instance_id: obj.instance_id ?? null,
        kind: typeof obj.kind === 'string' ? obj.kind : kind,
        payload: (obj.payload as Record<string, unknown> | null | undefined) ?? null,
        created_at: typeof obj.created_at === 'number'
          ? obj.created_at
          : Math.floor(Date.now() / 1000),
      };
      const activity = ev.agent_slug ? activityFromEvent(ev) : null;
      setState((prev) => {
        if (prev.events.length && prev.events[0]!.id === ev.id) return prev;
        const next = [ev, ...prev.events.filter((e) => e.id !== ev.id)].slice(0, EVENT_BUFFER_CAP);
        if (!ev.agent_slug || !activity) {
          return { ...prev, events: next, activityOverrides: pruneActivityOverrides(prev.activityOverrides) };
        }
        const nowMs = Date.now();
        const existing = prev.activityOverrides[ev.agent_slug];
        if (existing && existing.visible_until_ms > nowMs && isDowngrade(existing.state, activity)) {
          return {
            ...prev,
            events: next,
            activityOverrides: {
              ...pruneActivityOverrides(prev.activityOverrides, nowMs),
              [ev.agent_slug]: existing,
            },
          };
        }
        const visibleUntil = Math.max(
          existing?.visible_until_ms ?? 0,
          nowMs + ACTIVITY_MIN_VISIBLE_MS[activity],
        );
        return {
          ...prev,
          events: next,
          activityOverrides: {
            ...pruneActivityOverrides(prev.activityOverrides, nowMs),
            [ev.agent_slug]: {
              state: activity,
              visible_until_ms: visibleUntil,
              detail: eventDetail(ev),
            },
          },
        };
      });
    };

    const schedulePoll = () => {
      if (!alive) return;
      pollTimer = setTimeout(async () => {
        await refetch();
        schedulePoll();
      }, REFETCH_INTERVAL_MS);
    };

    const triggerRefetchDebounced = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        void refetch();
      }, SSE_TRIGGERED_REFETCH_DEBOUNCE_MS);
    };

    const onOpen = () => {
      if (!alive) return;
      reconnectAttempt.current = 0;
      clearReconnectTimer();
      setState((prev) => ({ ...prev, sseStatus: 'open' }));
    };

    // 5 listeners distintos por design — sse-starlette emite event types específicos.
    // Cada um faz o mesmo trabalho (ingest + debounced refetch), mas precisa ser
    // registrado por nome pra capturar o `event:` SSE corretamente.
    const SSE_EVENT_KINDS = [
      'message',
      'hook:PreToolUse',
      'hook:PostToolUse',
      'hook:PostToolUseFailure',
      'hook:UserPromptSubmit',
      'hook:SessionStart',
      'hook:SubagentStart',
      'hook:SubagentStop',
      'hook:Stop',
      'hook:StopFailure',
      'PostToolUse',
      'UserPromptSubmit',
      'Stop',
      'SessionStart',
      'tara.exec.started',
      'tara.exec.completed',
      'tara.exec.failed',
      'codex.turn.started',
      'codex.item.started',
      'codex.item.updated',
      'codex.item.completed',
      'codex.turn.completed',
      'codex.turn.failed',
      'codex.error',
      'dispatch',
      'dispatch.failed',
      'lifecycle.review',
      'lifecycle.blocked',
      'status.changed',
      'handoff',
    ] as const;
    const sseHandlers: Array<[string, EventListener]> = SSE_EVENT_KINDS.map((kind) => [
      kind,
      ((e: MessageEvent) => {
        ingestEvent(e.data, kind);
        triggerRefetchDebounced();
      }) as EventListener,
    ]);

    const removeEventListeners = (es: EventSource) => {
      es.removeEventListener('open', onOpen);
      es.removeEventListener('error', onError);
      for (const [kind, handler] of sseHandlers) es.removeEventListener(kind, handler);
    };

    const closeEventSource = () => {
      if (!eventSource.current) return;
      removeEventListeners(eventSource.current);
      eventSource.current.close();
      eventSource.current = null;
    };

    const clearReconnectTimer = () => {
      if (!reconnectTimer.current) return;
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    };

    const connect = () => {
      if (!alive) return;
      closeEventSource();
      setState((prev) => ({ ...prev, sseStatus: 'connecting' }));

      const es = new EventSource('/api/stream');
      eventSource.current = es;
      es.addEventListener('open', onOpen);
      es.addEventListener('error', onError);
      for (const [kind, handler] of sseHandlers) es.addEventListener(kind, handler);
    };

    const scheduleReconnect = () => {
      if (!alive || reconnectTimer.current) return;
      const attempt = reconnectAttempt.current + 1;
      reconnectAttempt.current = attempt;
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        connect();
      }, getReconnectDelay(attempt));
    };

    function onError() {
      if (!alive) return;
      closeEventSource();
      setState((prev) => ({ ...prev, sseStatus: 'closed' }));
      scheduleReconnect();
    }

    reconnectRef.current = () => {
      if (!alive) return;
      clearReconnectTimer();
      reconnectAttempt.current = 0;
      connect();
    };

    connect();

    schedulePoll();

    return () => {
      alive = false;
      if (pollTimer) clearTimeout(pollTimer);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      clearReconnectTimer();
      closeEventSource();
      reconnectRef.current = () => {};
    };
  }, []);

  return { ...state, reconnect, mutate };
}
