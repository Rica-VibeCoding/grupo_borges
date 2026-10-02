'use client';

/**
 * A tropa — o `≡` do chrome e a faixa com o véu: a mecânica otimista do painel,
 * do outro lado da tela. Saiu de `superficie-otimista.tsx` (02/10) com os
 * comentários.
 */
import Link from 'next/link';
import { useContext, type MouseEvent, type ReactNode } from 'react';

import { IconeMenu } from './icones';
import { cliqueSimples, tropa } from './contexto-da-superficie';

/* -------------------------------------------------------------------------- */
/* A TROPA — mesma mecânica, outro lado da tela                                */
/* -------------------------------------------------------------------------- */

/** O `≡` do chrome. Era um `<Link>` seco dentro da `BarraDeTelas`, e por isso a
 *  tropa era a última superfície que ainda esperava o servidor pra COMEÇAR a se
 *  mover. Some no desktop (`md:hidden`): lá a tropa é fundo permanente e o botão
 *  abriria o que já está aberto, que é a mentira de UI da §9. */
export function BotaoNav({
  hrefAbrir,
  hrefFechar,
  aberto,
}: {
  hrefAbrir: string;
  hrefFechar: string;
  /** Valor do servidor — usado no SSR e como fallback fora do provider. */
  aberto: boolean;
}) {
  const ctx = useContext(tropa.Ctx);
  const abertoReal = ctx?.aberto ?? aberto;
  const href = abertoReal ? hrefFechar : hrefAbrir;

  return (
    <Link
      href={href}
      onClick={
        ctx
          ? (e) => {
              if (!cliqueSimples(e)) return;
              e.preventDefault();
              // Abrir e fechar a tropa trocam a entrada, não empilham — como o gesto e o
              // toque fora (ordem do Rica, 27/09: não acumular tela).
              ctx.ir(href, !abertoReal, undefined, true);
            }
          : undefined
      }
      replace
      aria-label={abertoReal ? 'Fechar lista de agentes' : 'Abrir lista de agentes'}
      data-selecionado={abertoReal ? 'true' : 'false'}
      className="ck-veil flex shrink-0 items-center justify-center md:hidden"
      style={{
        minWidth: 'var(--ck-touch-min)',
        minHeight: 'var(--ck-touch-min)',
        marginLeft: 'calc(var(--ck-space-3) * -1)',
        borderRadius: 'var(--ck-radius-chip)',
        color: 'var(--ck-text-secondary)',
      }}
    >
      <IconeMenu tamanho={18} />
    </Link>
  );
}

/** Véu + faixa da tropa. Espelha o `GavetaPainel`, com duas diferenças que vêm
 *  de a tropa ser fundo permanente no desktop:
 *
 *  - o véu é `md:hidden` — acima de `md` não há o que velar, e velar cobriria a
 *    folha inteira se alguém chegasse por link com `?nav=aberto`;
 *  - o `data-aberto` da faixa só é LIDO abaixo de `md`: a regra `.ck-surge-lado`
 *    mora dentro da media query do celular, então acima disso o atributo fica no
 *    DOM sem efeito nenhum e a faixa permanente segue intocada.
 *
 *  Sem `inert`, de propósito: no desktop a faixa está à vista com
 *  `data-aberto="false"`, e um `inert` amarrado a esse booleano desligaria a
 *  navegação inteira do desktop. Quem tira do alcance do Tab é o
 *  `visibility: hidden`, que a media query já limita ao celular. */
export function GavetaNav({
  fecharHref,
  aberto,
  children,
}: {
  fecharHref: string;
  /** Valor do servidor — usado no SSR e como fallback fora do provider. */
  aberto: boolean;
  children: ReactNode;
}) {
  const ctx = useContext(tropa.Ctx);
  const abertoReal = ctx?.aberto ?? aberto;

  const fechar = ctx
    ? (e: MouseEvent<HTMLAnchorElement>) => {
        if (!cliqueSimples(e)) return;
        e.preventDefault();
        // Tocar fora troca a entrada, não empilha: é o mesmo que o gesto de fechar (27/09).
        ctx.ir(fecharHref, false, undefined, true);
      }
    : undefined;

  return (
    <>
      {/* Véu — NÃO escurece mais (ordem do Rica, 30/07, via Pavan com prints:
          *"tira a função que escurece o resto da tela quando a gaveta
          aparece"*). Ficou só o alvo de toque que fecha. Sempre no DOM, como o
          do painel: elemento removido não anima a saída. */}
      <Link
        href={fecharHref}
        replace
        onClick={fechar}
        aria-label="Fechar lista de agentes"
        data-aberto={String(abertoReal)}
        className="ck-surge-veu fixed inset-0 md:hidden"
        style={{ zIndex: 'var(--ck-z-drawer)' }}
      />

      <aside
        aria-label="lista de agentes"
        data-aberto={String(abertoReal)}
        className="ck-faixa ck-surge-lado flex min-h-0 flex-col overflow-y-auto border-r md:border-r-0 md:flex"
        // Os `safe-*` desta faixa moram na classe, não aqui: no desktop o
        // `padding-top` vira o respiro que alinha a tropa com o chrome da folha,
        // e estilo inline venceria a media query.
        style={{
          background: 'var(--ck-surface-nav)',
          borderColor: 'var(--ck-edge-hairline)',
        }}
      >
        {children}
      </aside>
    </>
  );
}
