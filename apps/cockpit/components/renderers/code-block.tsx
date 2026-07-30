'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

import { copyText, type ClipboardResult } from '../../lib/clipboard';
import { mergeMarkdownClassName } from '../../lib/markdown';
// Saiu daqui para `copia-fallback.ts` quando a linha de execução virou o segundo
// consumidor: duas cópias divergiriam em silêncio, e a divergência aparece como
// "copiar não faz nada" só no Safari de alguém.
import { fallbackCopy } from './copia-fallback';

export type CodeBlockProps = {
  children?: ReactNode;
} & HTMLAttributes<HTMLPreElement>;

type CopyStatus = 'idle' | 'copied' | 'failed';

export function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const resetTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<CopyStatus>('idle');

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  const selectContents = useCallback(() => {
    const pre = preRef.current;
    const selection = window.getSelection();
    if (!pre || !selection) return;

    const range = document.createRange();
    range.selectNodeContents(pre);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const showResult = useCallback((result: ClipboardResult) => {
    setStatus(result === 'failed' ? 'failed' : 'copied');
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => setStatus('idle'), 1800);
  }, []);

  const handleCopy = useCallback(() => {
    const text = preRef.current?.textContent ?? '';
    if (!text) return;

    const modernWrite = navigator.clipboard?.writeText
      ? navigator.clipboard.writeText.bind(navigator.clipboard)
      : undefined;

    // copyText chama writeText sincronamente, ainda dentro do gesto do usuário.
    const pendingCopy = copyText(text, {
      writeText: modernWrite,
      fallbackCopy,
    });

    // Feedback imediato e rota manual mesmo se o Safari deixar writeText
    // pendente sem resolver nem rejeitar.
    selectContents();

    void pendingCopy.then((result) => {
      selectContents();
      showResult(result);
    });
  }, [selectContents, showResult]);

  const label =
    status === 'copied'
      ? 'copiado'
      : status === 'failed'
        ? 'falhou — copie a seleção'
        : 'copiar';

  return (
    <section className="max-w-full overflow-hidden rounded-[var(--ck-radius-frame)] border border-[var(--ck-edge-hairline)] bg-[var(--ck-surface-raised)]">
      <header className="flex min-h-[44px] items-center justify-end border-b border-[var(--ck-edge-hairline)] px-[var(--ck-space-2)]">
        <button
          type="button"
          className="ck-veil min-h-[44px] rounded-[var(--ck-radius-chip)] px-[var(--ck-space-3)] font-sans text-[13px] text-[var(--ck-text-secondary)]"
          onClick={handleCopy}
          aria-live="polite"
        >
          {label}
        </button>
      </header>
      <pre
        ref={preRef}
        className={mergeMarkdownClassName(
          'max-w-full overflow-x-auto p-[var(--ck-space-3)] font-mono text-[13px] leading-[1.55] text-[var(--ck-text-primary)] [&>code]:bg-[var(--ck-surface-raised)] [&>code]:p-0',
          className,
        )}
        {...props}
      >
        {children}
      </pre>
    </section>
  );
}
