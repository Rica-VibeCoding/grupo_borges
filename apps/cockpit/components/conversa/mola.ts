/**
 * A mão no DOM da gaveta da tropa que segue o dedo. Só `transform` — nada de layout —, escrito direto no
 * estilo do elemento e não por estado do React: o dedo manda um valor por quadro, e passar
 * isso por render seria pedir 60 renders por segundo para mover uma camada.
 */

import { MOLA } from './deslize.ts';

const posicao = (x: number) => `translate3d(${x}px, 0, 0)`;

/** O assento ainda em curso de cada elemento. Dedo que volta antes do fim cancela o velho: sem
 *  isto, o relógio dele chamava o `fim` (a devolução ao CSS) no meio do arrasto novo, e a gaveta
 *  pulava em vez de deslizar (16/10). */
const emCurso = new WeakMap<HTMLElement, () => void>();

/** Onde o dedo está, na hora, sem transição. */
export function acompanha(elemento: HTMLElement, x: number): void {
  emCurso.get(elemento)?.();
  elemento.style.transition = 'none';
  elemento.style.transform = posicao(x);
}

/**
 * Assenta em `x` com a mola da folha e chama `fim` uma vez. O relógio é o cinto: quando o
 * elemento já está em `x` não há transição, e o `transitionend` nunca chega.
 */
export function assenta(elemento: HTMLElement, x: number, fim?: () => void): void {
  emCurso.get(elemento)?.();
  let feito = false;
  const desarma = () => {
    feito = true;
    emCurso.delete(elemento);
    elemento.removeEventListener('transitionend', aoTerminar);
    window.clearTimeout(relogio);
  };
  const termina = () => {
    if (feito) return;
    desarma();
    fim?.();
  };
  const aoTerminar = (evento: TransitionEvent) => {
    if (evento.target === elemento && evento.propertyName === 'transform') termina();
  };
  elemento.addEventListener('transitionend', aoTerminar);
  const relogio = window.setTimeout(termina, MOLA.duracaoMs + 120);
  emCurso.set(elemento, desarma);
  elemento.style.transition = `transform ${MOLA.duracaoMs}ms ${MOLA.curva}`;
  elemento.style.transform = posicao(x);
}

/**
 * Devolve o elemento ao CSS dele sem animar a devolução: a classe assume exatamente onde o
 * arrasto deixou, e uma transição aqui faria a gaveta "voltar" do nada.
 */
export function devolve(elemento: HTMLElement, propriedades: readonly string[] = []): void {
  elemento.style.transition = 'none';
  elemento.style.removeProperty('transform');
  for (const propriedade of propriedades) elemento.style.removeProperty(propriedade);
  void elemento.offsetWidth;
  elemento.style.removeProperty('transition');
}
