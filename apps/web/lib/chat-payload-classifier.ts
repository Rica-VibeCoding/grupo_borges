import type { ContentPart, MessagePayload } from './messages-types.ts';
import { parseLocalCommand } from './slash-command-wrapper.ts';
import { parseTaskNotification } from './task-notification-wrapper.ts';

export type ChatChip = {
  icon: string;
  label: string;
  summary: string;
};

type ChipPayloadKind =
  | 'slash'
  | 'skill'
  | 'tool'
  | 'sidechain-cluster'
  | 'channel-envelope'
  | 'task-notification';

type ChipPayload = {
  kind: ChipPayloadKind;
  chip: ChatChip;
  expandBody: string;
  rawRef: string;
};

type PlainPayload = {
  kind: 'plain';
  chip: null;
  expandBody: null;
  rawRef: string;
};

type SuppressPayload = {
  kind: 'suppress';
  chip: null;
  expandBody: null;
  rawRef: string;
};

export type ChatPayload = ChipPayload | PlainPayload | SuppressPayload;

const SLASH_ICONS: Record<string, string> = {
  '/clear': '🧹',
  '/compact': '📦',
  '/reload-plugins': '↻',
  '/model': '🤖',
  '/agents': '👥',
  '/status': 'ℹ️',
  '/context': '📊',
  '/skill': '🎯',
  '/memory': '🧠',
  '/restart': '♻️',
};

const CHANNEL_RE = /^\s*<channel\s+([^>]+)>([\s\S]*?)<\/channel>\s*$/;
const ATTR_RE = /([a-zA-Z_][\w-]*)="([^"]*)"/g;
const SYSTEM_REMINDER_RE = /^\s*<system-reminder\s*>[\s\S]*?<\/system-reminder\s*>\s*$/;

export function classifyMessage(
  msg: MessagePayload,
  nextMsg?: MessagePayload,
): ChatPayload {
  const rawRef = messageRef(msg);
  const text = textOf(msg.message?.content);

  if (!text.trim() && !hasStructuredContent(msg)) {
    return { kind: 'suppress', chip: null, expandBody: null, rawRef };
  }

  if (SYSTEM_REMINDER_RE.test(text)) {
    return { kind: 'suppress', chip: null, expandBody: null, rawRef };
  }

  const taskNotification = parseTaskNotification(text);
  if (taskNotification) {
    return {
      kind: 'task-notification',
      chip: {
        icon: taskNotificationIcon(taskNotification.status),
        label: `Task: ${taskNotification.summary.slice(0, 40)}`,
        summary: `${taskNotification.status}: ${taskNotification.summary}`,
      },
      expandBody: JSON.stringify(taskNotification, null, 2),
      rawRef,
    };
  }

  if (msg.message?.role === 'user') {
    const slash = parseLocalCommand(text);
    if (slash) {
      return {
        kind: 'slash',
        chip: {
          icon: SLASH_ICONS[slash.name] ?? '⚡',
          label: slash.name,
          summary: truncate(firstLine(slash.stdout), 80),
        },
        expandBody: slash.stdout,
        rawRef,
      };
    }

    const channel = parseChannelEnvelope(text);
    if (channel) {
      return {
        kind: 'channel-envelope',
        chip: {
          icon: channelIcon(channel.attrs.source),
          label: channelLabel(channel.attrs),
          summary: truncate(channel.body, 80),
        },
        expandBody: channelExpandBody(channel),
        rawRef,
      };
    }
  }

  if (msg.is_sidechain) {
    const cluster = collectSidechainOutputs(msg, nextMsg);
    return {
      kind: 'sidechain-cluster',
      chip: {
        icon: '🤖',
        label: `Subagent (${cluster.count}x)`,
        summary: truncate(firstLine(cluster.body), 80),
      },
      expandBody: cluster.body,
      rawRef,
    };
  }

  if (msg.message?.role === 'assistant') {
    const toolUse = firstToolUse(msg);
    if (toolUse?.name === 'Skill') {
      const skill = skillInfo(toolUse.input);
      const expandBody = nextMsg?.message?.role === 'assistant'
        ? contentBody(nextMsg.message.content)
        : '';
      return {
        kind: 'skill',
        chip: {
          icon: '🔧',
          label: `Skill: ${skill.name}`,
          summary: truncate(skill.summary, 80),
        },
        expandBody,
        rawRef,
      };
    }

    if (toolUse) {
      const result = matchingToolResult(toolUse.id, nextMsg);
      if (result && result.length > 300) {
        return {
          kind: 'tool',
          chip: {
            icon: '⚙️',
            label: `Tool: ${toolUse.name}`,
            summary: truncate(firstLine(result), 80),
          },
          expandBody: result,
          rawRef,
        };
      }
    }
  }

  return { kind: 'plain', chip: null, expandBody: null, rawRef };
}

