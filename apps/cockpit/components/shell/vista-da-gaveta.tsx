'use client';

/**
 * Qual visão a gaveta desenha — lido no CLIENTE (28/09). Morava no servidor
 * (`sp.painel === 'mcps'` na página), e era o único motivo para abrir, fechar
 * e trocar de visão ir ao servidor: a página é `force-dynamic` e cada toque
 * refazia o `fetchAgent` e baixava a árvore inteira de novo. As duas visões
 * chegam prontas do servidor como `children`; aqui só se escolhe qual monta.
 *
 * Deep-link continua valendo: no SSR o `useSearchParams` lê a busca do pedido
 * (a rota é `force-dynamic`, sem prerender — ver o comentário do `Provider` em
 * `superficie-otimista.tsx` sobre o boundary), então `?painel=mcps` nasce na
 * tela de MCPs como antes. `painel=mcps` = MCPs; `painel=conversas` = o
 * Histórico (F9 das conversas, 01/10); qualquer outro valor = detalhes.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';

import { levaSoNoCliente } from './rede-de-navegacao';
import { cliqueSimples } from './superficie-otimista';
import { useHrefDoPainel } from './use-href-do-painel';

export function VistaDaGaveta({ detalhes, mcps, conversas }: { detalhes: ReactNode; mcps: ReactNode; conversas: ReactNode }) {
  const painel = useSearchParams()?.get('painel');
  return <>{painel === 'mcps' ? mcps : painel === 'conversas' ? conversas : detalhes}</>;
}

/** Link entre as visões da gaveta (detalhes ⇄ MCPs ⇄ Histórico). Empilha como o `<Link>`
 *  de antes — o voltar do navegador desfaz a troca de visão —, mas sem ir ao
 *  servidor. Sem JS, ou com modificador, é o `<Link>` de sempre. */
export function LinkDaGaveta({
  href: hrefRecebido,
  className,
  style,
  children,
  ...aria
}: {
  href: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  'aria-label'?: string;
}) {
  const href = useHrefDoPainel(hrefRecebido);
  return (
    <Link
      href={href}
      onClick={(e) => {
        if (!cliqueSimples(e)) return;
        if (levaSoNoCliente(window.history, href, window.location.href, false)) e.preventDefault();
      }}
      className={className}
      style={style}
      {...aria}
    >
      {children}
    </Link>
  );
}
