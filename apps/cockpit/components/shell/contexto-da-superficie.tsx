'use client';

/**
 * O estado otimista de cada superfície: a fábrica, os dois providers e quem os
 * lê. Saiu de `superficie-otimista.tsx` (02/10) com os comentários; o porquê da
 * peça inteira segue no cabeçalho de lá, e os gatilhos também.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useOptimistic,
  useRef,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { ContextoConfiguracaoConversa } from '../conversa/contexto-configuracao-conversa';

import { criaRedeDeNavegacao, levaAUrl, levaSoNoCliente, type RedeDeNavegacao } from './rede-de-navegacao';

type SuperficieCtx = {
  aberto: boolean;
  /** Vira a superfície na hora e empurra a URL atrás. `abrir` é explícito —
   *  cada gatilho sabe pra qual lado está indo; toggle por negação seria
   *  ambíguo com dois cliques rápidos.
   *
   *  `tambem` roda DENTRO da mesma transição. Existe por causa da escolha de
   *  agente na tropa, que precisa fechar a gaveta e acender o item tocado no
   *  mesmo quadro: dois `useOptimistic` em transições separadas terminam em
   *  instantes diferentes, e o que termina primeiro reverte sozinho — o item
   *  apagaria e reacenderia no meio da navegação.
   *
   *  `substitui` troca a entrada do histórico em vez de empilhar (`levaAUrl`). */
  ir: (href: string, abrir: boolean, tambem?: () => void, substitui?: boolean) => void;
};

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
    const [navegando, emTransicao] = useTransition();
    const [abertoOtimo, marcaOtimo] = useOptimistic(abertoDaUrl);

    /** O pendente do React lido no INSTANTE do exame. A rede olha a URL 1,2s
     *  depois do toque, e o valor de então é o que separa "navegação em voo" de
     *  "navegação que morreu" — capturar no fechamento daria sempre `true`. */
    const navegandoRef = useRef(navegando);
    useEffect(() => {
      navegandoRef.current = navegando;
    }, [navegando]);

    /**
     * Rede de segurança da navegação — 02/08, consertada em 12/08.
     *
     * `router.push` não devolve promessa utilizável, então não dá pra esperar
     * por ela. O que dá pra observar é o efeito: se a URL não mudou e a
     * transição já terminou, a navegação não aconteceu, e aí a gente sai do
     * roteador e usa o navegador. Recarrega a página — mais lento que o
     * otimista, e infinitamente melhor que um botão que não faz nada.
     *
     * Cobre o caso da aba velha depois que o app foi reconstruído: o
     * `preventDefault()` dos gatilhos mata o plano B assim que a página hidrata,
     * então "JS hidratou o bastante pra interceptar, mas o chunk/RSC não
     * responde" faria o toque sumir no vazio. (Isto NÃO era o bug do iPhone —
     * aquele era altura zero, ver §5 da estética. Esta rede entrou junto na
     * caçada e fica por mérito próprio.)
     *
     * O porquê da transição entrar na conta, e o que ela conserta, está no
     * cabeçalho de `rede-de-navegacao.ts` — resumo: sem ela, navegação lenta
     * virava reload duro no caminho feliz.
     */
    const rede = useRef<RedeDeNavegacao | null>(null);
    if (rede.current === null) {
      rede.current = criaRedeDeNavegacao({
        hrefAtual: () => window.location.href,
        navegando: () => navegandoRef.current,
        recarrega: (href) => window.location.assign(href),
        agendar: (callback, atrasoMs) => window.setTimeout(callback, atrasoMs),
        cancelar: (id) => window.clearTimeout(id),
      });
    }

    // Desmontar com a rede armada deixaria um `location.assign` marcado para
    // uma tela que já saiu.
    useEffect(() => {
      const atual = rede.current;
      return () => atual?.cancela();
    }, []);

    // A URL mudou: a navegação chegou, e a rede desarma já. Esperar o exame
    // de 1,2 s mordia o gesto da tropa (27/09): tocar fora e reabrir pelo dedo
    // devolve a URL de partida (`?nav=aberto`), e a rede lia "não navegou" e
    // recarregava a página — empilhando a tela que o toque não empilhou.
    useEffect(() => rede.current?.cancela(), [searchParams]);

    const ir = (href: string, abrir: boolean, tambem?: () => void, substitui = false) => {
      let noCliente = false;
      emTransicao(() => {
        marcaOtimo(abrir);
        tambem?.();
        // Abrir/fechar gaveta e tropa não pede nada ao servidor (28/09): ver
        // `levaSoNoCliente`. Troca de agente e o resto seguem pelo roteador.
        noCliente = levaSoNoCliente(window.history, href, window.location.href, substitui);
        if (!noCliente) levaAUrl(router, href, substitui);
      });
      // A URL já mudou, na hora: não há navegação para a rede vigiar.
      if (!noCliente) rede.current?.arma(href);
    };

    return <Ctx.Provider value={{ aberto: abertoOtimo, ir }}>{children}</Ctx.Provider>;
  }

  return { Ctx, Provider };
}

export const painel = criaSuperficie('painel');
export const tropa = criaSuperficie('nav');

export function PainelProvider({ aberto, children }: { aberto: boolean; children: ReactNode }) {
  return (
    <ContextoConfiguracaoConversa>
      <painel.Provider aberto={aberto}>{children}</painel.Provider>
    </ContextoConfiguracaoConversa>
  );
}
export const NavProvider = tropa.Provider;

/** Só o booleano, pra quem precisa reagir à abertura sem gatilhar navegação
 *  (o `BlocoDeAcoes` re-busca o `/painel` quando a gaveta ABRE — com o valor
 *  da URL essa reação chegaria ~2s tarde, o atraso que o otimista matou).
 *  Fora do provider devolve o `fallback` (o valor do servidor). */
export function usePainelAberto(fallback: boolean): boolean {
  return useContext(painel.Ctx)?.aberto ?? fallback;
}

/** A navegação da tropa, pra quem precisa dela FORA dos gatilhos daqui — hoje
 *  só a escolha de agente (`tropa-ao-vivo.tsx`), que fecha a gaveta e acende o
 *  item na mesma transição. Fora do provider devolve `null` e o chamador cai no
 *  `<Link>` de sempre. */
export function usaNavegacaoDaTropa(): SuperficieCtx | null {
  return useContext(tropa.Ctx);
}

/** Clique de teclado/mouse primário SEM modificador é o que a gente intercepta;
 *  ctrl/cmd/shift/click do meio é "abrir noutra aba" e segue pro browser. */
export function cliqueSimples(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
