'use client';

// O feed do cockpit v2 — o esqueleto do G1 promovido a produto.
//
// Sem assistant-ui: o G1 mediu 33,4 ms sem a biblioteca contra 400–724,9 com
// ela, e a escala caiu de 1,81× para 1,00×. O que ficou dela foi o
// virtualizador (`@tanstack/react-virtual`), que nunca foi dela.
//
// Duas mudanças de fundo em relação ao esqueleto, e as duas são o G3:
//   1. `estimateSize` é CONSTANTE — nem a média móvel do esqueleto (que
//      deslocava tudo o que ainda não fora medido, por fora da compensação do
//      virtualizador), nem a função por item que a substituiu. Ver ALTURA_ITEM.
//   2. quando o Rica está rolado para cima, o que se preserva é o ITEM sob o
//      olho dele, não o `scrollTop` (ver `ancora.ts`).

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { ScrollArea } from '@/components/ui/scroll-area';

import { capturaAncora, estaColado, scrollTopParaAncora, type Ancora, type Faixa } from './ancora';
import { chaveDe } from './chave';
import { CorpoDoItem } from './corpo-do-item';
import type { ItemDoFeed } from './grupo-ferramentas.ts';

export type FeedProps = {
  itens: readonly ItemDoFeed[];
  lookup?: ToolResultLookup;
  /** O cartão do `/compact` lê a duração medida na máquina do agente — sem
   *  slug ele nasce estático (teste). */
  agentSlug?: string;
};

/** Itens fora da janela mantidos montados — mesmo número do esqueleto, para a
 *  medição continuar comparável. */
const SOBRA = 6;

/**
 * Altura suposta para item que ainda NÃO foi medido, em px.
 *
 * Constante de propósito, e a doc do @tanstack/react-virtual é explícita sobre
 * o porquê: "If you are dynamically measuring your elements, it's recommended
 * to estimate the largest possible size (within comfort) of your items."
 * Como este feed passa `measureElement` no envelope (mais abaixo), a estimativa
 * é DESCARTADA no primeiro render de cada item — todo trabalho gasto para
 * produzi-la é trabalho jogado fora.
 *
 * E não é pouco trabalho: `getMeasurements` percorre de `pendingMin` até
 * `count` chamando `estimateSize` em cada item não medido (virtual-core 3.17.7,
 * linha 632), e `getMeasurementOptions` zera `pendingMin` sempre que uma opção
 * de medição muda de identidade — `count` inclusive, que muda a cada flush de
 * streaming. Ou seja: ~1.280 chamadas por flush, num feed de 1.300 itens. A
 * versão anterior fazia cinco varreduras de texto por chamada; o cache em
 * WeakMap que veio depois trocou isso por um lookup, mas manteve trabalho por
 * item. A doc manda não fazer o trabalho.
 *
 * O NÚMERO veio de medição, não de palpite: `docs/cockpit-v2-medicao/
 * alturas_reais.py` colheu `offsetHeight` dos 500 itens da carga do canário e
 * os 500 medem 36 px. 44 px é o item colapsado (execução ou raciocínio
 * fechado), que cobre a carga inteira com folga e é o caminho quente da tese do
 * v2 — 82% `tool_use`, que nasce fechado. Errar aqui é barato: a medição real
 * corrige no primeiro render e o virtualizador compensa o delta. Refazer a
 * conta contra tráfego real do Rica (não contra a fixture) é o que muda este
 * número.
 */
const ALTURA_ITEM = 44;

