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
  /** Linguagem do fence (```ts → "ts"), extraída do hast no override `pre` do
   *  markdown. Sem ela o cabeçalho mostra só o copiar — fence sem linguagem é
   *  comum em saída de agente. */
  linguagem?: string;
} & HTMLAttributes<HTMLPreElement>;

type CopyStatus = 'idle' | 'copied' | 'failed';

export function CodeBlock({ children, className, linguagem, ...props }: CodeBlockProps) {
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
    // CAIXA desde 17/08 (facelift do texto, leva 2): o Rica escolheu o formato
    // das referências ChatGPT/Claude — cabeçalho com a linguagem à esquerda e
    // o copiar à direita. Revisa conscientemente a ordem de 30/07 ("o output
    // não sai em caixa isolada"): a caixa daqui é a do token `frame` (8px) —
    // "conteúdo que MOSTRA saída" — colada no texto, não um cartão solto.
    //
    // O anúncio de status mora numa região sr-only SEPARADA do botão:
    // `aria-live` no próprio botão re-anuncia quando o label reverte pra
    // "copiar" (gov.uk #2342, via pesquisa do Canário).
    <div
      className="max-w-full overflow-hidden rounded-[var(--ck-radius-frame)]"
      style={{ background: 'var(--ck-surface-raised)' }}
    >
      <div
        className="flex items-center justify-between gap-[var(--ck-space-2)]"
        style={{ paddingLeft: 'var(--ck-space-4)' }}
      >
        {linguagem ? (
          <span
            className="font-mono text-[var(--ck-text-sm)]"
            style={{ color: 'var(--ck-text-secondary)' }}
          >
            {linguagem}
          </span>
        ) : null}
        <button
          type="button"
          className="min-h-[var(--ck-touch-min)] rounded-[var(--ck-radius-chip)] px-[var(--ck-space-2)] font-sans text-sm text-[var(--ck-text-secondary)]"
          onClick={handleCopy}
        >
          {label}
        </button>
      </div>
      <span role="status" className="sr-only">
        {status === 'idle' ? '' : label}
      </span>
      <pre
        ref={preRef}
        className={mergeMarkdownClassName(
          'max-w-full overflow-x-auto font-mono text-sm leading-body text-[var(--ck-text-primary)] [&>code]:bg-transparent [&>code]:p-0',
          className,
        )}
        style={{ padding: 'var(--ck-space-3) var(--ck-space-4)', margin: 0 }}
        {...props}
      >
        {children}
      </pre>
    </div>
  );
}
