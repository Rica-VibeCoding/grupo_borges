import { defaultUrlTransform } from 'react-markdown';

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
