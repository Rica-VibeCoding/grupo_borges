import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  mergeMarkdownClassName,
  normalizeMarkdownContent,
  parseAlertKind,
  remarkCockpitAlerts,
  transformMarkdownUrl,
  type AlertKind,
} from '../../lib/markdown';
import { CodeBlock } from './code-block';

export type AssistantMarkdownProps = {
  children: unknown;
  className?: string;
  cursorNoFim?: boolean;
};

const REMARK_PLUGINS = [remarkGfm, remarkCockpitAlerts];

// Tokens próprios do alerta (`globals.css`), não os de estado do agente — vide
// o comentário lá. Classe literal, nunca montada por template: nome de classe
// que só existe em runtime não é visto pelo JIT do Tailwind 4 e some.
const ALERT_BORDA: Record<AlertKind, string> = {
  note: 'border-[var(--ck-alert-note)]',
  tip: 'border-[var(--ck-alert-tip)]',
  important: 'border-[var(--ck-alert-important)]',
  warning: 'border-[var(--ck-alert-warning)]',
  caution: 'border-[var(--ck-alert-caution)]',
};

const ALERT_ROTULO_COR: Record<AlertKind, string> = {
  note: 'text-[var(--ck-alert-note)]',
  tip: 'text-[var(--ck-alert-tip)]',
  important: 'text-[var(--ck-alert-important)]',
  warning: 'text-[var(--ck-alert-warning)]',
  caution: 'text-[var(--ck-alert-caution)]',
};

// Sem a palavra, a barra colorida é adivinhação — e cor sozinha não passa em
// leitor de tela. Português porque é o que o Rica lê.
const ALERT_ROTULO: Record<AlertKind, string> = {
  note: 'Nota',
  tip: 'Dica',
  important: 'Importante',
  warning: 'Atenção',
  caution: 'Cuidado',
};

const MARKDOWN_COMPONENTS: Components = {
  a({ children, ...props }) {
    return (
      <a className="ck-link break-words" {...props}>
        {children}
      </a>
    );
  },
  blockquote({ children, node, ...props }) {
    const alerta = parseAlertKind((props as Record<string, unknown>)['data-alert']);

    // Citação continua citação: cinza, texto secundário. Só o alerta ganha cor.
    if (alerta === null) {
      return (
        <blockquote
          className="border-l-2 border-[var(--ck-edge-functional)] pl-[var(--ck-space-3)] text-[var(--ck-text-secondary)]"
          {...props}
        >
          {children}
        </blockquote>
      );
    }

    return (
      <blockquote
        className={`space-y-[var(--ck-space-2)] border-l-2 pl-[var(--ck-space-3)] text-[var(--ck-text-primary)] ${ALERT_BORDA[alerta]}`}
        {...props}
      >
        <p className={`font-medium ${ALERT_ROTULO_COR[alerta]}`}>{ALERT_ROTULO[alerta]}</p>
        {children}
      </blockquote>
    );
  },
  code({ children, className, ...props }) {
    return (
      <code
        className={mergeMarkdownClassName(
          'rounded-[var(--ck-radius-chip)] bg-[var(--ck-surface-raised)] px-[var(--ck-space-1)] py-px font-mono text-sm text-[var(--ck-text-primary)]',
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
      // pt-2: o título precisa desgrudar do parágrafo anterior mais que o
      // respiro padrão entre blocos — é o "mini-título" das referências.
      <h1
        className="pt-[var(--ck-space-2)] font-semibold text-[var(--ck-text-lg)] leading-hero"
        {...props}
      >
        {children}
      </h1>
    );
  },
  h2({ children, ...props }) {
    return (
      <h2
        className="pt-[var(--ck-space-2)] font-semibold text-[var(--ck-text-md)] leading-hero"
        {...props}
      >
        {children}
      </h2>
    );
  },
  h3({ children, ...props }) {
    return (
      // Escada desde 02/08: o título menor ainda é MAIOR que o corpo (15px) —
      // antes era 13px e a hierarquia corria de cabeça para baixo.
      <h3 className="font-semibold text-[var(--ck-text-base)] leading-body" {...props}>
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
      // space-y-2 desde 16/08 (facelift do texto, referência Claude/ChatGPT):
      // item de lista com 4px colava um no outro e lia como parágrafo único.
      <ol className="list-decimal space-y-[var(--ck-space-2)] pl-[var(--ck-space-5)]" {...props}>
        {children}
      </ol>
    );
  },
  pre({ children, node, ...props }) {
    // A linguagem do fence mora no filho `code` do hast (`pre > code
    // .language-x`) — o CodeBlock não a enxerga sozinho. Caminho sem plugin:
    // o override recebe o `node` (o override `blockquote` já o usa acima).
    // Fence sem linguagem chega sem classe e o cabeçalho mostra só o copiar.
    const filho = node?.children[0];
    const classes = filho && filho.type === 'element' ? filho.properties?.className : undefined;
    const primeira = Array.isArray(classes) ? classes[0] : classes;
    const texto =
      typeof primeira === 'string' || typeof primeira === 'number' ? String(primeira) : undefined;
    const linguagem = texto ? /^language-(\S+)$/.exec(texto)?.[1] : undefined;
    return (
      <CodeBlock linguagem={linguagem} {...props}>
        {children}
      </CodeBlock>
    );
  },
  table({ children, ...props }) {
    return (
      <div className="max-w-full overflow-x-auto">
        <table
          className="min-w-max border-collapse font-sans text-sm leading-body"
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
          'list-disc space-y-[var(--ck-space-2)] pl-[var(--ck-space-5)]',
          className,
        )}
        {...props}
      >
        {children}
      </ul>
    );
  },
  strong({ children, ...props }) {
    return (
      // Explícito desde 16/08: o default do browser é `bolder`, que herda o
      // peso do pai — dentro de um h2 (600) o negrito sumia. `semibold` crava
      // o contraste em qualquer contexto.
      <strong className="font-semibold" {...props}>
        {children}
      </strong>
    );
  },
};

export function AssistantMarkdown({
  children,
  className = '',
  cursorNoFim = false,
}: AssistantMarkdownProps) {
  const content = normalizeMarkdownContent(children);
  if (content === null) return null;

  return (
    <div
      // Corpo do chat = 15px (`--ck-text-base`, contrato §4), não 13 — 13px é
      // metadado. O respiro entre parágrafos (space-4) é o que separa o texto
      // corrido de um bloco de log.
      className={`min-w-0 max-w-[var(--ck-read-mid)] space-y-[var(--ck-space-4)] overflow-hidden font-sans text-base leading-body text-[var(--ck-text-primary)] [&_li>p]:inline [&_p]:break-words ${cursorNoFim ? 'ck-cursor-streaming ck-pulso' : ''} ${className}`}
      data-estado={cursorNoFim ? 'trabalhando' : undefined}
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
