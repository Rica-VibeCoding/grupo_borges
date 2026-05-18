'use client';

import { useCallback, useState } from 'react';
import type { KanbanColumn, KanbanColumnId, Task, TaskStatus } from '../lib/cockpit-types';
import { useIsMobile } from '../lib/use-is-mobile';
import { NewTaskModal } from './new-task-modal';
import { TaskDetailModal } from './task-detail-modal';

const COLUMN_DEFS: { id: KanbanColumnId; name: string; sourceStatuses: TaskStatus[] }[] = [
  { id: 'queue', name: 'BACKLOG', sourceStatuses: ['backlog', 'ready'] },
  { id: 'running', name: 'EXECUTANDO', sourceStatuses: ['running'] },
  { id: 'blocked', name: 'BLOQUEADO', sourceStatuses: ['blocked'] },
  { id: 'review', name: 'REVISÃO', sourceStatuses: ['review'] },
  { id: 'done', name: 'CONCLUÍDO', sourceStatuses: ['done'] },
];

function taskDisplayId(task: Task): string {
  return task.human_id || task.id.slice(0, 8);
}

// Stamp por status (intencional — discutido no brief):
//   done    → completed_at  (quando concluiu)
//   running → started_at    (quando entrou em curso)
//   outros  → created_at    (quando nasceu)
// Trade-off: dois cards podem exibir o mesmo timestamp significando coisas
// diferentes. Aceito porque a coluna onde o card vive já dá o contexto, e
// "freshness contextualizado por status" mata o age relativo "5m53" sem
// perder a informação útil que ele transmitia.
function taskAnchorTime(task: Task): number {
  return task.completed_at ?? task.started_at ?? task.created_at;
}

// DS-58 kanban: stamp absoluto no formato DD/MM/YY-HH:mm (TZ São Paulo).
// Substitui o age relativo "5m53" que dava ansiedade de freshness.
const KANBAN_STAMP_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Sao_Paulo',
});

function formatKanbanStamp(unixSec: number): string {
  const parts = KANBAN_STAMP_FORMATTER.formatToParts(new Date(unixSec * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')}-${get('hour')}:${get('minute')}`;
}

function buildColumns(tasks: Task[]): KanbanColumn[] {
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
  onOpen,
}: {
  task: Task;
  columnId: KanbanColumnId;
  onOpen: (task: Task) => void;
}) {
  const displayId = taskDisplayId(task);
  const owner = task.assignee ?? '—';
  const stamp = formatKanbanStamp(taskAnchorTime(task));
  // DS-58 kanban one-line: card vira ID · @owner · DD/MM/YY-HH:mm.
  // Título da task NÃO renderiza visível — vai no `title` attr (preview hover
  // desktop + acessibilidade) e no aria-label. Detalhes completos abrem via
  // click → TaskDetailModal (onOpen).
  const titleAttr = task.title || displayId;
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
      title={titleAttr}
      aria-label={`Tarefa ${displayId}, responsável ${owner}, ${stamp}`}
      onClick={open}
      onKeyDown={onKey}
    >
      <span className="krow-id mono">{displayId}</span>
      <span className="krow-owner mono">@{owner}</span>
      <span className="krow-stamp mono">{stamp}</span>
    </div>
  );
}

function KanbanColumnView({
  column,
  onOpenTask,
}: {
  column: KanbanColumn;
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
            <KanbanRowView key={task.id} task={task} columnId={column.id} onOpen={onOpenTask} />
          ))
        )}
      </div>
    </div>
  );
}

function KanbanMobileView({
  columns,
  onOpenTask,
}: {
  columns: KanbanColumn[];
  onOpenTask: (task: Task) => void;
}) {
  const [activeStatus, setActiveStatus] = useState<KanbanColumnId>('queue');
  const displayColumn = columns.find((column) => column.id === activeStatus) ?? columns[0]!;

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
              <KanbanRowView key={task.id} task={task} columnId={displayColumn.id} onOpen={onOpenTask} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function KanbanBoard({ tasks }: { tasks: Task[] }) {
  const isMobile = useIsMobile();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const columns = buildColumns(tasks);
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
          <span className="it"><span className="k">BACKLOG</span><span className="v">{pad(counts.queue)}</span></span>
          <span className="it"><span className="k">EXEC</span><span className="v cy">{pad(counts.running)}</span></span>
          <span className="it">
            <span className="k">BLQ</span>
            <span className="v" style={{ color: 'var(--status-blocked)' }}>{pad(counts.blocked)}</span>
          </span>
          <span className="it"><span className="k">OK</span><span className="v">{pad(counts.done)}</span></span>
        </div>
      </div>
      {isMobile ? (
        <KanbanMobileView columns={columns} onOpenTask={setSelectedTask} />
      ) : (
        <div className="kanban-cols" id="kbcols">
          {columns.map((column) => (
            <KanbanColumnView key={column.id} column={column} onOpenTask={setSelectedTask} />
          ))}
        </div>
      )}
      <NewTaskModal open={newTaskOpen} onOpenChange={setNewTaskOpen} />
      <TaskDetailModal task={selectedTask} onOpenChange={(open) => { if (!open) setSelectedTask(null); }} />
    </div>
  );
}
