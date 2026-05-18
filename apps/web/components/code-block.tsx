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

  const flashCopied = useCallback(() => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, []);

  const onCopy = useCallback(() => {
    const text = preRef.current?.textContent ?? '';
    if (!text) return;

    // 1) Caminho síncrono primeiro (execCommand) — funciona em iOS Safari
    //    e mantém transient activation. Pattern iOS-safe: textarea
    //    contentEditable=true + selectNodeContents + setSelectionRange.
    //    iOS Safari rejeita execCommand em textarea readonly; bug histórico
    //    é navigator.clipboard.writeText ficar pending sem resolver/rejeitar
    //    no iOS (sintoma: botão "pensa" mas clipboard vazio).
    let copiedViaExec = false;
    try {
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

      copiedViaExec = document.execCommand('copy');
      sel?.removeAllRanges();
      document.body.removeChild(ta);
    } catch {
      copiedViaExec = false;
    }

    if (copiedViaExec) {
      flashCopied();
      return;
    }

    // 2) Fallback async: Clipboard API. Não bloqueia UI; se falhar,
    //    silenciosamente; usuário pode tentar de novo.
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(flashCopied).catch(() => {});
    }
  }, [flashCopied]);

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
