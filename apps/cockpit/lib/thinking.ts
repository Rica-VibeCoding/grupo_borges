export type NormalizedThinking = {
  text: string;
  lineCount: number;
};

function isThinkingPart(value: unknown): value is { type: 'thinking'; thinking: string } {
  if (typeof value !== 'object' || value === null) return false;
  const part = value as Record<string, unknown>;
  return part.type === 'thinking' && typeof part.thinking === 'string';
}

function countLines(text: string): number {
  if (text.trim() === '') return 0;
  const withoutTrailingBreaks = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  return withoutTrailingBreaks.split('\n').length;
}

/**
 * Unifica as três formas reais de `message.content`: array canônico, string
 * legada e null. Num array, só partes thinking pertencem a este renderer.
 */
export function normalizeThinkingContent(content: unknown): NormalizedThinking {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter(isThinkingPart).map((part) => part.thinking).join('\n\n')
        : '';

  return {
    text,
    lineCount: countLines(text),
  };
}
