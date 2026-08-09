/**
 * Superfícies otimistas — o toque abre ANTES da navegação voltar.
 *
 * Vale pras DUAS superfícies sobrepostas do celular: o painel de detalhes
 * (direita) e a tropa (esquerda). Nasceu só pro painel em 30/07; a tropa entrou
 * em 02/08, e foi o Rica quem viu, testando: *"a sidebar demora um pouquinho
 * mais para abrir, para começar o movimento — porque ela traz mais dados ou é
 * alguma configuração?"*. Nem uma coisa nem outra: ela era a última superfície
 * ainda esperando o servidor. Medido lado a lado na :3008 (viewport de celular,
 * build de produção): o painel começa a se mover em **271ms**, a tropa em
 * **618ms**, e os 618 são exatamente a ida e volta (a URL chegava em 630ms). Na
 * rede dele, pelo túnel, é a mesma espera de 2,0–2,7s que motivou esta peça.
 *
 * O painel de detalhes mora na URL (decisão nº 1 do `app-shell.tsx`) e a
 * página é `force-dynamic`: medido com Playwright na :3008 (30/07), do clique
 * até o `data-aberto` virar iam **2,0–2,7s** de ida e volta ao servidor, e só
 * então a animação de 200ms do `.ck-surge` corria. O Rica pegou ao vivo:
 * *"demora muito para abrir"*. Nenhum ajuste de duração ou curva do CSS
 * resolveria — a demora era ANTES da animação existir.
 *
 * A saída NÃO é tirar o painel da URL (deep-link do Telegram, refresh e botão
 * voltar do Android continuam valendo). É inverter a ordem dos eventos: como
 * o painel fica SEMPRE montado (commit do `.ck-surge`), o clique vira
 * `data-aberto` no mesmo frame por `useOptimistic`, e o `router.push` rola na
 * MESMA transição só pra URL alcançar a tela. Enquanto a transição está
 * pendente o valor otimista manda; quando o payload chega, a prop do servidor
 * confirma o mesmo valor e nada pisca. Navegação falhou? O otimista reverte
 * sozinho pro valor da URL.
 *
 * Sem JavaScript nada aqui muda: os três gatilhos (botão do chrome, véu e o
 * `×` do painel) continuam `<Link>` de verdade — o `onClick` só existe depois
 * da hidratação, e clique com modificador (ctrl/cmd, abrir noutra aba) passa
 * reto pro comportamento padrão do browser.
 *
 * Quem renderiza fora de um `PainelProvider` recebe `null` do contexto e cai
 * no valor do servidor — o comportamento de antes desta peça, intacto.
 */
'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  useContext,
  useOptimistic,
  useTransition,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { IconeMenu, IconePainel } from './icones';

type SuperficieCtx = {
  aberto: boolean;
  /** Vira a superfície na hora e empurra a URL atrás. `abrir` é explícito —
   *  cada gatilho sabe pra qual lado está indo; toggle por negação seria
   *  ambíguo com dois cliques rápidos. */
  ir: (href: string, abrir: boolean) => void;
};

/** Quanto se espera pela navegação do roteador antes de apelar pro navegador.
 *  1,2s é folgado pra uma navegação que normalmente é instantânea (a URL troca
 *  no mesmo frame do otimista) e curto o bastante pra não parecer travamento. */
const LIMITE_NAVEGACAO_MS = 1_200;

/** Duas superfícies, dois contextos SEPARADOS — de propósito. Painel e tropa
 *  abrem e fecham independentes (dá pra estar com a tropa aberta e tocar no
 *  painel), e um contexto só forçaria um estado compartilhado que a URL não tem.
 *  O preço é um provider a mais na árvore; o ganho é que nenhuma abertura mexe
 *  na outra. */
