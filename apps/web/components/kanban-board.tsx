'use client';

import { useCallback, useState } from 'react';
import type { KanbanColumn, KanbanColumnId, Task, TaskStatus } from '../lib/cockpit-types';
import { useIsMobile } from '../lib/use-is-mobile';
import { NewTaskModal } from './new-task-modal';
import { TaskDetailModal } from './task-detail-modal';

const COLUMN_DEFS: { id: KanbanColumnId; name: string; sourceStatuses: TaskStatus[] }[] = [
  { id: 'queue', name: 'FILA', sourceStatuses: ['backlog', 'ready'] },
  { id: 'running', name: 'EXECUTANDO', sourceStatuses: ['running'] },
  { id: 'blocked', name: 'BLOQUEADO', sourceStatuses: ['blocked'] },
  { id: 'review', name: 'REVISÃO', sourceStatuses: ['review'] },
  { id: 'done', name: 'CONCLUÍDO', sourceStatuses: ['done'] },
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

function KanbanRowView({
  task,
  columnId,
  serverNow,
  onOpen,
}: {
  task: Task;
  columnId: KanbanColumnId;
  serverNow: number;
  onOpen: (task: Task) => void;
}) {
  const displayId = taskDisplayId(task);
  const owner = task.assignee ?? '—';
  const age = taskAgeLabel(task, serverNow);
  const open = useCallback(() => onOpen(task), [onOpen, task]);
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
      aria-label={`Tarefa ${displayId}, responsável ${owner}, ${age}`}
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

function KanbanColumnView({
  column,
  serverNow,
  onOpenTask,
}: {
  column: KanbanColumn;
  serverNow: number;
  onOpenTask: (task: Task) => void;
}) {
  return (
    <div
      className="kcol scan-host"
      data-col={column.id}
      tabIndex={0}
      role="group"
      aria-label={`Coluna ${column.name}, ${column.tasks.length} tarefas`}
    >
      <div className="scan" aria-hidden="true" />
      <div className="kcol-skel"><span className="lbl">CONECTANDO</span></div>
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
            <KanbanRowView key={task.id} task={task} columnId={column.id} serverNow={serverNow} onOpen={onOpenTask} />
          ))
        )}
      </div>
    </div>
  );
}

function KanbanMobileView({
  columns,
  serverNow,
  onOpenTask,
}: {
  columns: KanbanColumn[];
  serverNow: number;
  onOpenTask: (task: Task) => void;
}) {
  const [activeStatus, setActiveStatus] = useState<KanbanColumnId>('running');
  const activeColumn = columns.find((column) => column.id === activeStatus) ?? columns[0]!;
  const displayColumn =
    activeStatus === 'running' && activeColumn.tasks.length === 0
      ? (columns.find((column) => column.id === 'queue') ?? activeColumn)
      : activeColumn;

  return (
    <div className="kanban-mobile">
      <div className="kanban-mobile-tabs" role="group" aria-label="Status da tarefa">
        {columns.map((column) => {
          const pressed = column.id === displayColumn.id;
          return (
            <button
              key={column.id}
              type="button"
              className="kanban-mobile-tab"
              data-status={column.id}
              aria-pressed={pressed}
              onClick={() => setActiveStatus(column.id)}
            >
              <span className="dot" aria-hidden="true" />
              <span className="label">{column.name}</span>
              <span className="count">({column.tasks.length})</span>
            </button>
          );
        })}
      </div>
      <div className="kanban-mobile-panel" data-status={displayColumn.id} role="group" aria-label={`Tarefas em ${displayColumn.name}`}>
        <div className="kcol-head">
          <span className="name"><span className="dot" aria-hidden="true" />{displayColumn.name}</span>
          <span className="cnt">
            <span className="num">{String(displayColumn.tasks.length).padStart(2, '0')}</span> / ∞
          </span>
        </div>
        <div className="kcol-body">
          {displayColumn.tasks.length === 0 ? (
            <div className="kcol-empty"><span className="hint">// aguardando primeiro evento</span></div>
          ) : (
            displayColumn.tasks.map((task) => (
              <KanbanRowView key={task.id} task={task} columnId={displayColumn.id} serverNow={serverNow} onOpen={onOpenTask} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function KanbanBoard({ tasks, serverNow }: { tasks: Task[]; serverNow: number }) {
  const isMobile = useIsMobile();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const columns = buildColumns(tasks, serverNow);
  const counts = Object.fromEntries(columns.map((c) => [c.id, c.tasks.length])) as Record<KanbanColumnId, number>;
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="kanban-wrap scan-host" aria-label="Kanban de tarefas" role="region" aria-live="polite">
      <div className="scan" aria-hidden="true" />
      <div className="kanban-topline">
        <div className="lead">
          <span className="num-tag">04</span>
          <span>KANBAN · FLUXO DE TAREFAS</span>
          <span className="live" id="kbLive">AO VIVO · SSE</span>
        </div>
        <div className="right">
          <button type="button" className="kanban-new-task" onClick={() => setNewTaskOpen(true)}>
            + NOVA
          </button>
          <span className="it"><span className="k">FILA</span><span className="v">{pad(counts.queue)}</span></span>
          <span className="it"><span className="k">EXEC</span><span className="v cy">{pad(counts.running)}</span></span>
          <span className="it">
            <span className="k">BLQ</span>
            <span className="v" style={{ color: 'var(--status-blocked)' }}>{pad(counts.blocked)}</span>
          </span>
          <span className="it"><span className="k">OK</span><span className="v">{pad(counts.done)}</span></span>
        </div>
      </div>
      {isMobile ? (
        <KanbanMobileView columns={columns} serverNow={serverNow} onOpenTask={setSelectedTask} />
      ) : (
        <div className="kanban-cols" id="kbcols">
          {columns.map((column) => (
            <KanbanColumnView key={column.id} column={column} serverNow={serverNow} onOpenTask={setSelectedTask} />
          ))}
        </div>
      )}
      <NewTaskModal open={newTaskOpen} onOpenChange={setNewTaskOpen} />
      <TaskDetailModal task={selectedTask} onOpenChange={(open) => { if (!open) setSelectedTask(null); }} />
    </div>
  );
}
