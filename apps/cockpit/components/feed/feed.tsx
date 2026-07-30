'use client';

// O feed do cockpit v2 — o esqueleto do G1 promovido a produto.
//
// Sem assistant-ui: o G1 mediu 33,4 ms sem a biblioteca contra 400–724,9 com
// ela, e a escala caiu de 1,81× para 1,00×. O que ficou dela foi o
// virtualizador (`@tanstack/react-virtual`), que nunca foi dela.
//
// Duas mudanças de fundo em relação ao esqueleto, e as duas são o G3:
//   1. `estimateSize` é DETERMINÍSTICA por item (ver `estimativa.ts`) — a média
//      móvel do esqueleto deslocava tudo o que ainda não fora medido, por fora
//      da compensação do virtualizador.
//   2. quando o Rica está rolado para cima, o que se preserva é o ITEM sob o
//      olho dele, não o `scrollTop` (ver `ancora.ts`).

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { RenderItem, ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { capturaAncora, estaColado, scrollTopParaAncora, type Ancora, type Faixa } from './ancora';
import { chaveDe } from './chave';
import { CorpoDoItem } from './corpo-do-item';
import { estimaAltura } from './estimativa';

export type FeedProps = {
  itens: readonly RenderItem[];
  lookup?: ToolResultLookup;
};

/** Itens fora da janela mantidos montados — mesmo número do esqueleto, para a
 *  medição continuar comparável. */
const SOBRA = 6;

export function Feed({ itens, lookup }: FeedProps) {
  const chaves = useMemo(() => itens.map(chaveDe), [itens]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const coladoRef = useRef(true);
  const ancoraRef = useRef<Ancora | null>(null);
  const contagemRef = useRef(0);
  const [temNovas, setTemNovas] = useState(false);

  const virtualizer = useVirtualizer({
    count: itens.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (indice) => {
      const item = itens[indice];
      return item ? estimaAltura(item) : 0;
    },
    overscan: SOBRA,
    getItemKey: (indice) => chaves[indice] ?? indice,
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
      <div
        ref={scrollerRef}
        data-gate-messages=""
        onScroll={aoRolar}
        style={{
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '0 var(--ck-space-4)',
          // O ancoramento nativo do browser não enxerga itens em `position:
          // absolute` — quem ancora aqui é `ancora.ts`, e os dois brigando
          // produzem exatamente o tranco que estamos removendo.
          overflowAnchor: 'none',
        }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
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
                  {item ? <CorpoDoItem item={item} lookup={lookup} /> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
