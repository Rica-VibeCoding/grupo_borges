/**
 * O arrasto da tropa — alça, alvo de soltura e o traço que mostra onde cai.
 *
 * Ordem do Rica (17/08): *"eu quero poder arrastar eles como se fosse um
 * kanban, para cima, para baixo"*. A posição da lista era ditada por um array
 * literal em `lib/ordena-tropa.ts` desde 11/08; agora ela é dele.
 *
 * Três decisões que o terreno impôs, todas medidas antes de escrever:
 *
 * 1. **ALÇA, NÃO A LINHA INTEIRA.** Cada item da tropa é um `<Link>` que
 *    navega, e o Rica usa isto no iPhone: se a linha toda arrastasse, todo
 *    toque viraria uma disputa entre abrir o agente e mover a linha, e todo
 *    deslize pra rolar a coluna viraria um arrasto acidental. A alça é o único
 *    ponto com `touch-action: none` — aplicá-lo na linha mataria a rolagem, que
 *    é o anti-padrão mais relatado da categoria
 *    (`docs/pesquisa-sidebar-drag-reorder.md`).
 *
 * 2. **`WebkitTouchCallout: none`.** Sem isto o iOS abre o menu de contexto no
 *    press-and-hold e o `pointermove` some no meio do gesto. O padrão já estava
 *    escrito na casa, no botão de voz do composer (`composer.tsx`) — é cópia
 *    dele, não invenção.
 *
 * 3. **O TRAÇO ENTRE AS LINHAS, NÃO O REALCE DA LINHA.** Realçar o item sob o
 *    dedo diz "vai trocar com este"; o traço na borda diz "vai parar aqui", que
 *    é a pergunta real de quem reordena. Sai do `attachClosestEdge`, então o
 *    lado que acende é a metade em que o dedo está, não o item inteiro.
 *
 * A biblioteca é a `@atlaskit/pragmatic-drag-and-drop` (Apache-2.0): a doc dela
 * declara suporte completo a Safari no iOS, e o `@dnd-kit/core` estável está
 * parado desde dezembro de 2024. O playbook do repo já tinha chegado nessa
 * escolha em outra ocasião (`docs/cockpit-v2-playbook.md`).
 */
'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import {
  attachClosestEdge,
  extractClosestEdge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';

import type { BordaAlvo } from '@/lib/ordem-arrastada';

/** Marca os dados do arrasto como sendo da tropa: o monitor e o alvo de
 *  soltura recusam qualquer coisa que não tenha isto. Sem a marca, um arrasto
 *  de arquivo de fora da janela entraria como reordenação. */
export const TIPO_ARRASTO = 'agente-da-tropa';

type Arrasto = {
  liRef: RefObject<HTMLLIElement | null>;
  alcaRef: RefObject<HTMLButtonElement | null>;
  /** A própria linha está sendo carregada agora. */
  arrastando: boolean;
  /** Em qual borda desta linha o traço deve aparecer, se em alguma. */
  borda: BordaAlvo;
};

export function usaArrastoDaLinha(slug: string): Arrasto {
  const liRef = useRef<HTMLLIElement | null>(null);
  const alcaRef = useRef<HTMLButtonElement | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [borda, setBorda] = useState<BordaAlvo>(null);

  useEffect(() => {
    const li = liRef.current;
    const alca = alcaRef.current;
    if (!li || !alca) return;

    return combine(
      draggable({
        element: li,
        dragHandle: alca,
        getInitialData: () => ({ tipo: TIPO_ARRASTO, slug }),
        onDragStart: () => setArrastando(true),
        onDrop: () => setArrastando(false),
      }),
      dropTargetForElements({
        element: li,
        // Linha não é alvo de si mesma: sem isto o traço acende embaixo do
        // próprio item que está sendo carregado.
        canDrop: ({ source }) => source.data.tipo === TIPO_ARRASTO && source.data.slug !== slug,
        getData: ({ input, element }) =>
          attachClosestEdge({ slug }, { element, input, allowedEdges: ['top', 'bottom'] }),
        onDrag: ({ self }) => setBorda(extractClosestEdge(self.data) as BordaAlvo),
        onDragLeave: () => setBorda(null),
        onDrop: () => setBorda(null),
      }),
    );
  }, [slug]);

  return { liRef, alcaRef, arrastando, borda };
}

/**
 * O traço que diz onde a linha vai parar.
 *
 * `position: absolute` sobre a borda, e não `border-top` na linha: borda de
 * verdade empurraria o conteúdo 2px pra baixo a cada movimento do dedo, e a
 * lista inteira tremeria enquanto se arrasta.
 */
export function TracoDeSoltura({ borda }: { borda: BordaAlvo }) {
  if (!borda) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-0 right-0"
      style={{
        [borda]: '-1px',
        height: '2px',
        borderRadius: '1px',
        background: 'var(--ck-text-primary)',
      }}
    />
  );
}

/**
 * A alça. Fica FORA do `<Link>` de propósito — dentro dele, cada toque para
 * pegar a linha navegaria para o agente antes de o arrasto começar.
 *
 * As setas movem a linha sem arrastar: quem chega aqui pelo teclado não tem
 * gesto de ponteiro, e a Pragmatic não traz reordenação por teclado pronta.
 * É a mesma `novaOrdem` do arrasto — um caminho só, duas entradas.
 */
export function AlcaDeArraste({
  ref,
  nomeDoAgente,
  aoMover,
}: {
  ref: RefObject<HTMLButtonElement | null>;
  nomeDoAgente: string;
  aoMover: (direcao: -1 | 1) => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={`Mover ${nomeDoAgente} na lista`}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        aoMover(e.key === 'ArrowUp' ? -1 : 1);
      }}
      className="flex shrink-0 cursor-grab items-center justify-center"
      style={{
        width: 'var(--ck-space-5)',
        alignSelf: 'stretch',
        color: 'var(--ck-text-secondary)',
        // Os três juntos são o que faz o gesto sobreviver no iPhone: sem
        // `touchAction:none` o Safari rola a coluna em vez de arrastar; sem os
        // outros dois ele abre menu de contexto e seleciona texto no meio do
        // arrasto. Copiado do botão de voz do composer.
        touchAction: 'none',
        userSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      <PontosDaAlca />
    </button>
  );
}

/** Seis pontos — o desenho que a categoria inteira usa para dizer "me puxe".
 *  `currentColor` para herdar o esmaecimento da linha de quem dorme. */
function PontosDaAlca() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden focusable="false">
      {[4, 8, 12].map((y) =>
        [3, 7].map((x) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill="currentColor" opacity="0.55" />
        )),
      )}
    </svg>
  );
}
