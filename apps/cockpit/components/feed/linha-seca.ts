// Decide se uma linha de sistema tem conteúdo escondido atrás das reticências.
//
// Mora fora do `.tsx` de propósito: a suíte roda `node --test` sem transpilação
// de JSX, então o que precisa de prova não pode morar dentro de componente.
//
// Por que existe: `LinhaSeca` desenha uma linha só, com `nowrap` + `ellipsis` e
// sem nada que abra o resto. Medido no chat do Rica em 15/08, viewport de
// iPhone: 23px visíveis de 555px reais — 4% do texto chegando na tela. Ele
// resumiu a experiência inteira como "tudo sai truncado".
//
// O corte continua: uma linha é o desenho certo pra evento de sistema, e o
// contrato manda ("sem borda, sem fundo, sem badge"). O que muda é a linha
// deixar de ser MUDA sobre o que escondeu.

/** Acima disto uma linha de sistema não cabe em 390px de largura sem cortar. */
const LARGURA_DE_UMA_LINHA = 56;

export function temMaisParaMostrar(corpo: string | undefined): boolean {
  if (!corpo) return false;
  return corpo.includes('\n') || corpo.trim().length > LARGURA_DE_UMA_LINHA;
}

/** Primeira linha não vazia — é o que sobrevive ao corte de uma linha só. */
export function resumoDeUmaLinha(corpo: string): string {
  for (const linha of corpo.split('\n')) {
    if (linha.trim()) return linha.trim();
  }
  return corpo.trim();
}
