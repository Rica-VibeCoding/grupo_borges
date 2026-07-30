export type NormalizedThinking = {
  text: string;
  lineCount: number;
};

export type ThinkingRenderModel = NormalizedThinking & {
  initiallyExpanded: false;
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
export function normalizeThinkingContent(content: unknown): NormalizedThinking | null {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter(isThinkingPart).map((part) => part.thinking).join('\n\n')
        : '';

  if (text.trim() === '') return null;

  return {
    text,
    lineCount: countLines(text),
  };
}

/**
 * Decisão de produto baseada no corpus: 803 de 804 thinkings não têm texto.
 * `null` significa zero markup; conteúdo real nasce colapsado.
 */
export function buildThinkingRenderModel(content: unknown): ThinkingRenderModel | null {
  const thinking = normalizeThinkingContent(content);
  if (thinking === null) return null;

  return {
    ...thinking,
    initiallyExpanded: false,
  };
}
