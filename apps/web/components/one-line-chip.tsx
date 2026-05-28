'use client';

// OneLineChip — DS-70/JP-17
//
// Componente visual universal pro princípio "todo retorno do agente vira chip
// clicável de UMA linha + expand". Hoje há 3 chips paralelos (`msg-chip` tool/
// thinking, `msg-chip-sidechain` subagent, `channel-env` anexos) com APIs e
// CSS quase idênticos, drift pequeno a cada round. Este componente unifica.
//
// Não decide O QUE virar chip — isso é trabalho do classifier (JP-16, Tara).
// Aqui o foco é renderização: dados estruturados in, chip Apple-HIG out.
//
// Estética: Apple-HIG calibrada pro cockpit dark default.
//  - Radius 8px (control tier), border `--chat-hairline-strong` → `--accent-
//    border` no hover, fundo `--card` → `--card-2` quando aberto.
//  - Label em font-family inherit (Inter/sistema) — afasta do mono dos chips
//    legados. `summary` e `trailing` ficam em mono pra alinhar com payload
//    real (caminhos, comandos, duração).
//  - Blue accent (`--accent`) só pra focus/active — Apple's "blue is action".
//  - Expand: animação leve `cubic-bezier(.4,0,.2,1)` ~120ms — sem heavy
//    shadow (Apple usa contraste tonal, não sombra empilhada).
//  - Press feedback: scale(0.98) por 80ms no clique do header (HIG press).
//
// Acessibilidade: header é `<button>` real com `aria-expanded`. Enter/Space
// expandem nativamente (botão já trata). Sem ARIA custom — quanto menos,
// melhor.
//
// Accessible name: vem do texto visível dos spans filhos (icon é
// aria-hidden, label + summary + trailing + caret entram no cálculo).
// CSS truncar com ellipsis NÃO esconde do screen reader — o texto real
// continua no DOM e é lido por inteiro. Por isso NÃO tem `title` nem
// `aria-label` em span filho: dobraria o accessible name sem ganho.
//
// CSS mora em `app/globals.css` na seção `/* DS-70 OneLineChip */` — ver
// abaixo do `.msg-chip-body`. Token names em `--chip-*` pra não colidir.

