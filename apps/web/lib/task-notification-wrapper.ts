const TASK_NOTIFICATION_RE = /^\s*<task-notification\s*>([\s\S]*?)<\/task-notification\s*>\s*$/;
const TASK_NOTIFICATION_TAG_RE = /<(task-id|tool-use-id|output-file|status|summary)\s*>([\s\S]*?)<\/\1\s*>/g;

type TaskNotificationTag = 'task-id' | 'tool-use-id' | 'output-file' | 'status' | 'summary';

export type ParsedTaskNotification = {
  taskId: string;
  toolUseId: string;
  outputFile: string;
  status: string;
  summary: string;
  raw: string;
};

export function parseTaskNotification(raw: string): ParsedTaskNotification | null {
  const envelope = TASK_NOTIFICATION_RE.exec(raw);
  if (!envelope) return null;

  const tags = parseTaskNotificationTags(envelope[1]);
  const taskId = tags['task-id'];
  const toolUseId = tags['tool-use-id'];
  const outputFile = tags['output-file'];
  const status = tags.status;
  const summary = tags.summary;

  if (!taskId || !toolUseId || !outputFile || !status || !summary) return null;

  return {
    taskId,
    toolUseId,
    outputFile,
    status,
    summary,
    raw: raw.trim(),
  };
}

function parseTaskNotificationTags(raw: string): Partial<Record<TaskNotificationTag, string>> {
  const tags: Partial<Record<TaskNotificationTag, string>> = {};
  for (const match of raw.matchAll(TASK_NOTIFICATION_TAG_RE)) {
    tags[match[1] as TaskNotificationTag] = match[2].trim();
  }
  return tags;
}
