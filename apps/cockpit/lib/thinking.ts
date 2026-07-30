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

let cachedText = '';
let cachedLineCount = 0;

function countLines(text: string): number {
  if (text === cachedText) return cachedLineCount;

  let lineCount = 0;
  if (/\S/u.test(text)) {
    lineCount = 1;

    for (
      let index = text.indexOf('\n');
      index !== -1;
      index = text.indexOf('\n', index + 1)
    ) {
      lineCount += 1;
    }

    for (
      let index = text.indexOf('\r');
      index !== -1;
      index = text.indexOf('\r', index + 1)
    ) {
      if (text.charCodeAt(index + 1) !== 0x000a) lineCount += 1;
    }

    for (let index = text.length - 1; index >= 0; index -= 1) {
      const code = text.charCodeAt(index);
      if (code === 0x000a) {
        lineCount -= 1;
        if (text.charCodeAt(index - 1) === 0x000d) index -= 1;
      } else if (code === 0x000d) {
        lineCount -= 1;
      } else {
        break;
      }
    }
  }

  cachedText = text;
  cachedLineCount = lineCount;
  return lineCount;
}

/**
 * Unifica as três formas reais de `message.content`: array canônico, string
 * legada e null. Num array, só partes thinking pertencem a este renderer.
 */
export function normalizeThinkingContent(content: unknown): NormalizedThinking | null {
  let text = '';

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    let hasThinkingPart = false;
    for (const part of content) {
      if (!isThinkingPart(part)) continue;
      if (hasThinkingPart) text += '\n\n';
      text += part.thinking;
      hasThinkingPart = true;
    }
  }

  const lineCount = countLines(text);
  if (lineCount === 0) return null;

  return {
    text,
    lineCount,
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
