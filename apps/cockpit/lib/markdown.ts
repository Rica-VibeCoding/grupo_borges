import { defaultUrlTransform } from 'react-markdown';

function isTextPart(value: unknown): value is { type: 'text'; text: string } {
  if (typeof value !== 'object' || value === null) return false;
  const part = value as Record<string, unknown>;
  return part.type === 'text' && typeof part.text === 'string';
}

/**
 * Normaliza as três formas reais de `message.content`. Ausência ou array sem
 * texto não cria wrapper vazio; string legada atravessa sem transformação.
 */
export function normalizeMarkdownContent(content: unknown): string | null {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter(isTextPart).map((part) => part.text).join('\n\n')
        : '';

  return text === '' ? null : text;
}

/**
 * Mantém a política de URL do react-markdown explícita e testável fora do DOM.
 * Protocolos perigosos ou não reconhecidos viram href/src vazio.
 */
export function transformMarkdownUrl(url: string): string {
  return defaultUrlTransform(url);
}

export function mergeMarkdownClassName(base: string, received?: string): string {
  return received ? `${base} ${received}` : base;
}
