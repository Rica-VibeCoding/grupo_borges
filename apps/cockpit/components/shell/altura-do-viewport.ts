export type OpcoesAlturaViewport = {
  alturaVisual?: number;
  alturaDaJanela: number;
  modoAplicativo?: boolean;
  tecladoAberto?: boolean;
};

function medidaValida(medida: number | undefined): medida is number {
  return typeof medida === 'number' && Number.isFinite(medida) && medida > 0;
}

export function alturaDoViewport({
  alturaVisual,
  alturaDaJanela,
  modoAplicativo = false,
  tecladoAberto = false,
}: OpcoesAlturaViewport): number {
  const usaViewportVisual = !modoAplicativo || tecladoAberto;
  const altura = usaViewportVisual && medidaValida(alturaVisual) ? alturaVisual : alturaDaJanela;
  return medidaValida(altura) ? Math.round(altura) : 0;
}
