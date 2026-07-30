// A2: padrão similar a LOCAL_COMMAND_CAVEAT_ONLY_RE — aceita 1+ envelopes
// `<task-notification>` consecutivos (e/ou intercalados com `<system-
// reminder>` colado), mas exige que o conteúdo INTEIRO do msg seja
// composto SÓ desses envelopes. Texto livre antes/depois → plain (não
// vira chip). Sem isso, CC concatenando 2 notifications ou um system-
// reminder colado fazia o XML vazar em UserBubble.
const ENVELOPE_BLOCKS_ONLY_RE = /^\s*(?:<(?:task-notification|system-reminder)\s*>[\s\S]*?<\/(?:task-notification|system-reminder)\s*>\s*)+$/;
const FIRST_TASK_NOTIFICATION_RE = /<task-notification\s*>([\s\S]*?)<\/task-notification\s*>/;
const TASK_NOTIFICATION_TAG_RE = /<(task-id|tool-use-id|output-file|status|summary|event)\s*>([\s\S]*?)<\/\1\s*>/g;

type TaskNotificationTag = 'task-id' | 'tool-use-id' | 'output-file' | 'status' | 'summary' | 'event';

export type BackgroundTaskNotification = {
  kind: 'background';
  taskId: string;
  toolUseId: string;
  outputFile: string;
  status: string;
  summary: string;
  raw: string;
};

export type MonitorTaskNotification = {
  kind: 'monitor';
  taskId: string;
  summary: string;
  event: string;
  raw: string;
};

export type ParsedTaskNotification = BackgroundTaskNotification | MonitorTaskNotification;

export function parseTaskNotification(raw: string): ParsedTaskNotification | null {
  if (!ENVELOPE_BLOCKS_ONLY_RE.test(raw)) return null;

  const first = FIRST_TASK_NOTIFICATION_RE.exec(raw);
  if (!first) return null;

  const tags = parseTaskNotificationTags(first[1]);
  return parseBackgroundTaskNotification(tags, raw)
    ?? parseMonitorTaskNotification(tags, raw);
}

function parseBackgroundTaskNotification(
  tags: Partial<Record<TaskNotificationTag, string>>,
  raw: string,
): BackgroundTaskNotification | null {
  const taskId = tags['task-id'];
  const toolUseId = tags['tool-use-id'];
  const outputFile = tags['output-file'];
  const status = tags.status;
  const summary = tags.summary;

  if (!taskId || !toolUseId || !outputFile || !status || !summary) return null;

  return {
    kind: 'background',
    taskId,
    toolUseId,
    outputFile,
    status,
    summary,
    raw: raw.trim(),
  };
}

function parseMonitorTaskNotification(
  tags: Partial<Record<TaskNotificationTag, string>>,
  raw: string,
): MonitorTaskNotification | null {
  const taskId = tags['task-id'];
  const summary = tags.summary;
  const event = tags.event;

  if (!taskId || !summary || !event) return null;

  return {
    kind: 'monitor',
    taskId,
    summary,
    event,
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
