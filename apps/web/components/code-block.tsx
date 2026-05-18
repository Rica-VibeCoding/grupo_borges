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

    // 2) Fallback iOS-safe: textarea contentEditable + setSelectionRange.
    //    iOS Safari rejeita execCommand('copy') em <textarea readonly>; o
    //    pattern abaixo (contentEditable=true + selectNodeContents +
    //    setSelectionRange) é o único que funciona consistente em
    //    iOS 13+. font-size 16px evita zoom automático.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.contentEditable = 'true';
    ta.readOnly = false;
    ta.style.cssText = 'position:fixed;top:-9999px;left:0;width:1px;height:1px;font-size:16px;opacity:0;';
    document.body.appendChild(ta);

    const range = document.createRange();
    range.selectNodeContents(ta);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    ta.setSelectionRange(0, text.length);

    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    sel?.removeAllRanges();
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
