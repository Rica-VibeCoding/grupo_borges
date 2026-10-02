'use client';

/**
 * A forma da caixa: a miniatura que recolhe depois do fade e o campo que cresce
 * com o que está escrito. Saíram de `composer.tsx` (02/10) e continuam sendo
 * chamados lá, no mesmo ponto — é no render dele que a Motion mede a caixa.
 */
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import type { usaAnexo } from '../../lib/usa-anexo';
import { miniaturaAberta } from './miniatura-anexo';
import { TROCA_DE_FILEIRA } from './troca-de-fileira';

export function usaMiniaturaRecolhida(anexo: Pick<ReturnType<typeof usaAnexo>, 'estado'>): boolean {
  // A MINIATURA RECOLHE DEPOIS DO FADE, num render deste componente: é aqui que
  // a Motion mede a caixa, e só assim ela encolhe animada em vez de cair. Sem
  // isto, tirar a foto com o campo vazio trocava para uma fileira no mesmo
  // quadro, e a foto sumia de estalo em vez de esmaecer.
  const fotoEmCena = miniaturaAberta(anexo.estado);
  const [miniaturaRecolhida, setMiniaturaRecolhida] = useState(!fotoEmCena);
  if (fotoEmCena && miniaturaRecolhida) setMiniaturaRecolhida(false);
  const fotoVoou = anexo.estado.fase === 'enviando';
  useEffect(() => {
    if (fotoEmCena || miniaturaRecolhida) return;
    // A foto que voou para a bolha sai sem fade (ver `.ck-miniatura[data-voou]`).
    const espera = fotoVoou ? 0 : TROCA_DE_FILEIRA.duration * 1000;
    const relogio = setTimeout(() => setMiniaturaRecolhida(true), espera);
    return () => clearTimeout(relogio);
  }, [fotoEmCena, miniaturaRecolhida, fotoVoou]);
  return miniaturaRecolhida;
}

export function usaAlturaDoCampo(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  texto: string,
): void {
  // A CAIXA CRESCE COM O QUE ESTÁ ESCRITO. Efeito e não `onChange` porque o
  // campo tem três autores: o Rica digitando, a fila devolvendo um item ao
  // campo (`editarDaFila`) e o envio esvaziando. Preso ao `onChange`, a caixa
  // ficaria alta depois de mandar a mensagem e baixa depois de editar da fila.
  //
  // `height = 'auto'` antes de ler `scrollHeight` não é ritual: sem zerar, o
  // `scrollHeight` nunca desce, porque ele mede o conteúdo contra a altura já
  // aplicada. É o que faz a caixa encolher ao apagar linha.
  // `useLayoutEffect`, não `useEffect`: a altura tem de estar certa ANTES da
  // pintura, que é quando a Motion mede. Depois da pintura, colar três linhas
  // no campo vazio animava até uma linha e saltava para três.
  useLayoutEffect(() => {
    const campo = textareaRef.current;
    if (!campo) return;
    campo.style.height = 'auto';
    campo.style.height = `${campo.scrollHeight}px`;
  }, [texto]);
}
