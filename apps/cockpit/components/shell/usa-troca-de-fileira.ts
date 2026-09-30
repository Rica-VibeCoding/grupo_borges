'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * A troca entre UMA fileira e DUAS (28/09) vira o `flex-direction` da caixa, e
 * isso não tem transição em CSS: a altura saltava num quadro só, e a bolinha
 * acima, que segue a caixa, pulava junto — enquanto os botões faziam fade de
 * 200ms. Rica, vídeo de 29/09: "dá uma olhada no movimento do composer".
 *
 * FLIP só da altura: guarda a altura de antes, deixa o layout novo assentar e
 * anima da velha até a nova. O `overflow: hidden` que a caixa já tem recorta o
 * conteúdo enquanto ela abre ou fecha. Duração e curva são as do fade dos
 * botões, lidas dos tokens, para a troca ser um gesto só.
 */
export function usaTrocaDeFileira(caixaRef: RefObject<HTMLElement | null>, umaLinha: boolean) {
  const alturaRef = useRef<number | null>(null);
  const linhaRef = useRef(umaLinha);
  const animacaoRef = useRef<Animation | null>(null);

  // Sem lista de dependências de propósito: cada letra pode mudar a altura (o
  // campo cresce), e a altura "de antes" tem de ser a do último quadro.
  useLayoutEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa) return;
    const emVoo = animacaoRef.current?.playState === 'running';

    if (linhaRef.current === umaLinha) {
      // No meio de uma animação a altura lida é a animada, não a natural.
      if (!emVoo) alturaRef.current = caixa.offsetHeight;
      return;
    }
    linhaRef.current = umaLinha;

    // Troca no meio de outra (apagou a letra antes de a caixa abrir): parte de
    // onde a caixa ESTÁ, não de onde ela ia chegar.
    const de = emVoo ? caixa.getBoundingClientRect().height : alturaRef.current;
    animacaoRef.current?.cancel();
    const para = caixa.offsetHeight;
    alturaRef.current = para;

    if (de === null || de === para) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const estilo = getComputedStyle(caixa);
    const duracao = emMilissegundos(estilo.getPropertyValue('--ck-dur-enter')) ?? 200;
    const curva = estilo.getPropertyValue('--ck-ease').trim() || 'ease-out';
    const animacao = caixa.animate(
      [{ height: `${de}px` }, { height: `${para}px` }],
      { duration: duracao, easing: curva },
    );
    animacaoRef.current = animacao;

    // O iPhone pinta o cursor numa camada própria e não o arrasta quando o
    // campo anda por layout: ele ficava fora da caixa, onde o campo estava
    // (Rica, print de 30/09). O cursor some durante a animação e, no fim, a
    // seleção é regravada — é mudança de seleção que faz o iOS repintá-lo.
    const campo = caixa.querySelector('textarea');
    if (!campo) return;
    campo.style.caretColor = 'transparent';
    const devolve = () => {
      // Cancelada por uma troca nova: quem cuida do cursor agora é a outra.
      if (animacaoRef.current !== animacao) return;
      campo.style.caretColor = '';
      if (document.activeElement !== campo) return;
      const { selectionStart, selectionEnd, selectionDirection } = campo;
      campo.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? undefined);
    };
    animacao.finished.then(devolve, devolve);
  });
}

/** O token chega como o navegador quiser: o Chromium devolve `200ms` como
 *  `0.2s`, e um `parseFloat` cru dava animação de 0,2 ms — invisível (30/09). */
function emMilissegundos(valor: string): number | null {
  const v = valor.trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return v.endsWith('ms') ? n : v.endsWith('s') ? n * 1000 : n;
}
