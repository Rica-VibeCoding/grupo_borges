'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { inicioDasPalavras, palavrasAte, palavrasDe, type FalaDoZe } from './frases-da-voz';
import styles from './texto-da-voz.module.css';
import { useMovimentoReduzido } from './use-movimento-reduzido';

/** A mola de `--ck-mola` (`globals.css`) para a Web Animations API, que não lê variável de CSS. */
const MOLA =
  'linear(0, 0.03 3%, 0.104 6%, 0.238 10%, 0.386 14%, 0.527 18%, 0.68 23%, 0.799 28%, 0.899 34%, 0.961 40%, 0.998 47%, 1.013 55%, 1.014 65%, 1.006 80%, 1)';
const SUBIDA_MS = 320;

function sobe(trilho: HTMLElement, distancia: number) {
  const quadros = [{ transform: `translateY(${distancia}px)` }, { transform: 'translateY(0)' }];
  const opcoes: KeyframeAnimationOptions = { duration: SUBIDA_MS, easing: MOLA, composite: 'add' };
  try {
    trilho.animate(quadros, opcoes);
  } catch {
    // Motor sem `linear()` na Web Animations: a mesma subida, com a curva de entrada da casa.
    trilho.animate(quadros, { ...opcoes, easing: 'cubic-bezier(0.2, 0, 0.2, 1)' });
  }
}

/**
 * A janela de três linhas que corre (adendo do Rica, 28/09): o texto cresce palavra a palavra,
 * cada uma entrando com fade e uma subida curta (`@starting-style` em `texto-da-voz.module.css`);
 * sempre as três últimas linhas à vista, e quando nasce linha nova o texto SOBE suave — só
 * `transform`, a altura nunca anima. O que passa do topo some no degradê de sempre.
 */
export function JanelaQueCorre({
  palavras,
  dataFala,
  oculta = false,
  indice,
}: {
  palavras: readonly string[];
  dataFala?: string;
  /** Só para os olhos: o leitor de tela ouve o estado, não cada palavra. */
  oculta?: boolean;
  indice?: number;
}) {
  const trilhoRef = useRef<HTMLParagraphElement>(null);
  const topoRef = useRef<number | null>(null);
  const reduzido = useMovimentoReduzido();
  useLayoutEffect(() => {
    const trilho = trilhoRef.current;
    if (!trilho) return;
    const topo = trilho.offsetTop;
    const antes = topoRef.current;
    topoRef.current = topo;
    // Subiu (linha nova embaixo): nasce de onde estava e corre ao lugar novo. `add` soma subidas seguidas.
    if (antes === null || reduzido || topo >= antes || typeof trilho.animate !== 'function') return;
    sobe(trilho, antes - topo);
  }, [palavras, reduzido]);
  return (
    <div className={styles.corre} data-fala={dataFala} aria-hidden={oculta ? 'true' : undefined}>
      <p ref={trilhoRef} className={styles.texto} data-trilho="" data-indice={indice}>
        {palavras.map((palavra, i) => (
          <Fragment key={i}>
            <span className={styles.palavra}>{palavra}</span>{' '}
          </Fragment>
        ))}
      </p>
    </div>
  );
}

/**
 * Quantas palavras da frase que toca já entraram. O relógio é o da frase: começa com o áudio
 * dela (a troca vem de `use-fila-de-voz`) e para com a voz pausada — interromper congela.
 */
function usePalavrasDaFrase(fala: FalaDoZe, pausada: boolean): number {
  const [conta, setConta] = useState({ indice: fala.indice, n: 1 });
  const decorridoRef = useRef({ indice: fala.indice, s: 0 });
  useEffect(() => {
    if (decorridoRef.current.indice !== fala.indice) decorridoRef.current = { indice: fala.indice, s: 0 };
    if (pausada) return;
    const inicios = inicioDasPalavras(palavrasDe(fala.atual), fala.duracao);
    let antes = performance.now();
    let quadro = 0;
    const passo = (agora: number) => {
      decorridoRef.current.s += (agora - antes) / 1000;
      antes = agora;
      const n = palavrasAte(inicios, decorridoRef.current.s);
      setConta((c) => (c.indice === fala.indice && c.n === n ? c : { indice: fala.indice, n }));
      if (n < inicios.length) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [fala.indice, fala.atual, fala.duracao, pausada]);
  // Frase nova: antes do primeiro quadro dela, só a primeira palavra (nunca a conta da anterior).
  return conta.indice === fala.indice ? conta.n : 1;
}

/** A fala dele: o que já foi dito, inteiro, e a frase do áudio que toca entrando palavra a palavra. */
export function FalaQueCorre({ fala, pausada }: { fala: FalaDoZe; pausada: boolean }) {
  const n = usePalavrasDaFrase(fala, pausada);
  const palavras = [...fala.dito.flatMap(palavrasDe), ...palavrasDe(fala.atual).slice(0, n)];
  return <JanelaQueCorre palavras={palavras} indice={fala.indice} />;
}
