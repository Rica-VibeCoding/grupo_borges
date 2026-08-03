import type { ContentPart, MessagePayload } from './messages-types.ts';
import type { OneLineChipTone } from './one-line-chip-types.ts';
import { parseLocalCommand } from './slash-command-wrapper.ts';
import { parseTaskNotification } from './task-notification-wrapper.ts';
import { prettifyToolName } from './tool-name.ts';

export type ChatChip = {
  icon: string;
  label: string;
  summary: string;
  /** Cor semântica opcional do chip (família de modelo em /model, etc). */
  accent?: string;
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
  /** V2: tone visual derivado do payload (failed→error, done→completed, etc).
   *  `undefined` = chip neutro (idle). Consumido pelo OneLineChip via prop
   *  `tone`. Sem propagação aqui, a borda colorida só existia na rota dev. */
  tone?: OneLineChipTone;
};

type PlainPayload = {
  kind: 'plain';
  chip: null;
  expandBody: null;
  rawRef: string;
};

/** Números do `compact_boundary` (type:"system", subtype do CC). Hoje o
 *  stream filtra `type=system` fora e a serialização canônica do back descarta
 *  tudo que não está na lista de chaves — então isto quase nunca chega. Lido
 *  defensivamente: quando um dia o back liberar, o cartão ganha a linha
 *  "222k → 13k tokens" sem nenhuma mudança aqui. */
export type CompactMeta = {
  preTokens?: number;
  postTokens?: number;
  trigger?: string;
};

/** O resumo do `/compact`. NÃO é chip: o corpo é longo demais para uma linha
 *  e o desenho é um cartão próprio do feed (fechado por padrão), não a linha
 *  seca dos chips. `expandBody` carrega o resumo INTEIRO — é ele que o
 *  "ver resumo" expande. */
type CompactSummaryPayload = {
  kind: 'compact-summary';
  chip: null;
  expandBody: string;
  rawRef: string;
  compactMeta?: CompactMeta;
};

type SuppressPayload = {
  kind: 'suppress';
  chip: null;
  expandBody: null;
  rawRef: string;
};

export type ChatPayload = ChipPayload | PlainPayload | SuppressPayload | CompactSummaryPayload;

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
const LOCAL_COMMAND_CAVEAT_ONLY_RE = /^\s*(?:<local-command-caveat\s*>[\s\S]*?<\/local-command-caveat\s*>\s*)+$/;
// Stdout órfão (sem <command-name> junto): vem do CC em msg separada quando
// um /comando termina. parseLocalCommand exige a tupla completa, então
// stdout-só cai em "plain" e renderiza literal (ANSI bruto + tag). Suprime.
const LOCAL_COMMAND_STDOUT_ONLY_RE = /^\s*(?:<local-command-(?:stdout|caveat)\s*>[\s\S]*?<\/local-command-(?:stdout|caveat)\s*>\s*)+$/;
// F5-5: marker injetado pelo CC quando o agente faz Read de imagem —
// "[Image: original 1280x900, displayed at 768x540. Multiply coordinates by
// 1.67 to map to original image.]". Se houver image_path no mesmo turno, já
// é renderizado inline — o marker é puro ruído. Âncoras `^...$` previnem
// falso-positivo em texto que cite o marker entre aspas ou concatenado.
const IMAGE_READ_MARKER_RE =
  /^\[Image: original \d+x\d+, displayed at \d+x\d+\. Multiply coordinates by [\d.]+ to map to original image\.\]$/;
