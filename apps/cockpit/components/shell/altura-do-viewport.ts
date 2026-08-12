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
  // O teclado encolhe o viewport visual e não toca no layout viewport. No
  // navegador quem tira o campo de trás dele é o próprio Safari, deslocando a
  // página para cima — e essa conta é feita contra a app do tamanho da tela.
  // Encolher a app depois disso a joga para fora por cima: sobra o rodapé do
  // composer no alto e o resto da tela vazio. No aplicativo instalado ninguém
  // desloca nada, e aí encolher é a única saída.
  const usaViewportVisual = modoAplicativo && tecladoAberto;
  const altura = usaViewportVisual && medidaValida(alturaVisual) ? alturaVisual : alturaDaJanela;
  return medidaValida(altura) ? Math.round(altura) : 0;
}
