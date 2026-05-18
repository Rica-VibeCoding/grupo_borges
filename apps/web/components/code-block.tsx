'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';

/**
 * Wrapper de <pre> com botão "copiar" no canto superior direito. Plugado nos
 * Markdown do chat (assistant + user) via `components={{ pre: CodeBlock }}`.
 * Pega o textContent do <pre> em tempo de clique — nada de prop drilling do
 * source bruto.
 */
export function CodeBlock({ children, ...props }: { children?: ReactNode } & React.HTMLAttributes<HTMLPreElement>) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    const text = preRef.current?.textContent ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: seleciona o conteúdo pra usuário copiar à mão.
      const range = document.createRange();
      if (preRef.current) {
        range.selectNodeContents(preRef.current);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }, []);

  return (
    <div className="code-block-wrap">
      <pre ref={preRef} {...props}>{children}</pre>
      <button
        type="button"
        className="code-block-copy"
        onClick={onCopy}
        aria-label={copied ? 'Copiado' : 'Copiar bloco'}
        data-copied={copied || undefined}
      >
        {copied ? 'copiado' : 'copiar'}
      </button>
    </div>
  );
}