// DS-71 round 5: quando o CC injeta uma Skill, o conteúdo do SKILL.md vaza
// como user text começando com "Base directory for this skill: /<path>". O
// chip kind=skill já carrega icon/label/expand — esse texto vira ruído
// duplicado. Suprime no classifier. Pós-ritual: âncora exige `: /` (path
// absoluto seguinte) — texto que cite o marker entre aspas/contexto NÃO
// começa com `Base directory for this skill: /` então não casa.
const SKILL_PREAMBLE_RE = /^\s*Base directory for this skill: \//;
// O resumo do `/compact`. Duas âncoras, porque as duas pontas falham sozinhas:
//
// - `isCompactSummary: true` é a marca OFICIAL do CC no JSONL — mas o back só
//   repassa as chaves listadas em `_canonical_jsonl_message_event`
//   (apps/api/routers/agents.py), e ela não está lá. Hoje NUNCA chega. Fica
//   lida defensivamente: o dia que o back liberar, a detecção vira pela marca
//   e não pelo texto.
// - o prefixo do corpo é o que atravessa hoje. É estável: 12/12 resumos de
//   compact amostrados nos JSONL da frota (02/08) começam EXATAMENTE com esta
//   frase. Âncora `^` pelo mesmo motivo das outras: quem CITA a frase no meio
//   de um texto não casa.
const COMPACT_SUMMARY_HEAD_RE =
  /^\s*This session is being continued from a previous conversation that ran out of context/;

/** É a mensagem-resumo de um `/compact`? Exportada para o consumidor do stream
 *  (a detecção de FIM do compact no `feed-da-conversa.tsx`) sem que ele
 *  precise classificar a mensagem inteira. */
export function ehMensagemResumoCompact(msg: MessagePayload): boolean {
  if (msg.message?.role !== 'user') return false;
  const cru = msg as unknown as { isCompactSummary?: unknown };
  if (cru.isCompactSummary === true) return true;
  return COMPACT_SUMMARY_HEAD_RE.test(textOf(msg.message.content));
}

/** O `compactMetadata` mora no evento `compact_boundary` (type:"system"), não
 *  no resumo — mas leitura defensiva não custa: se um dia vier colado na
 *  mensagem (ou o back mesclar), o cartão mostra os números sem tocar aqui. */
