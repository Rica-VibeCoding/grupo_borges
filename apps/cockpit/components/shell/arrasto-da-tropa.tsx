/**
 * O arrasto da tropa — alça, alvo de soltura e o traço que mostra onde cai.
 *
 * Ordem do Rica (17/08): *"eu quero poder arrastar eles como se fosse um
 * kanban, para cima, para baixo"*. A posição da lista era ditada por um array
 * literal em `lib/ordena-tropa.ts` desde 11/08; agora ela é dele.
 *
 * SEGUNDA VERSÃO (17/08) — A LINHA INTEIRA ARRASTA. A primeira punha o gesto
 * numa alça de seis pontos à direita. O Rica testou no iPhone e o resultado
 * está filmado: ele não achava a alça, o dedo caía no link, e daí saíam os
 * dois defeitos — o menu "Abrir em nova guia / Copiar link" e uma bolha que
 * arrastava sem reordenar nada. Quando enfim reparou nos pontinhos, arrastou
 * de primeira. O pedido dele foi então estético: *"eu pensei que eu poderia
 * clicar direto no card sem ter esses pontinhos"*.
 *
 * As quatro decisões desta versão, cada uma com fonte em `docs/pesquisa-drag-ios.md`:
 *
 * 1. **SEM `dragHandle` — a linha inteira arrasta.** A doc da própria lib:
 *    *"By default, the entire `draggable` acts as a drag handle"*, e o card do
 *    exemplo oficial de board registra `draggable({element})` puro. A guideline
 *    manda alça só quando o item tem outras partes interativas, e mostra a
 *    saída como `:hover` — que **não existe no toque**. Alça que aparece no
 *    hover é alça invisível pra sempre no iPhone: exatamente o que aconteceu.
 *
 * 2. **NADA de `touch-action: none`.** Esta lib é o drag and drop NATIVO do
 *    HTML5, não Pointer Events: `touch-action` não aparece uma única vez no
 *    repositório dela. Era receita herdada do dnd-kit. Numa alça de 24px não
 *    fazia mal; na linha inteira mataria a rolagem da coluna no dedo.
 *
 * 3. **`draggable={false}` no `<a>` é o que conserta o defeito filmado.**
 *    Links nascem arrastáveis, e quando o gesto sai do link o `event.target`
 *    do `dragstart` é o `<a>`, que não está no registro da lib — ela devolve
 *    sem fazer nada (está no fonte dela, `element-adapter.js`). Com o atributo
 *    em `false` o gesto sobe pro `<li>`, que é quem está registrado. O CSS
 *    `-webkit-user-drag` NÃO resolve: o caniuse marca `n` no iOS em toda
 *    versão até a 26.5. Fica só como cinto pro macOS.
 *
 * 4. **O TRAÇO ENTRE AS LINHAS, NÃO O REALCE DA LINHA.** Realçar o item sob o
 *    dedo diz "vai trocar com este"; o traço na borda diz "vai parar aqui", que
 *    é a pergunta real de quem reordena. Sai do `attachClosestEdge`, então o
 *    lado que acende é a metade em que o dedo está, não o item inteiro.
 *
 * O que continua sendo toque-e-segure: o iOS exige meio segundo de pressão pra
 * iniciar arrasto e não expõe API pra encurtar isso. É do sistema, não nosso.
 */
'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
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

/**
 * O que todo `<a>` de dentro de uma linha arrastável precisa vestir. As duas
 * formas de linha (viva e dormindo) usam isto — é uma peça só porque errar num
 * lugar e acertar no outro devolveria o bug em metade da lista.
 *
 * Vai como `style` e não como classe porque `-webkit-touch-callout` não tem
 * utilitário no Tailwind e inventar um só pra isso seria pior de achar depois.
 */
export const ESTILO_LINK_QUE_NAO_ROUBA_O_GESTO: CSSProperties = {
  // Mata o menu "Abrir em nova guia / Copiar link" que o iOS abre no
  // toque-e-segure. Sozinho não basta desde o iOS 15 — daí o `userSelect`.
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
  // Cinto do macOS. No iOS não faz nada (caniuse marca `n` até a 26.5); quem
  // resolve lá é o atributo `draggable={false}` no próprio `<a>`.
  WebkitUserDrag: 'none',
} as CSSProperties;

type Arrasto = {
  liRef: RefObject<HTMLLIElement | null>;
  /** A própria linha está sendo carregada agora. */
  arrastando: boolean;
  /** Em qual borda desta linha o traço deve aparecer, se em alguma. */
  borda: BordaAlvo;
};

export function usaArrastoDaLinha(slug: string): Arrasto {
  const liRef = useRef<HTMLLIElement | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [borda, setBorda] = useState<BordaAlvo>(null);

  useEffect(() => {
    const li = liRef.current;
    if (!li) return;

    return combine(
      draggable({
        // Sem `dragHandle`: a linha inteira é a alça. A alça de teclado (`alca`)
        // vive dentro dela e não precisa ser declarada — declará-la excluiria o
        // resto da linha do gesto, que é justamente o que se quer desfazer.
        element: li,
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

  return { liRef, arrastando, borda };
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
 * O caminho de teclado. Já não desenha nada: quem arrasta com o dedo ou com o
 * ponteiro pega a linha inteira, e o Rica pediu o visual sem os pontinhos.
 *
 * Continua existindo porque arrastar não é um gesto que todo mundo consegue
 * fazer, e a Pragmatic não traz reordenação por teclado pronta. O botão é
 * invisível até receber foco — o padrão do "pular para o conteúdo": ninguém
 * vê, quem navega por Tab encontra, e as setas movem a linha.
 *
 * `w-px h-px` em vez de `display:none` ou `width:0`: elemento sem caixa não
 * recebe foco, e aí o caminho de teclado deixaria de existir de fato.
 */
export function AlcaDeArraste({
  nomeDoAgente,
  aoMover,
}: {
  nomeDoAgente: string;
  aoMover: (direcao: -1 | 1) => void;
}) {
  const [comFoco, setComFoco] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Mover ${nomeDoAgente} na lista`}
      onFocus={() => setComFoco(true)}
      onBlur={() => setComFoco(false)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        aoMover(e.key === 'ArrowUp' ? -1 : 1);
      }}
      className="absolute right-0 top-0 flex items-center justify-center overflow-hidden"
      style={
        comFoco
          ? {
              // Ao ganhar foco vira um alvo de verdade: 44px é o mínimo da
              // Apple e da WCAG 2.5.5 (a régua de 24px da Atlassian só vale
              // para alça exclusiva, que esta deixou de ser).
              width: '44px',
              height: '44px',
              color: 'var(--ck-text-primary)',
              outline: '2px solid var(--ck-text-primary)',
              borderRadius: 'var(--ck-radius-2, 6px)',
              background: 'var(--ck-bg-elevated, transparent)',
            }
          : { width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' }
      }
    >
      <PontosDaAlca />
    </button>
  );
}

/** Seis pontos — o desenho que a categoria inteira usa para dizer "me puxe".
 *  Só aparece sob foco de teclado; `currentColor` para herdar a cor do botão. */
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