export function Feed({ itens, lookup, agentSlug }: FeedProps) {
  const chaves = useMemo(() => itens.map(chaveDe), [itens]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const coladoRef = useRef(true);
  const ancoraRef = useRef<Ancora | null>(null);
  const contagemRef = useRef(0);
  const [temNovas, setTemNovas] = useState(false);

  // A doc pede `getItemKey` memoizado ("to avoid unnecessary recalculations"),
  // e o motivo está em virtual-core 3.17.7: ele é dependência do memo de
  // `getMeasurementOptions`, e uma arrow nova a cada render força a varredura
  // completa das medições. Ler as chaves por ref mantém a identidade fixa para
  // sempre, sem prender a função à lista.
  //
  // Ressalva honesta: durante streaming isso NÃO economiza nada, porque `count`
  // também é dependência e cresce a cada flush. O ganho é quando o Rica só rola
  // e nada chega — que é a maior parte do tempo dele olhando a tela.
  const chavesRef = useRef(chaves);
  chavesRef.current = chaves;
  const chaveDoItem = useCallback((indice: number) => chavesRef.current[indice] ?? indice, []);

  const virtualizer = useVirtualizer({
    count: itens.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ALTURA_ITEM,
    overscan: SOBRA,
    getItemKey: chaveDoItem,
  });

  const virtuais = virtualizer.getVirtualItems();

  const faixas = useCallback(
    (): Faixa[] =>
      virtualizer
        .getVirtualItems()
        .map((virtual) => ({ chave: String(virtual.key), start: virtual.start, end: virtual.end })),
    [virtualizer],
  );

  const aoRolar = useCallback(() => {
    const elemento = scrollerRef.current;
    if (!elemento) return;
    const colado = estaColado({
      scrollTop: elemento.scrollTop,
      scrollHeight: elemento.scrollHeight,
      clientHeight: elemento.clientHeight,
    });
    coladoRef.current = colado;
    if (colado) {
      ancoraRef.current = null;
      setTemNovas(false);
      return;
    }
    // Re-capturar a cada rolagem é de propósito: a âncora tem de ser o item que
    // o olho está usando AGORA, não o de quando ele saiu do fim.
    ancoraRef.current = capturaAncora(faixas(), elemento.scrollTop);
  }, [faixas]);

  const irAoFim = useCallback(() => {
    const elemento = scrollerRef.current;
    if (!elemento) return;
    coladoRef.current = true;
    ancoraRef.current = null;
    setTemNovas(false);
    elemento.scrollTop = elemento.scrollHeight;
  }, []);

  // Sem lista de dependências, de propósito: roda em TODO commit. O caso que
  // reprovou no iPhone é o texto do último item crescendo por streaming, que
  // não mexe em `itens.length` — um efeito preso ao tamanho da lista não vê
  // essa mudança e o feed descola sozinho.
  useLayoutEffect(() => {
    const elemento = scrollerRef.current;
    if (!elemento || itens.length === 0) return;

    if (itens.length > contagemRef.current && !coladoRef.current) setTemNovas(true);
    contagemRef.current = itens.length;

    if (coladoRef.current) {
      elemento.scrollTop = elemento.scrollHeight;
      return;
    }
    const ancora = ancoraRef.current;
    if (!ancora) return;
    const alvo = scrollTopParaAncora(ancora, faixas(), elemento.scrollTop);
    if (alvo !== null) elemento.scrollTop = alvo;
  });

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      {/* ScrollArea do shadcn (Radix) — 03/08, ordem do Rica: a barra sai da
          borda da COLUNA e vai para a borda da TELA. Quem rola é o viewport do
          Radix (`viewportRef`), que é onde o virtualizador, o `onScroll` e o
          `data-gate-messages` ficam pendurados. `type="always"`: a barra não
          se esconde, mas é um fio quase apagado (a cor mora no globals.css,
          `--ck-scrollbar-thumb`). Sendo overlay, ela não paga largura: nada no
          layout desloca quando ela aparece — e a gaveta, que é `fixed`, nem
          sente. */}
      <ScrollArea
        type="always"
        style={{ height: '100%' }}
        viewportRef={scrollerRef}
        viewportProps={{
          // Espalhado, não literal: o TS barra `data-*` em props de componente
          // tipadas, mas o Radix repassa ao div do viewport — e os gates de
          // teste procuram o atributo lá.
          ...{ 'data-gate-messages': '' },
          onScroll: aoRolar,
          style: {
            // O ancoramento nativo do browser não enxerga itens em `position:
            // absolute` — quem ancora aqui é `ancora.ts`, e os dois brigando
            // produzem exatamente o tranco que estamos removendo.
            overflowAnchor: 'none',
          },
        }}
      >
        {/* A coluna de leitura desceu pra DENTRO da rolagem: é ela que segura
            o `max-width` e centraliza, então o trilho da barra pode encostar
            na borda da tela sem arrastar o texto junto. O padding horizontal
            que era do scroller veio junto. */}
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
            width: '100%',
            maxWidth: 'var(--ck-read-wide)',
            margin: '0 auto',
            padding: '0 var(--ck-space-4)',
            boxSizing: 'border-box',
          }}
        >
          {virtuais.map((virtual) => {
            const item = itens[virtual.index];
            return (
              <div
                key={virtual.key}
                data-gate-message=""
                data-index={virtual.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtual.start}px)`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--ck-space-1)',
                    padding: 'var(--ck-space-2) 0',
                    // Borda de conteúdo gigante: uma linha de 200 mil caracteres
                    // sem espaço estoura a largura e leva a rolagem horizontal
                    // junto. Os renderers truncam a ALTURA; a largura é daqui.
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {item ? <CorpoDoItem item={item} lookup={lookup} agentSlug={agentSlug} /> : null}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {temNovas ? (
        <button
          type="button"
          data-gate-new-messages=""
          onClick={irAoFim}
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 'var(--ck-space-3)',
            transform: 'translateX(-50%)',
            minHeight: 'var(--ck-touch-min)',
            padding: '0 var(--ck-space-4)',
            borderRadius: 'var(--ck-radius-pill)',
            border: '1px solid var(--ck-edge-functional)',
            background: 'var(--ck-surface-raised)',
            color: 'var(--ck-text-primary)',
            fontSize: 'var(--ck-text-sm)',
          }}
        >
          mensagens novas ↓
        </button>
      ) : null}
    </div>
  );
}
