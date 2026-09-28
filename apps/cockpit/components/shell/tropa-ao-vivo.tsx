'use client';

import { usePathname } from 'next/navigation';
import { useLayoutEffect, useOptimistic } from 'react';

import { preaqueceConversa } from '@/lib/preaquece-conversa';
import { trocandoDeAgente } from '@/lib/troca-de-agente';
import { preaquecePainel } from './sincronizacao-painel';
import { usaFrota } from './frota-provider';
import { usaNavegacaoDaTropa } from './superficie-otimista';
import { Tropa, type EscolheAgente } from './tropa';

type TropaAoVivoProps = {
  /** Fallback para usos fora de uma rota `/agente/[slug]`, como a `/`. */
  slugSelecionado?: string;
  agora: number;
  compacta?: boolean;
};

function TropaComSlug({
  slugSelecionado,
  agora,
  compacta = false,
  aoEscolher,
}: TropaAoVivoProps & { aoEscolher?: EscolheAgente }) {
  const { agents } = usaFrota();
  return (
    <Tropa
      agents={agents}
      slugSelecionado={slugSelecionado}
      agora={agora}
      compacta={compacta}
      aoEscolher={aoEscolher}
    />
  );
}

/** Sem `<Suspense>`: `usePathname` não suspende (quem suspende é
 *  `useSearchParams`, e só quando há prerender estático para adiar). O boundary
 *  que estava aqui repetia a tropa inteira no fallback e o HTML do SSR saía com
 *  ela desenhada duas vezes — junto com os dois providers do
 *  `superficie-otimista`, dava oito cópias de cada agente num HTML de 251 KB. */
export function TropaAoVivo(props: TropaAoVivoProps) {
  const pathname = usePathname();
  // `/conversa/{slug}` é o mesmo agente, com o pager na voz (fase 3): a tropa segue acesa nele.
  const prefixo = ['/agente/', '/conversa/'].find((p) => pathname.startsWith(p));
  const slugDaRota = prefixo ? pathname.slice(prefixo.length).split('/')[0] : undefined;
  const slugDaUrl = slugDaRota || props.slugSelecionado;

  /**
   * A escolha de agente responde ao TOQUE, não à volta do servidor — 12/08.
   *
   * O item era `<Link>` seco e o `selecionado` vinha do `usePathname`, que só
   * muda quando a navegação COMMITA. Medido na 3008 com screencast do CDP
   * (passo de 40ms), tocando num agente: os primeiros **299ms** a tela é pixel
   * a pixel a anterior — nada nela sabe que houve um toque —, e só então o
   * `loading.tsx` pinta a tela vazia por mais 500ms. O Rica descreveu os dois
   * juntos como *"ele pisca, refaz a tela"*.
   *
   * O `loading.tsx` nunca cobriu esse primeiro trecho: ele entra DEPOIS dele.
   * O vão é commit de navegação + hidratação + pintura, não servidor — o RSC
   * desta rota responde em 9ms (p50, 20 amostras, load 4,16).
   *
   * Mesma mecânica das outras superfícies deste arquivo: `useOptimistic` sobre
   * o valor da URL, virado dentro da transição que carrega o `router.push`.
   * Navegação que morre reverte sozinha pro slug da rota.
   */
  const [slugOtimo, marcaSlug] = useOptimistic(slugDaUrl);
  const navegacao = usaNavegacaoDaTropa();

  // O palco que sai apaga enquanto a troca voa (`lib/troca-de-agente.ts`). O
  // palco não é filho da tropa — mora na outra metade do `AppShell` —, então o
  // recado vai por atributo no `<html>`, como o `data-voo` do envio. Efeito de
  // LAYOUT: acende no mesmo quadro do toque e apaga no mesmo commit em que a
  // página nova monta, sem um quadro do palco novo esmaecido. A limpeza do
  // efeito cobre a tropa que desmonta no meio (a da raiz, ao chegar no agente).
  const trocando = trocandoDeAgente(slugOtimo, slugDaUrl);
  useLayoutEffect(() => {
    if (!trocando) return;
    const raiz = document.documentElement;
    raiz.dataset.trocaAgente = '';
    return () => {
      delete raiz.dataset.trocaAgente;
    };
  }, [trocando]);

  return (
    <TropaComSlug
      {...props}
      slugSelecionado={slugOtimo}
      aoEscolher={
        navegacao
          ? (slug, href) => {
              // A CONVERSA COMEÇA A CHEGAR AGORA, não quando a navegação
              // commitar. Antes o `EventSource` nascia dentro do feed, que só
              // monta depois do commit — servidor e cliente em série. Ver
              // `lib/preaquece-conversa.ts` para o vão medido.
              preaqueceConversa(slug);
              // O mesmo para o painel do chip do motor: ele nasce com dropdown.
              preaquecePainel(slug);
              // `false` fecha a gaveta no celular. No desktop a faixa é fundo
              // permanente e o `data-aberto` dela não é lido — mesma chamada,
              // sem efeito colateral. Ver `GavetaNav`.
              navegacao.ir(href, false, () => marcaSlug(slug));
            }
          : undefined
      }
    />
  );
}
