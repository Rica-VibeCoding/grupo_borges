import { flushSync } from 'react-dom';

/**
 * A troca de TELA animada da voz (fase 4, animações): `document.startViewTransition()` nativo,
 * sem biblioteca — abrir ou fechar a voz pelo link do chat (teclado e leitor de tela; o dedo usa
 * o gesto do pager) ou pelo voltar do navegador. O resto cruza rápido e a esfera
 * (`ck-voz-esfera`, o único nome) entra crescendo ou sai encolhendo (`globals.css`).
 *
 * A troca de ESTADO (ouvindo → pensando → falando) não usa View Transition, e é de propósito:
 * medido no Chrome em 28/09, durante a troca o toque cai no `html` mesmo com
 * `::view-transition { pointer-events: none }` em toda a árvore — um toque para interromper no
 * instante em que ele começa a falar se perderia. O estado anima em CSS (a palavra) e no desenho
 * (a esfera e a moldura já trocam aos poucos).
 *
 * Sem a API (Safari antes do 18.2), com `prefers-reduced-motion` ou com a aba escondida, a troca
 * é direta: a mesma atualização, sem animar.
 */
export type CondicaoDaTroca = { temApi: boolean; reduzido: boolean; visivel: boolean };

export function animaTroca(c: CondicaoDaTroca): boolean {
  return c.temApi && !c.reduzido && c.visivel;
}

type ComTroca = Document & {
  startViewTransition?: (atualiza: () => void) => { finished: Promise<void> };
};

/** Roda `atualiza` dentro da troca de tela animada, ou direto. `true` quando animou. */
export function trocaDeTela(atualiza: (animando: boolean) => void): boolean {
  const doc = typeof document === 'undefined' ? null : (document as ComTroca);
  const anima =
    doc !== null &&
    animaTroca({
      temApi: typeof doc.startViewTransition === 'function',
      reduzido: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      visivel: doc.visibilityState === 'visible',
    });
  if (!anima || doc === null) {
    atualiza(false);
    return false;
  }
  const raiz = doc.documentElement;
  raiz.dataset.vozTroca = 'tela';
  const troca = doc.startViewTransition!(() => {
    flushSync(() => atualiza(true));
  });
  void troca.finished.finally(() => {
    delete raiz.dataset.vozTroca;
  });
  return true;
}