function criaSuperficie(parametro: 'nav' | 'painel') {
  const Ctx = createContext<SuperficieCtx | null>(null);

  /** O `AppShell` envolve a árvore nisto. Rota que não tem a superfície
   *  simplesmente não consome o contexto, e o provider custa um nó e nada
   *  além. */
  /** SEM `<Suspense>` em volta, e isso é medido, não gosto: o fallback tinha de
   *  repetir `{children}`, e o HTML do SSR saía com a árvore inteira DUAS vezes
   *  por boundary. Com os dois providers mais o da tropa, cada agente aparecia
   *  **oito vezes** (2³) no HTML de 251 KB — a tropa era desenhada oito vezes
   *  para o cliente descartar sete.
   *
   *  O boundary não fazia falta porque a rota é `force-dynamic`: `useSearchParams`
   *  só suspende quando há prerender estático para adiar, e aqui não há. Quem
   *  reintroduzir prerender nesta rota precisa reintroduzir o boundary junto —
   *  e aí o fallback tem de ser leve, nunca `{children}`. */
  function Provider({ aberto, children }: { aberto: boolean; children: ReactNode }) {
    const searchParams = useSearchParams();
    const abertoDaUrl = searchParams
      ? parametro === 'nav'
        ? searchParams.get('nav') === 'aberto'
        : searchParams.get('painel') !== null && searchParams.get('painel') !== ''
      : aberto;
    const router = useRouter();
    const [, emTransicao] = useTransition();
    const [abertoOtimo, marcaOtimo] = useOptimistic(abertoDaUrl);

    /**
     * Rede de segurança da navegação — 02/08.
     *
     * `router.push` não devolve promessa utilizável, então não dá pra esperar
     * por ela. O que dá pra observar é o efeito: se depois de
     * `LIMITE_NAVEGACAO_MS` a URL não mudou, a navegação não aconteceu, e aí a
     * gente sai do roteador e usa o navegador. Recarrega a página — mais lento
     * que o otimista, e infinitamente melhor que um botão que não faz nada.
     *
     * Cobre o caso da aba velha depois que o app foi reconstruído: o
     * `preventDefault()` dos gatilhos mata o plano B assim que a página hidrata,
     * então "JS hidratou o bastante pra interceptar, mas o chunk/RSC não
     * responde" faria o toque sumir no vazio. (Isto NÃO era o bug do iPhone —
     * aquele era altura zero, ver §17 da estética. Esta rede entrou junto na
     * caçada e fica por mérito próprio.)
     */
    const ir = (href: string, abrir: boolean) => {
      const antes = window.location.href;
      emTransicao(() => {
        marcaOtimo(abrir);
        router.push(href);
      });
      window.setTimeout(() => {
        if (window.location.href === antes) window.location.assign(href);
      }, LIMITE_NAVEGACAO_MS);
    };

    return <Ctx.Provider value={{ aberto: abertoOtimo, ir }}>{children}</Ctx.Provider>;
  }

  return { Ctx, Provider };
}

const painel = criaSuperficie('painel');
const tropa = criaSuperficie('nav');

export const PainelProvider = painel.Provider;
export const NavProvider = tropa.Provider;

/** Só o booleano, pra quem precisa reagir à abertura sem gatilhar navegação
 *  (o `BlocoDeAcoes` re-busca o `/painel` quando a gaveta ABRE — com o valor
 *  da URL essa reação chegaria ~2s tarde, o atraso que o otimista matou).
 *  Fora do provider devolve o `fallback` (o valor do servidor). */
export function usePainelAberto(fallback: boolean): boolean {
  return useContext(painel.Ctx)?.aberto ?? fallback;
}

/** Clique de teclado/mouse primário SEM modificador é o que a gente intercepta;
 *  ctrl/cmd/shift/click do meio é "abrir noutra aba" e segue pro browser. */
