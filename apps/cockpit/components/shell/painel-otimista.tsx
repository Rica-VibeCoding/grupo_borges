/**
 * Painel otimista — o clique abre ANTES da navegação voltar.
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
import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useOptimistic,
  useTransition,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { IconePainel } from './icones';

type PainelCtx = {
  aberto: boolean;
  /** Vira o painel na hora e empurra a URL atrás. `abrir` é explícito —
   *  cada gatilho sabe pra qual lado está indo; toggle por negação seria
   *  ambíguo com dois cliques rápidos. */
  ir: (href: string, abrir: boolean) => void;
};

const Ctx = createContext<PainelCtx | null>(null);

/** Só o booleano, pra quem precisa reagir à abertura sem gatilhar navegação
 *  (o `BlocoDeAcoes` re-busca o `/painel` quando a gaveta ABRE — com o valor
 *  da URL essa reação chegaria ~2s tarde, o atraso que o otimista matou).
 *  Fora do provider devolve o `fallback` (o valor do servidor). */
export function usePainelAberto(fallback: boolean): boolean {
  return useContext(Ctx)?.aberto ?? fallback;
}

/** O `AppShell` envolve a árvore inteira nisto. Rota sem painel simplesmente
 *  não consome o contexto, e o provider custa um nó a mais e nada além. */
export function PainelProvider({ aberto, children }: { aberto: boolean; children: ReactNode }) {
  const router = useRouter();
  const [, emTransicao] = useTransition();
  const [abertoOtimo, marcaOtimo] = useOptimistic(aberto);

  const ir = (href: string, abrir: boolean) => {
    emTransicao(() => {
      marcaOtimo(abrir);
      router.push(href);
    });
  };

  return <Ctx.Provider value={{ aberto: abertoOtimo, ir }}>{children}</Ctx.Provider>;
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
  const ctx = useContext(Ctx);
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
  const ctx = useContext(Ctx);

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
 *  `ck-surge-veu` o esconde com `display: none` quando fechado, então fora do
 *  painel aberto ele não intercepta nada). Sem a cor, o clique de fora
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
  const ctx = useContext(Ctx);
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
