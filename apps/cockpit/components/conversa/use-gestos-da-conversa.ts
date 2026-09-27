'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';

import { cliqueVale, gestoDaConversa, leArrasto, type Ponto } from './gesto-de-arrasto';
import type { Cena } from './moldura-estado';
import { CHAVE_DICA_DOS_GESTOS } from './preferencias-da-conversa';
import { aoSoltar, dedoAosQuinhentos, dedoQueAnda, SEGURAR_MS, type Dedo } from './segurar-a-vez';

/**
 * Os gestos de dedo da tela de conversa, lidos por Pointer Events no `<main>`. O
 * `touch-action: pan-x` dele (no CSS) deixa ao Safari só o arrasto de lado, que é do pager
 * (a direita volta ao chat); o vertical e o toque chegam inteiros até soltar, sem rolar nem
 * dar zoom. Quando o pager leva o dedo, chega `pointercancel` e o clique que sobrar não é
 * toque. O gesto vale ao soltar o dedo; quem vê o que ele fez é a regra pura
 * (`gesto-de-arrasto`, `segurar-a-vez`).
 *
 * Dedo parado por 500 ms, na vez do Rica, segura a vez até soltar (`aoSegurar`/`aoSoltar`);
 * o clique que o navegador solta depois dele, como o de um arrasto, não é toque. Mouse não
 * faz gesto — no computador, clique é clique —, mas segurar o botão segura a vez também.
 */
export function useGestosDaConversa({
  faixaDeBaixoRef,
  aoConfiguracoes,
  leCena,
  aoSegurar,
  aoSoltar: aoSoltarAVez,
}: {
  /** O elemento que marca a faixa de baixo (área segura + ~40 px), medido no toque. */
  faixaDeBaixoRef: RefObject<HTMLElement | null>;
  aoConfiguracoes: () => void;
  /** A cena de agora, lida quando o dedo completa 500 ms. */
  leCena: () => Cena;
  aoSegurar: () => void;
  aoSoltar: () => void;
}) {
  const inicioRef = useRef<(Ponto & { id: number; mouse: boolean }) | null>(null);
  const dedoAndouRef = useRef(false);
  const dedoRef = useRef<Dedo>('rapido');
  const relogioRef = useRef<number | null>(null);
  const acoesRef = useRef({ leCena, aoSegurar, aoSoltarAVez });
  acoesRef.current = { leCena, aoSegurar, aoSoltarAVez };

  const paraRelogio = useCallback(() => {
    if (relogioRef.current !== null) window.clearTimeout(relogioRef.current);
    relogioRef.current = null;
  }, []);

  // Soltou do jeito que for (dedo, cancelamento, tela saindo): a vez segura volta a contar.
  const encerraDedo = useCallback(() => {
    paraRelogio();
    inicioRef.current = null;
    const segurava = dedoRef.current === 'segurando';
    dedoRef.current = 'rapido';
    if (segurava) acoesRef.current.aoSoltarAVez();
  }, [paraRelogio]);

  useEffect(() => encerraDedo, [encerraDedo]);

  const onPointerDown = useCallback(
    (evento: PointerEvent<HTMLElement>) => {
      if (!evento.isPrimary) {
        // Segundo dedo: não é gesto, e o clique que sobrar também não é toque. A vez segura
        // fica com o primeiro dedo, até ele sair.
        if (dedoRef.current !== 'segurando') encerraDedo();
        dedoAndouRef.current = true;
        return;
      }
      encerraDedo();
      dedoAndouRef.current = false;
      // A folha de configurações mora num portal: o evento dela sobe pela árvore do React
      // até aqui, mas o dedo está nela, não na tela. Botão do meio ou da direita não conta.
      if (!evento.currentTarget.contains(evento.target as Node) || evento.button !== 0) return;
      inicioRef.current = { x: evento.clientX, y: evento.clientY, id: evento.pointerId, mouse: evento.pointerType === 'mouse' };
      relogioRef.current = window.setTimeout(() => {
        relogioRef.current = null;
        dedoRef.current = dedoAosQuinhentos(dedoRef.current, acoesRef.current.leCena());
        if (dedoRef.current === 'segurando') acoesRef.current.aoSegurar();
      }, SEGURAR_MS);
    },
    [encerraDedo],
  );

  const onPointerMove = useCallback((evento: PointerEvent<HTMLElement>) => {
    const inicio = inicioRef.current;
    if (inicio === null || evento.pointerId !== inicio.id || dedoRef.current !== 'rapido') return;
    if (leArrasto(inicio, { x: evento.clientX, y: evento.clientY }) !== 'toque') dedoRef.current = dedoQueAnda(dedoRef.current);
  }, []);

  const onPointerUp = useCallback(
    (evento: PointerEvent<HTMLElement>) => {
      const inicio = inicioRef.current;
      if (inicio === null || evento.pointerId !== inicio.id) return;
      const faixaDeBaixo = faixaDeBaixoRef.current?.getBoundingClientRect().top ?? window.innerHeight;
      const gesto = inicio.mouse ? 'toque' : gestoDaConversa(inicio, { x: evento.clientX, y: evento.clientY }, faixaDeBaixo);
      const acao = aoSoltar(dedoRef.current, gesto);
      encerraDedo();
      dedoAndouRef.current = acao !== 'toque';
      if (acao === 'configuracoes') aoConfiguracoes();
    },
    [aoConfiguracoes, encerraDedo, faixaDeBaixoRef],
  );

  const onPointerCancel = useCallback(() => {
    encerraDedo();
    dedoAndouRef.current = true;
  }, [encerraDedo]);

  // O dedo tem captura implícita e não sai; o mouse apertado que sai da tela não volta a
  // soltar aqui — vale como cancelado.
  const onPointerLeave = useCallback(
    (evento: PointerEvent<HTMLElement>) => {
      if (inicioRef.current?.mouse && evento.pointerId === inicioRef.current.id) onPointerCancel();
    },
    [onPointerCancel],
  );

  // O toque longo abre o menu do Android: com o dedo na tela, o menu é do segurar.
  const onContextMenu = useCallback((evento: MouseEvent<HTMLElement>) => {
    if (inicioRef.current !== null && !inicioRef.current.mouse) evento.preventDefault();
  }, []);

  /** Para o `onClick` do toque: o clique que sobra de um arrasto ou de um segurar não começa nem para. */
  const cliqueConta = useCallback((evento: MouseEvent) => {
    const vale = cliqueVale(evento.detail, dedoAndouRef.current);
    dedoAndouRef.current = false;
    return vale;
  }, []);

  return { gestos: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, onContextMenu }, cliqueConta };
}

export const DICA_DOS_GESTOS_MS = 2_000;

/**
 * Sem o ícone de configurações à vista, a primeira vez que a tela aparece mostra a dica por
 * 2 s. Só conta como vista quando some: sair antes disso mostra de novo na próxima. `ativa`
 * é o painel da voz assentado no pager — montada fora da tela, a dica não corre.
 */
export function useDicaDosGestos(ativa: boolean) {
  const [visivel, setVisivel] = useState(false);
  useEffect(() => {
    if (!ativa) return;
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
  }, [ativa]);
  return visivel;
}