function compactMetaDe(msg: MessagePayload): CompactMeta | undefined {
  const cru = (msg as unknown as { compactMetadata?: unknown }).compactMetadata;
  if (!cru || typeof cru !== 'object') return undefined;
  const registro = cru as Record<string, unknown>;
  const meta: CompactMeta = {};
  if (typeof registro.preTokens === 'number' && Number.isFinite(registro.preTokens)) {
    meta.preTokens = registro.preTokens;
  }
  if (typeof registro.postTokens === 'number' && Number.isFinite(registro.postTokens)) {
    meta.postTokens = registro.postTokens;
  }
  if (typeof registro.trigger === 'string' && registro.trigger) {
    meta.trigger = registro.trigger;
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

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

  if (LOCAL_COMMAND_CAVEAT_ONLY_RE.test(text) || LOCAL_COMMAND_STDOUT_ONLY_RE.test(text)) {
    return { kind: 'suppress', chip: null, expandBody: null, rawRef };
  }

  if (IMAGE_READ_MARKER_RE.test(text.trim())) {
    return { kind: 'suppress', chip: null, expandBody: null, rawRef };
  }

  if (SKILL_PREAMBLE_RE.test(text)) {
    return { kind: 'suppress', chip: null, expandBody: null, rawRef };
  }

  // O resumo do /compact ANTES de qualquer outro ramo de user/assistant: sem
  // este caso ele caía em "plain" e o feed cuspia dezenas de linhas de resumo
  // como se fosse fala do Rica (incidente de 02/08). Não é chip — o corpo é o
  // próprio conteúdo expandível do cartão.
  if (ehMensagemResumoCompact(msg)) {
    const meta = compactMetaDe(msg);
    return {
      kind: 'compact-summary',
      chip: null,
      expandBody: text.trim(),
      rawRef,
      ...(meta ? { compactMeta: meta } : {}),
    };
  }

  const taskNotification = parseTaskNotification(text);
  if (taskNotification) {
    switch (taskNotification.kind) {
      case 'background':
        return {
          kind: 'task-notification',
          chip: {
            icon: '⚙️',
            label: `Task: ${taskNotification.summary.slice(0, 40)}`,
            summary: `${taskNotification.status}: ${taskNotification.summary}`,
          },
          expandBody: JSON.stringify(taskNotification, null, 2),
          rawRef,
          tone: taskNotificationTone(taskNotification.status),
        };
      case 'monitor':
        return {
          kind: 'task-notification',
          chip: {
            icon: '⚙️',
            label: `Monitor: ${truncate(taskNotification.summary, 40)}`,
            summary: taskNotification.event,
          },
          expandBody: JSON.stringify({
            taskId: taskNotification.taskId,
            summary: taskNotification.summary,
            event: taskNotification.event,
          }, null, 2),
          rawRef,
          tone: 'active',
        };
    }
  }

  if (msg.message?.role === 'user') {
    const slash = parseLocalCommand(text);
    if (slash) {
      const cleanStdout = stripAnsi(slash.stdout);
      const labelArgs = slash.args ? ` ${slash.args}` : '';
      const accent = slash.name === '/model' ? modelFamilyFromArg(slash.args) : undefined;
      const chip: ChatChip = {
        icon: SLASH_ICONS[slash.name] ?? '⚙️',
        label: `Slash: ${slash.name}${labelArgs}`,
        summary: truncate(firstLine(cleanStdout), 80),
      };
      if (accent) chip.accent = accent;
      return {
        kind: 'slash',
        chip,
        expandBody: cleanStdout,
        rawRef,
      };
    }

    const channel = parseChannelEnvelope(text);
    if (channel && channel.attrs.source !== 'cockpit') {
      return {
        kind: 'channel-envelope',
        chip: {
          icon: '⚙️',
          label: `Channel: ${channelLabel(channel.attrs)}`,
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
        icon: '⚙️',
        label: `Subagent: ${cluster.count}x`,
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
          icon: '⚙️',
          label: `Skill: ${skill.name}`,
          summary: truncate(skill.summary, 80),
        },
        expandBody,
        rawRef,
      };
    }

    if (toolUse) {
      const result = matchingToolResultEntry(toolUse.id, nextMsg);
      if (result && result.body.length > 300) {
        return {
          kind: 'tool',
          chip: {
            icon: '⚙️',
            label: `Tool: ${prettifyToolName(toolUse.name)}`,
            summary: truncate(firstLine(result.body), 80),
          },
          expandBody: result.body,
          rawRef,
          tone: result.isError ? 'error' : undefined,
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

function matchingToolResultEntry(
  toolUseId: string,
  nextMsg?: MessagePayload,
): { body: string; isError: boolean } | null {
  if (!nextMsg?.message) return null;
  const parts = contentParts(nextMsg.message.content);
  const result = parts.find(
    (part): part is Extract<ContentPart, { type: 'tool_result' }> => (
      part.type === 'tool_result' && part.tool_use_id === toolUseId
    ),
  );
  if (!result) return null;
  return {
    body: toolResultBody(result.content),
    isError: Boolean(result.is_error),
  };
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

function taskNotificationTone(status: string): OneLineChipTone | undefined {
  if (status === 'failed') return 'error';
  if (status === 'done') return 'completed';
  if (status === 'running') return 'active';
  return undefined;
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/, 1)[0] ?? '';
}

// CC stdout pode trazer ANSI bruto (`\x1b[1mOpus 4.7\x1b[22m`) ou já mojibake
// (`�[1m...�[22m` quando o terminal não decodifica). Remove ambos.
const ANSI_RE = /\x1b\[[\d;]*m|�\[[\d;]*m/g;
function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '');
}

function modelFamilyFromArg(arg: string): string | undefined {
  const s = arg.toLowerCase();
  if (s.includes('fable')) return 'fable';
  if (s.includes('opus')) return 'opus';
  if (s.includes('sonnet')) return 'sonnet';
  if (s.includes('haiku')) return 'haiku';
  if (s.includes('gpt') || s.includes('codex')) return 'codex';
  return undefined;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
