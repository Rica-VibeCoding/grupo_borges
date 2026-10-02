'use client';

import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';

import { ASSENTO_MS, MAOS_MS, criaSeguidor, modoDeSeguir } from './seguir-o-fim';

/**
 * Colado no fim, o que chega empurra a conversa para cima numa mola
 * (`seguir-o-fim.ts`), em vez de o `scrollTop` saltar. Devolve o seguidor (o
 * `onScroll` pergunta a ele se a rolagem foi eco da mola), `seguirOFim` (o
 * efeito de todo commit chama quando está colado) e os ouvidos da mão do Rica,
 * a espalhar na caixa do feed.
 */
export function useSeguirOFim(scrollerRef: RefObject<HTMLDivElement | null>, coladoRef: RefObject<boolean>) {
  // `maosAte` é até quando a mão do Rica manda no feed (infinito com o dedo ou
  // o botão do mouse em baixo): enquanto isso a mola não escreve nada, e o
  // `onScroll` dele decide sozinho se ele descolou.
  const seguidorRef = useRef<ReturnType<typeof criaSeguidor> | null>(null);
  seguidorRef.current ??= criaSeguidor(() => scrollerRef.current);
  const seguidor = seguidorRef.current;
  const maosAteRef = useRef(0);
  const montadoEmRef = useRef<number | null>(null);
  const reduzidoRef = useRef<MediaQueryList | null>(null);
  const retomadaRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Colado e sem a mão do Rica no feed: alcança o fim pela mola, ou no salto
  // quando o movimento não serve (`modoDeSeguir`).
  const seguirOFim = useCallback(() => {
    const elemento = scrollerRef.current;
    if (!elemento || !coladoRef.current) return;
    const agora = performance.now();
    if (agora < maosAteRef.current) return;
    montadoEmRef.current ??= agora;
    reduzidoRef.current ??= window.matchMedia('(prefers-reduced-motion: reduce)');
    const modo = modoDeSeguir({
      distancia: elemento.scrollHeight - elemento.clientHeight - elemento.scrollTop,
      clientHeight: elemento.clientHeight,
      reduzido: reduzidoRef.current.matches,
      assentando: agora - montadoEmRef.current < ASSENTO_MS,
    });
    if (modo === 'mola') {
      seguidor.segue();
    } else if (modo === 'salto') {
      seguidor.para();
      elemento.scrollTop = elemento.scrollHeight;
    }
  }, [seguidor]);

  const maoEntra = useCallback(() => {
    maosAteRef.current = Number.POSITIVE_INFINITY;
    seguidor.para();
  }, [seguidor]);

  // Soltou (ou foi um gesto pontual: roda, tecla): a mola espera `MAOS_MS`
  // pelo `onScroll` e retoma se ele seguiu colado — senão um toque no meio da
  // subida a deixaria parada a meio caminho até o próximo flush.
  const maoSai = useCallback(() => {
    maosAteRef.current = performance.now() + MAOS_MS;
    seguidor.para();
    if (retomadaRef.current !== null) clearTimeout(retomadaRef.current);
    retomadaRef.current = setTimeout(() => {
      retomadaRef.current = null;
      seguirOFim();
    }, MAOS_MS);
  }, [seguidor, seguirOFim]);

  // A soltura é escutada na janela: o item sob o dedo pode sair da janela
  // virtual durante o gesto, e o `touchend` dele não borbulharia até o feed.
  useEffect(() => {
    const soltou = () => {
      if (maosAteRef.current === Number.POSITIVE_INFINITY) maoSai();
    };
    window.addEventListener('touchend', soltou, { passive: true });
    window.addEventListener('touchcancel', soltou, { passive: true });
    window.addEventListener('pointerup', soltou, { passive: true });
    return () => {
      window.removeEventListener('touchend', soltou);
      window.removeEventListener('touchcancel', soltou);
      window.removeEventListener('pointerup', soltou);
      seguidor.para();
      if (retomadaRef.current !== null) clearTimeout(retomadaRef.current);
    };
  }, [maoSai, seguidor]);

  // A mão do Rica tira a mola do caminho ANTES da rolagem dela: o toque e o
  // botão do mouse seguram até soltar (a barra de rolagem incluída); roda e
  // tecla são pontuais. Toque vem pelos eventos de toque, não pelo
  // `pointerdown`, que o iPhone cancela quando o gesto vira rolagem.
  const maos = useMemo(
    () => ({
      onTouchStart: maoEntra,
      onPointerDown: (evento: { pointerType: string }) => {
        if (evento.pointerType !== 'touch') maoEntra();
      },
      onWheel: maoSai,
      onKeyDown: maoSai,
    }),
    [maoEntra, maoSai],
  );

  return { seguidor, seguirOFim, maos };
}
