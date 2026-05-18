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

    // 1) Caminho preferido: Clipboard API (precisa de secure context).
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
        return;
      } catch {
        // cai pro fallback abaixo
      }
    }

    // 2) Fallback: textarea offscreen + execCommand. Funciona em contextos
    //    sem clipboard API (HTTP, iframes restritos, navegadores antigos).
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
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
