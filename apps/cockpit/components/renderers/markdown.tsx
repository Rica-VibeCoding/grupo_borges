import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  mergeMarkdownClassName,
  normalizeMarkdownContent,
  transformMarkdownUrl,
} from '../../lib/markdown';
import { CodeBlock } from './code-block';

export type AssistantMarkdownProps = {
  children: unknown;
  className?: string;
};

const REMARK_PLUGINS = [remarkGfm];

const MARKDOWN_COMPONENTS: Components = {
  a({ children, ...props }) {
    return (
      <a className="ck-link break-words" {...props}>
        {children}
      </a>
    );
  },
  blockquote({ children, ...props }) {
    return (
      <blockquote
        className="border-l-2 border-[var(--ck-edge-functional)] pl-[var(--ck-space-3)] text-[var(--ck-text-secondary)]"
        {...props}
      >
        {children}
      </blockquote>
    );
  },
  code({ children, className, ...props }) {
    return (
      <code
        className={mergeMarkdownClassName(
          'rounded-[var(--ck-radius-chip)] bg-[var(--ck-surface-raised)] px-[var(--ck-space-1)] py-px font-mono text-[13px] text-[var(--ck-text-primary)]',
          className,
        )}
        {...props}
      >
        {children}
      </code>
    );
  },
  h1({ children, ...props }) {
    return (
      <h1 className="font-semibold text-[var(--ck-text-lg)] leading-[1.2]" {...props}>
        {children}
      </h1>
    );
  },
  h2({ children, ...props }) {
    return (
      <h2 className="font-semibold text-[var(--ck-text-md)] leading-[1.2]" {...props}>
        {children}
      </h2>
    );
  },
  h3({ children, ...props }) {
    return (
      <h3 className="font-semibold text-[13px] leading-[1.55]" {...props}>
        {children}
      </h3>
    );
  },
  hr(props) {
    return <hr className="border-[var(--ck-edge-hairline)]" {...props} />;
  },
  img({ alt, ...props }) {
    return (
      // Markdown remoto não conhece dimensões antecipadamente; max-width evita
      // que a mídia empurre a página além dos 390px.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={alt ?? ''}
        className="h-auto max-w-full rounded-[var(--ck-radius-frame)]"
        loading="lazy"
        {...props}
      />
    );
  },
  input({ className, ...props }) {
    return (
      <input
        className={mergeMarkdownClassName(
          'mr-[var(--ck-space-2)] size-[var(--ck-space-4)] accent-[var(--ck-state-ok)]',
          className,
        )}
        {...props}
      />
    );
  },
  ol({ children, ...props }) {
    return (
      <ol className="list-decimal space-y-[var(--ck-space-1)] pl-[var(--ck-space-5)]" {...props}>
        {children}
      </ol>
    );
  },
  pre({ children, ...props }) {
    return (
      <CodeBlock {...props}>
        {children}
      </CodeBlock>
    );
  },
  table({ children, ...props }) {
    return (
      <div className="max-w-full overflow-x-auto">
        <table
          className="min-w-max border-collapse font-sans text-[13px] leading-[1.55]"
          {...props}
        >
          {children}
        </table>
      </div>
    );
  },
  td({ children, ...props }) {
    return (
      <td
        className="border border-[var(--ck-edge-hairline)] px-[var(--ck-space-3)] py-[var(--ck-space-2)] align-top"
        {...props}
      >
        {children}
      </td>
    );
  },
  th({ children, ...props }) {
    return (
      <th
        className="border border-[var(--ck-edge-functional)] bg-[var(--ck-surface-raised)] px-[var(--ck-space-3)] py-[var(--ck-space-2)] text-left font-semibold"
        {...props}
      >
        {children}
      </th>
    );
  },
  ul({ children, className, ...props }) {
    return (
      <ul
        className={mergeMarkdownClassName(
          'list-disc space-y-[var(--ck-space-1)] pl-[var(--ck-space-5)]',
          className,
        )}
        {...props}
      >
        {children}
      </ul>
    );
  },
};

export function AssistantMarkdown({ children, className = '' }: AssistantMarkdownProps) {
  const content = normalizeMarkdownContent(children);
  if (content === null) return null;

  return (
    <div
      className={`min-w-0 max-w-[var(--ck-read-mid)] space-y-[var(--ck-space-3)] overflow-hidden font-sans text-[13px] leading-[1.55] text-[var(--ck-text-primary)] [&_li>p]:inline [&_p]:break-words ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={MARKDOWN_COMPONENTS}
        urlTransform={transformMarkdownUrl}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
