/**
 * BarraDeTelas — o chrome do topo (§12.3 e §13, correção do menu à esquerda).
 *
 * REDESENHO DE 28/09 (mockup aprovado pelo Rica): o pill "Chat" saiu — com um
 * destino só ele era rótulo, não controle — e a faixa virou
 *
 *   [≡] [retrato · nome / estado] ............ [pílula de tokens]
 *
 * A pílula é a mesma que morava no composer — tokens, sem % e sem teto
 * (ordem do Rica de 16/08). O texto abaixo
 * descreve o desenho anterior e fica como histórico das decisões que seguem
 * valendo (fundo sem cor própria, Server Component, `≡` só no celular).
 *
 * Três controles na mesma faixa, como na referência do Codex desktop:
 *
 *   [≡ tropa]   [ pill de telas ]   [cápsula do agente]
 *
 * A barra enxuta (fase 3, pedido do Rica em 27/09): o microfone e o ⧉ saíram
 * da vista. A conversa por voz abre pelo gesto no chat; o painel, pela cápsula
 * do agente, e fecha pelo × dele ou tocando fora. O link da voz segue no
 * teclado e no leitor de tela, fora da vista até ganhar foco.
 *
 * A cápsula mora na PONTA DIREITA (pedido do Rica em 27/09: *"ela também abre
 * o painel"*). No celular é só a fotinho; o nome entra quando a coluna tem
 * lugar (`@container`, ver `capsula-do-agente.tsx`).
 *
 * O centro é GRID, não `justify-between`: com a cápsula entrando numa ponta em
 * 16/08, o espaço distribuído entre pontas de larguras diferentes empurrava o
 * pill pro lado, e ele deixava de ser o centro da folha. `minmax(0, 1fr)` nas
 * pontas e `auto` no meio prendem o pill no meio de verdade — e o nome longo
 * trunca na coluna dele em vez de roubar o lugar de quem está ao lado.
 *
 * O `≡` some no desktop, e não é economia de pixel: lá a tropa é o fundo
 * permanente da tela (`app-shell.tsx`), então o botão abriria o que já está
 * aberto. Botão que não faz nada é a mesma mentira de UI da §9.
 *
 * A barra NÃO tem cor própria: ela é o topo da folha e vive sobre o palco.
 * Pintá-la de `--ck-surface-nav`, como era até aqui, fazia o topo da folha ter
 * exatamente a cor da mesa em volta — o recorte sumia justo na borda onde o
 * fio de luz devia aparecer. Cada superfície é uniforme; o que separa uma da
 * outra é a forma.
 *
 * A barra é Server Component e os controles continuam `<Link>` por baixo —
 * a regra 1 do `app-shell.tsx` vale aqui também: o que está aberto mora na
 * URL (`?nav=aberto`, `?painel=...`), nunca em estado de cliente. Refresh,
 * deep link do Telegram e botão voltar do Android continuam funcionando de
 * graça. As peças de cliente são o `≡` e a cápsula (`superficie-otimista.tsx`):
 * a abertura é otimista — vira a superfície no mesmo frame e empurra a
 * navegação atrás; sem JS elas são o Link de sempre.
 *
 * A PILL É HONESTA (§9 — botão que não leva a lugar nenhum é mentira de UI):
 * hoje só existe UM destino de produto (o chat do agente). A fase 2 (kanban)
 * não existe — `docs/cockpit-v2-ESTADO.md` §4.1 — então a lista abaixo tem
 * um item só, e o componente aceita mais sem precisar ser redesenhado quando
 * ela chegar. Com um item só a pill não tem o que alternar: ela ainda assim
 * ocupa o mesmo lugar da referência, porque é o rótulo de ONDE você está, e
 * ganha companhia no dia em que houver pra onde ir.
 */
import Link from 'next/link';

import { CapsulaDoAgente } from './capsula-do-agente';
import { IconeMicrofone } from './icones';
import { PilulaDeTokens } from './pilula-de-tokens';
import { BotaoNav } from './superficie-otimista';

type BarraDeTelasProps = {
  /** Quem está do outro lado da conversa — retrato, primeiro nome e estado, à
   *  esquerda da barra. */
  agente: { slug: string; nome: string };
  /** Os DOIS destinos do `≡`, pelo mesmo motivo do painel: o `BotaoNav` escolhe
   *  conforme o estado otimista, que pode correr à frente da URL. */
  abrirNavHref: string;
  fecharNavHref: string;
  navAberta: boolean;
  /** Para onde a cápsula leva: a gaveta de detalhes aberta. */
  hrefAbrirPainel: string;
};

export function BarraDeTelas({
  agente,
  abrirNavHref,
  fecharNavHref,
  navAberta,
  hrefAbrirPainel,
}: BarraDeTelasProps) {
  return (
    <div
      className="flex shrink-0 items-center"
      style={{
        gap: 'var(--ck-space-2)',
        padding: 'var(--ck-space-2) var(--ck-space-3)',
        paddingTop: 'calc(var(--ck-space-2) + var(--ck-safe-top))',
        paddingRight: 'calc(var(--ck-space-3) + var(--ck-safe-right))',
        paddingLeft: 'calc(var(--ck-space-3) + var(--ck-safe-left))',
      }}
    >
      <BotaoNav hrefAbrir={abrirNavHref} hrefFechar={fecharNavHref} aberto={navAberta} />
      <Link
        href={`/conversa/${agente.slug}`}
        aria-label={`Começar conversa por voz com ${agente.nome}`}
        className="ck-veil sr-only flex shrink-0 items-center justify-center focus-visible:not-sr-only"
        style={{
          minWidth: 'var(--ck-touch-min)',
          minHeight: 'var(--ck-touch-min)',
          borderRadius: 'var(--ck-radius-chip)',
          color: 'var(--ck-text-secondary)',
        }}
      >
        <IconeMicrofone tamanho={18} />
      </Link>

      <div className="flex min-w-0 flex-1 items-center">
        <CapsulaDoAgente slug={agente.slug} nome={agente.nome} href={hrefAbrirPainel} />
      </div>

      <PilulaDeTokens agentSlug={agente.slug} />
    </div>
  );
}