function cliqueSimples(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** O botão do chrome (`BarraDeTelas`). Vira o painel na hora e reflete o
 *  estado otimista no `data-selecionado` — senão o painel abriria com o
 *  botão ainda pintado de fechado por ~2s. */
export function BotaoPainel({
  hrefAbrir,
  hrefFechar,
  aberto,
}: {
  hrefAbrir: string;
  hrefFechar: string;
  /** Valor do servidor — usado no SSR e como fallback fora do provider. */
  aberto: boolean;
}) {
  const ctx = useContext(painel.Ctx);
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
              ctx.ir(href, !abertoReal);
            }
          : undefined
      }
      aria-label={abertoReal ? 'Fechar detalhes' : 'Abrir detalhes do agente'}
      data-selecionado={abertoReal ? 'true' : 'false'}
      className="ck-veil flex shrink-0 items-center justify-center"
      style={{
        minWidth: 'var(--ck-touch-min)',
        minHeight: 'var(--ck-touch-min)',
        marginRight: 'calc(var(--ck-space-3) * -1)',
        borderRadius: 'var(--ck-radius-chip)',
        color: 'var(--ck-text-secondary)',
      }}
    >
      <IconePainel tamanho={18} />
    </Link>
  );
}

/** Link de fechar otimista, pros gatilhos que NÃO precisam de `data-aberto`
 *  (o `×` do painel). Fora do provider é um `<Link>` comum. */
export function LinkFechaPainel({
  href,
  rotulo,
  className,
  style,
  children,
}: {
  href: string;
  rotulo: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const ctx = useContext(painel.Ctx);

  return (
    <Link
      href={href}
      onClick={
        ctx
          ? (e) => {
              if (!cliqueSimples(e)) return;
              e.preventDefault();
              ctx.ir(href, false);
            }
          : undefined
      }
      aria-label={`Fechar ${rotulo}`}
      className={className}
      style={style}
    >
      {children}
    </Link>
  );
}

/** Véu + aside do painel. O conteúdo (`children`) chega pronto do servidor e
 *  permanece montado; o que o cliente faz é virar `data-aberto`/`inert` sem
 *  esperar a navegação. O `inert` virando no mesmo frame também FECHA a
 *  janela em que o conteúdo sumindo continuava alcançável por Tab.
 *
 *  O véu NÃO escurece mais — ordem do Rica (30/07, via Pavan, com prints):
 *  *"tira a função que escurece o resto da tela quando a gaveta/painel
 *  aparece"*. Ele continua existindo só como alvo de clique pra fechar (o
 *  `ck-surge-veu` o esconde com `visibility: hidden` quando fechado, então fora
 *  do painel aberto ele não intercepta nada). Sem a cor, o clique de fora
 *  fechando é o MESMO comportamento de antes — só perdeu o aviso visual. Se
 *  o Rica quiser o fundo INTERATIVO (clicar no chat com o painel aberto,
 *  como na referência), é remover este Link de vez. */
export function GavetaPainel({
  fecharHref,
  rotulo,
  aberto,
  children,
}: {
  fecharHref: string;
  rotulo: string;
  /** Valor do servidor — usado no SSR e como fallback fora do provider. */
  aberto: boolean;
  children: ReactNode;
}) {
  const ctx = useContext(painel.Ctx);
  const abertoReal = ctx?.aberto ?? aberto;

  return (
    <>
      {/* O `data-aberto` mora no próprio Link: o seletor do `.ck-surge-veu`
          casa classe E atributo no MESMO elemento — um wrapper em volta
          quebraria a animação de entrada/saída do véu. */}
      <Link
        href={fecharHref}
        onClick={
          ctx
            ? (e) => {
                if (!cliqueSimples(e)) return;
                e.preventDefault();
                ctx.ir(fecharHref, false);
              }
            : undefined
        }
        aria-label={`Fechar ${rotulo}`}
        data-aberto={String(abertoReal)}
        className="ck-surge-veu fixed inset-0"
        style={{ zIndex: 'var(--ck-z-drawer)' }}
      />

      <aside
        aria-label={rotulo}
        data-aberto={String(abertoReal)}
        inert={!abertoReal}
        className="ck-surge ck-flutua flex min-h-0 flex-col overflow-hidden"
        style={{ background: 'var(--ck-surface-nav)' }}
      >
        {children}
      </aside>
    </>
  );
}

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
              ctx.ir(href, !abertoReal);
            }
          : undefined
      }
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
        ctx.ir(fecharHref, false);
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
