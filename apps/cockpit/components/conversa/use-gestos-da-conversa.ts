'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';

import { cliqueVale, gestoDaConversa, type Ponto } from './gesto-de-arrasto';
import { CHAVE_DICA_DOS_GESTOS } from './preferencias-da-conversa';

/**
 * Os gestos de dedo da tela de conversa, lidos por Pointer Events no `<main>`. O
 * `touch-action: none` dele (no CSS) tira o dedo do Safari: nada rola, nada dá zoom, e o
 * arrasto chega inteiro até soltar. Mouse não faz gesto — no computador, clique é clique.
 * O gesto vale ao soltar o dedo; quem vê o que ele fez é a regra pura (`gesto-de-arrasto`).
 */
export function useGestosDaConversa({
  faixaDeBaixoRef,
  aoChat,
  aoConfiguracoes,
}: {
  /** O elemento que marca a faixa de baixo (área segura + ~40 px), medido no toque. */
  faixaDeBaixoRef: RefObject<HTMLElement | null>;
  aoChat: () => void;
  aoConfiguracoes: () => void;
}) {
  const inicioRef = useRef<(Ponto & { id: number }) | null>(null);
  const dedoAndouRef = useRef(false);

  const onPointerDown = useCallback((evento: PointerEvent<HTMLElement>) => {
    dedoAndouRef.current = false;
    // A folha de configurações mora num portal: o evento dela sobe pela árvore do React
    // até aqui, mas o dedo está nela, não na tela.
    if (evento.pointerType === 'mouse' || !evento.currentTarget.contains(evento.target as Node)) {
      inicioRef.current = null;
      return;
    }
    if (!evento.isPrimary) {
      // Segundo dedo: não é gesto, e o clique que sobrar também não é toque.
      inicioRef.current = null;
      dedoAndouRef.current = true;
      return;
    }
    inicioRef.current = { x: evento.clientX, y: evento.clientY, id: evento.pointerId };
  }, []);

  const onPointerUp = useCallback(
    (evento: PointerEvent<HTMLElement>) => {
      const inicio = inicioRef.current;
      if (inicio === null || evento.pointerId !== inicio.id) return;
      inicioRef.current = null;
      const gesto = gestoDaConversa(inicio, { x: evento.clientX, y: evento.clientY }, {
        largura: window.innerWidth,
        faixaDeBaixo: faixaDeBaixoRef.current?.getBoundingClientRect().top ?? window.innerHeight,
      });
      dedoAndouRef.current = gesto !== 'toque';
      if (gesto === 'chat') aoChat();
      if (gesto === 'configuracoes') aoConfiguracoes();
    },
    [aoChat, aoConfiguracoes, faixaDeBaixoRef],
  );

  const onPointerCancel = useCallback(() => {
    inicioRef.current = null;
    dedoAndouRef.current = true;
  }, []);

  /** Para o `onClick` do toque: o clique que sobra de um arrasto não começa nem para. */
  const cliqueConta = useCallback((evento: MouseEvent) => {
    const vale = cliqueVale(evento.detail, dedoAndouRef.current);
    dedoAndouRef.current = false;
    return vale;
  }, []);

  return { gestos: { onPointerDown, onPointerUp, onPointerCancel }, cliqueConta };
}

export const DICA_DOS_GESTOS_MS = 2_000;

/**
 * Sem o ícone de configurações à vista, a primeira vez que a tela abre mostra a dica por
 * 2 s. Só conta como vista quando some: sair antes disso mostra de novo na próxima.
 */
export function useDicaDosGestos() {
  const [visivel, setVisivel] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CHAVE_DICA_DOS_GESTOS) === '1') return;
    } catch {
      return;
    }
    setVisivel(true);
    const relogio = window.setTimeout(() => {
      setVisivel(false);
      try {
        window.localStorage.setItem(CHAVE_DICA_DOS_GESTOS, '1');
      } catch {
        // Safari em navegação privada pode recusar; a dica volta na próxima vez.
      }
    }, DICA_DOS_GESTOS_MS);
    return () => {
      window.clearTimeout(relogio);
      setVisivel(false);
    };
  }, []);
  return visivel;
}