function messageRef(msg: MessagePayload): string {
  return msg.uuid || String(msg.id);
}

function hasStructuredContent(msg: MessagePayload): boolean {
  const content = msg.message?.content;
  return Array.isArray(content) && content.length > 0;
}

function contentParts(content: string | ContentPart[] | undefined | null): ContentPart[] {
  if (content == null) return [];
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content;
}

function textOf(content: string | ContentPart[] | undefined | null): string {
  return contentParts(content)
    .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function contentBody(content: string | ContentPart[] | undefined | null): string {
  return contentParts(content)
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'thinking') return part.thinking;
      if (part.type === 'tool_use') return JSON.stringify(part.input, null, 2);
      if (part.type === 'tool_result') return toolResultBody(part.content);
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function toolResultBody(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return contentBody(content);
}

function firstToolUse(msg: MessagePayload): Extract<ContentPart, { type: 'tool_use' }> | null {
  const parts = contentParts(msg.message?.content);
  return parts.find(
    (part): part is Extract<ContentPart, { type: 'tool_use' }> => part.type === 'tool_use',
  ) ?? null;
}

function matchingToolResult(toolUseId: string, nextMsg?: MessagePayload): string | null {
  if (!nextMsg?.message) return null;
  const parts = contentParts(nextMsg.message.content);
  const result = parts.find(
    (part): part is Extract<ContentPart, { type: 'tool_result' }> => (
      part.type === 'tool_result' && part.tool_use_id === toolUseId
    ),
  );
  return result ? toolResultBody(result.content) : null;
}

function skillInfo(input: unknown): { name: string; summary: string } {
  const record = inputRecord(input);
  const skill = stringValue(record.skill);
  const description = stringValue(record.description);
  const name = stringValue(record.skill_name)
    || stringValue(record.name)
    || firstLine(skill)
    || 'unknown';
  return {
    name: truncate(name, 48),
    summary: skill || description || '',
  };
}

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function collectSidechainOutputs(
  msg: MessagePayload,
  nextMsg?: MessagePayload,
): { count: number; body: string } {
  const messages = [msg];
  if (nextMsg?.is_sidechain) messages.push(nextMsg);
  const outputs = messages
    .map((entry) => contentBody(entry.message?.content).trim())
    .filter(Boolean);
  return {
    count: messages.length,
    body: outputs.join('\n\n'),
  };
}

function parseChannelEnvelope(raw: string): {
  attrs: Record<string, string>;
  body: string;
} | null {
  const match = CHANNEL_RE.exec(raw);
  if (!match) return null;
  const attrs: Record<string, string> = {};
  for (const attrMatch of match[1].matchAll(ATTR_RE)) {
    attrs[attrMatch[1]] = attrMatch[2];
  }
  return { attrs, body: match[2].trim() };
}

function channelIcon(source: string | undefined): string {
  const lower = (source ?? '').toLowerCase();
  if (lower.includes('whatsapp')) return '📱';
  if (lower.includes('telegram')) return '✈️';
  return '📱';
}

function channelLabel(attrs: Record<string, string>): string {
  const source = attrs.source ?? 'channel';
  const user = attrs.user ? ` ${attrs.user}` : '';
  return `${source}${user}`;
}

function channelExpandBody(channel: { attrs: Record<string, string>; body: string }): string {
  const attachments = ['attachment_kind', 'attachment_path', 'attachment_mime']
    .map((key) => channel.attrs[key] ? `${key}: ${channel.attrs[key]}` : '')
    .filter(Boolean);
  return [channel.body, ...attachments].filter(Boolean).join('\n');
}

function taskNotificationIcon(status: string): string {
  if (status === 'failed') return '🔴';
  if (status === 'done') return '🟢';
  if (status === 'running') return '🟡';
  return '⚙️';
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/, 1)[0] ?? '';
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
