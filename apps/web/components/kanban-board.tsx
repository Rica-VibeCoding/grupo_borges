'use client';

import { useCallback } from 'react';
import type { KanbanColumn, KanbanColumnId, Task, TaskStatus } from '../lib/cockpit-types';
import { useToast } from '../lib/toast-context';

const COLUMN_DEFS: { id: KanbanColumnId; name: string; sourceStatuses: TaskStatus[] }[] = [
  { id: 'queue', name: 'QUEUE', sourceStatuses: ['backlog'] },
  { id: 'running', name: 'RUNNING', sourceStatuses: ['running'] },
  { id: 'blocked', name: 'BLOCKED', sourceStatuses: ['blocked'] },
  { id: 'review', name: 'REVIEW', sourceStatuses: ['review'] },
  { id: 'done', name: 'DONE', sourceStatuses: ['done'] },
];

function formatRelativeShort(deltaSec: number): string {
  if (deltaSec < 60) return `${deltaSec}s`;
  const m = Math.floor(deltaSec / 60);
  if (m < 60) {
    const remS = deltaSec % 60;
    return remS === 0 ? `${m}m` : `${m}m${String(remS).padStart(2, '0')}`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM === 0 ? `${h}h` : `${h}h${String(remM).padStart(2, '0')}`;
}

function taskAgeLabel(task: Task, serverNow: number): string {
  const anchor = task.completed_at ?? task.started_at ?? task.created_at;
  const delta = Math.max(0, serverNow - anchor);
  return formatRelativeShort(delta);
}

function taskDisplayId(task: Task): string {
  return task.human_id || task.id.slice(0, 8);
}

function buildColumns(tasks: Task[], serverNow: number): KanbanColumn[] {
  const byStatus = new Map<TaskStatus, Task[]>();
  for (const t of tasks) {
    const arr = byStatus.get(t.status) ?? [];
    arr.push(t);
    byStatus.set(t.status, arr);
  }
  return COLUMN_DEFS.map((def) => {
    const collected = def.sourceStatuses.flatMap((s) => byStatus.get(s) ?? []);
    collected.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    return {
      id: def.id,
      name: def.name,
      tasks: collected,
    };
  });
}

function columnStatusAttr(id: KanbanColumnId): string {
  return id === 'queue' ? 'queue' : id;
}

function KanbanRowView({ task, columnId, serverNow }: { task: Task; columnId: KanbanColumnId; serverNow: number }) {
  const displayId = taskDisplayId(task);
  const owner = task.assignee ?? '—';
  const age = taskAgeLabel(task, serverNow);
  const { fire } = useToast();
  const open = useCallback(
    () => fire({ kind: 'info', msg: `TASK · ${displayId}`, sub: 'OPEN DETAIL · WIP' }),
    [fire, displayId],
  );
  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    },
    [open],
  );
  return (
    <div
      className="krow"
      data-st={columnStatusAttr(columnId)}
      tabIndex={0}
      role="button"
      aria-label={`Task ${displayId}, owner ${owner}, ${age}`}
      onClick={open}
      onKeyDown={onKey}
    >
      <span className="sdot" aria-hidden="true" />
      <span className="id mono">{displayId}</span>
      <span className="owner mono">@{owner}</span>
      <span className="time mono">{age}</span>
      <span className="caret" aria-hidden="true">›</span>
    </div>
  );
}

function KanbanColumnView({ column, serverNow }: { column: KanbanColumn; serverNow: number }) {
  return (
    <div
      className="kcol scan-host"
      data-col={column.id}
      tabIndex={0}
      role="group"
      aria-label={`${column.name} column, ${column.tasks.length} tasks`}
    >
      <div className="scan" aria-hidden="true" />
      <div className="kcol-skel"><span className="lbl">CONNECTING</span></div>
      <div className="kcol-head">
        <span className="name"><span className="dot" aria-hidden="true" />{column.name}</span>
        <span className="cnt">
          <span className="num">{String(column.tasks.length).padStart(2, '0')}</span> / ∞
        </span>
      </div>
      <div className="kcol-body">
        {column.tasks.length === 0 ? (
          <div className="kcol-empty"><span className="hint">// aguardando primeiro evento</span></div>
        ) : (
          column.tasks.map((task) => (
            <KanbanRowView key={task.id} task={task} columnId={column.id} serverNow={serverNow} />
          ))
        )}
      </div>
    </div>
  );
}

export function KanbanBoard({ tasks, serverNow }: { tasks: Task[]; serverNow: number }) {
  const columns = buildColumns(tasks, serverNow);
  const counts = Object.fromEntries(columns.map((c) => [c.id, c.tasks.length])) as Record<KanbanColumnId, number>;
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="kanban-wrap scan-host" aria-label="Task kanban" role="region" aria-live="polite">
      <div className="scan" aria-hidden="true" />
      <div className="kanban-topline">
        <div className="lead">
          <span className="num-tag">04</span>
          <span>KANBAN · TASK STREAM</span>
          <span className="live" id="kbLive">LIVE · SSE</span>
        </div>
        <div className="right">
          <span className="it"><span className="k">QUEUE</span><span className="v">{pad(counts.queue)}</span></span>
          <span className="it"><span className="k">RUN</span><span className="v cy">{pad(counts.running)}</span></span>
          <span className="it">
            <span className="k">BLK</span>
            <span className="v" style={{ color: 'var(--status-blocked)' }}>{pad(counts.blocked)}</span>
          </span>
          <span className="it"><span className="k">DONE</span><span className="v">{pad(counts.done)}</span></span>
        </div>
      </div>
      <div className="kanban-cols" id="kbcols">
        {columns.map((column) => (
          <KanbanColumnView key={column.id} column={column} serverNow={serverNow} />
        ))}
      </div>
    </div>
  );
}
