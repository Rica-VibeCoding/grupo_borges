export type OpcoesAlturaViewport = {
  alturaVisual?: number;
  alturaDaJanela: number;
  tecladoAberto?: boolean;
};

function medidaValida(medida: number | undefined): medida is number {
  return typeof medida === 'number' && Number.isFinite(medida) && medida > 0;
}

/** Altura da app **no aplicativo instalado** — no navegador quem manda é o
 *  `100dvh` do CSS, e a decisão de nem publicar mora no componente. */
export function alturaDoViewport({
  alturaVisual,
  alturaDaJanela,
  tecladoAberto = false,
}: OpcoesAlturaViewport): number {
  // O teclado encolhe o viewport visual e não toca no layout viewport. Como
  // ninguém desloca a página no modo instalado, encolher junto é a única forma
  // de o composer não ficar atrás do teclado.
  const altura = tecladoAberto && medidaValida(alturaVisual) ? alturaVisual : alturaDaJanela;
  return medidaValida(altura) ? Math.round(altura) : 0;
}
