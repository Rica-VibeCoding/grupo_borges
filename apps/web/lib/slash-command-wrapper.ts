const WRAPPER_TAGS = [
  'command-name',
  'command-message',
  'command-args',
  'local-command-stdout',
  'local-command-caveat',
  'system-reminder',
] as const;

const NATIVE_COMMANDS = new Set([
  '/agents',
  '/clear',
  '/compact',
  '/context',
  '/memory',
  '/model',
  '/reload-plugins',
  '/restart',
  '/skill',
  '/status',
]);

const WRAPPER_TAG_RE = new RegExp(
  `<(${WRAPPER_TAGS.join('|')})\\s*>([\\s\\S]*?)</\\1\\s*>`,
  'y',
);

type WrapperTag = (typeof WRAPPER_TAGS)[number];

export type LocalCommandKind = 'native' | 'custom' | null;

export type ParsedLocalCommand = {
  name: string;
  args: string;
  stdout: string;
  kind: LocalCommandKind;
};

export function parseLocalCommand(raw: string): ParsedLocalCommand | null {
  if (!raw.trim()) return null;

  const tags = parseWrapperTags(raw);
  if (!tags) return null;

  const name = firstTagValue(tags, 'command-name');
  if (!name) return null;

  const args = firstTagValue(tags, 'command-args') ?? '';
  const stdout = firstTagValue(tags, 'local-command-stdout') ?? '';

  return {
    name,
    args,
    stdout,
    kind: commandKind(name),
  };
}

function parseWrapperTags(raw: string): Array<{ tag: WrapperTag; value: string }> | null {
  const tags: Array<{ tag: WrapperTag; value: string }> = [];
  let index = 0;

  while (index < raw.length) {
    const next = raw.slice(index).match(/^\s*/);
    index += next?.[0].length ?? 0;
    if (index >= raw.length) break;

    WRAPPER_TAG_RE.lastIndex = index;
    const match = WRAPPER_TAG_RE.exec(raw);
    if (!match) return null;

    tags.push({
      tag: match[1] as WrapperTag,
      value: match[2].trim(),
    });
    index = WRAPPER_TAG_RE.lastIndex;
  }

  return tags;
}

function firstTagValue(
  tags: Array<{ tag: WrapperTag; value: string }>,
  tag: WrapperTag,
): string | null {
  return tags.find((entry) => entry.tag === tag)?.value ?? null;
}

function commandKind(name: string): LocalCommandKind {
  if (!name.startsWith('/')) return null;
  return NATIVE_COMMANDS.has(name) ? 'native' : 'custom';
}