import { memo, useId, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

export type { OneLineChipKind, OneLineChipTone } from './one-line-chip-types.ts';
import type { OneLineChipKind, OneLineChipTone } from './one-line-chip-types.ts';

export type OneLineChipProps = {
  /** Glyph/emoji do início. Mantém pequeno (1 char) — Apple-HIG não usa
   *  cluster de ícones em chips densos. */
  icon: ReactNode;
  /** Texto principal — kind humanizado ("slash command", "subagent",
   *  "Bash", "WhatsApp"). Fonte sistema, peso médio. */
  label: string;
  /** Resumo monoespaçado em 1 linha — comando exato, file_path, duração,
   *  o que importa pro user enxergar sem expandir. Truncado por ellipsis. */
  summary?: string;
  /** Texto curto à direita — duração, contagem, peso de tokens. Mono. */
  trailing?: string;
  /** Horário compacto HH:MM no canto direito antes do caret. Tipografia
   *  menor que `trailing`, cor muted. Sai do trailing pra não competir
   *  com duração/erro/contagem (o trailing carrega "o que aconteceu";
   *  timestamp só carrega "quando"). */
  timestamp?: string;
  /** Corpo expandido. `null`/`undefined` = chip NÃO expansível (caret some
   *  e header não é clicável). String → renderizada em `<pre>`. Aceita
   *  ReactNode pra payload rico (botões, imagens, etc). */
  expandBody?: ReactNode | null;
  /** Discriminador semântico — informa style hooks via `data-kind`. */
  kind: OneLineChipKind;
  /** Estado visual ao vivo — informa style hooks via `data-tone`. */
  tone?: OneLineChipTone;
  /** Render inicial aberto. Default `false`. */
  defaultOpen?: boolean;
  /** Callback opcional ao alternar — útil pro caller logar interação. */
  onToggle?: (next: boolean) => void;
  /** Scroller pai pra preservação de posição quando expand acontece acima
   *  do viewport. Aceita HTMLElement ou getter. Default: o ancestor mais
   *  próximo com `[data-chat-scroller]` — seletor canônico do feed de chat.
   *  Em outros contextos (kanban, statusline), passe explicitamente; sem
   *  scroller resolvido, expand acontece sem preservação. */
  scrollAnchor?: HTMLElement | (() => HTMLElement | null);
  /** Cor semântica opcional pro label (ex: família de modelo no /model).
   *  Renderiza como `data-accent` no root; CSS aplica color no label. */
  accent?: string;
};

export const OneLineChip = memo(function OneLineChip({
  icon,
  label,
  summary,
  trailing,
  timestamp,
  expandBody,
  kind,
  tone = 'idle',
  defaultOpen = false,
  onToggle,
  scrollAnchor,
  accent,
}: OneLineChipProps) {
  const [open, setOpen] = useState(defaultOpen);
  const expandable = expandBody != null;
  const bodyId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  // Sem useCallback: `toggle` é passado direto pro <button> nativo, que não
  // é memoizado — identidade da fn não importa pro filho. Wrap aqui só
  // pagaria tax de allocation do useCallback + array de deps. Doc do React:
  // "useCallback only matters when passing the function to a memoized child".
  function toggle() {
    if (!expandable) return;
    // Anchor preserve: chip acima do viewport não pode empurrar conteúdo já
    // lido pra cima. flushSync força commit do open pra medir delta real.
    const scroller =
      typeof scrollAnchor === 'function' ? scrollAnchor()
      : scrollAnchor ?? (rootRef.current?.closest('[data-chat-scroller]') as HTMLElement | null);
    if (!scroller) {
      setOpen((prev) => {
        const next = !prev;
        onToggle?.(next);
        return next;
      });
      return;
    }

    const chipTop = rootRef.current?.getBoundingClientRect().top ?? 0;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const chipAboveViewport = chipTop < scrollerTop;
    const prevScrollHeight = scroller.scrollHeight;
    const prevScrollTop = scroller.scrollTop;

    flushSync(() => {
      setOpen((prev) => {
        const next = !prev;
        onToggle?.(next);
        return next;
      });
    });

    if (chipAboveViewport) {
      const delta = scroller.scrollHeight - prevScrollHeight;
      if (delta !== 0) {
        scroller.scrollTop = prevScrollTop + delta;
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className="one-line-chip"
      data-kind={kind}
      data-tone={tone}
      data-accent={accent}
      data-open={open ? '1' : '0'}
      data-expandable={expandable ? '1' : '0'}
    >
      <button
        type="button"
        className="one-line-chip-head"
        onClick={toggle}
        aria-expanded={expandable ? open : undefined}
        // aria-controls só quando o body REALMENTE existe no DOM (Axe pode
        // flagar referência a ID inexistente quando body não monta).
        aria-controls={expandable && open ? bodyId : undefined}
        // Quando não-expansível, o "botão" é decorativo. `tabIndex=-1` evita
        // foco perdido em chips puramente informativos (sidechain idle, por
        // exemplo). Sem disabled — visualmente igual.
        tabIndex={expandable ? 0 : -1}
      >
        <span className="one-line-chip-icon" aria-hidden="true">{icon}</span>
        <span className="one-line-chip-label">{label}</span>
        {summary && (
          <span className="one-line-chip-summary mono">
            {summary}
          </span>
        )}
        {trailing && (
          <span className="one-line-chip-trailing mono">{trailing}</span>
        )}
        {timestamp && (
          <span className="one-line-chip-timestamp mono">{timestamp}</span>
        )}
        {expandable && (
          <span className="one-line-chip-caret" aria-hidden="true">
            {open ? '▴' : '▾'}
          </span>
        )}
      </button>
      {expandable && open && (
        <div className="one-line-chip-body" id={bodyId}>
          {typeof expandBody === 'string'
            ? <pre className="mono"><code>{expandBody}</code></pre>
            : expandBody}
        </div>
      )}
    </div>
  );
});
