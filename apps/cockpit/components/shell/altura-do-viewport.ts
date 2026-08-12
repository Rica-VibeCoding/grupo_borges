export type OpcoesAlturaViewport = {
  alturaDaJanela: number;
};

function medidaValida(medida: number | undefined): medida is number {
  return typeof medida === 'number' && Number.isFinite(medida) && medida > 0;
}

/** Altura da app **no aplicativo instalado** — no navegador quem manda é o
 *  `100dvh` do CSS, e a decisão de nem publicar mora no componente.
 *
 *  A régua é a janela, nunca o viewport visual. Medido no iPhone do Rica em
 *  12/08, com o teclado aberto: janela 655, viewport visual 449, deslocamento
 *  216. O iOS encolhe o layout **e** desloca a página; o viewport visual já
 *  vem descontado do deslocamento, então publicá-lo tira 206px que existem —
 *  a app encolhe demais e o deslocamento a joga para fora por cima. O `100dvh`
 *  erra para o outro lado: fica em 793 e enfia o composer atrás do teclado,
 *  que foi o defeito que o `9e522ab` veio consertar. */
export function alturaDoViewport({ alturaDaJanela }: OpcoesAlturaViewport): number {
  return medidaValida(alturaDaJanela) ? Math.round(alturaDaJanela) : 0;
}
