/**
 * As palavras da fala em curso, montadas dos pedaços parciais do canal ao vivo (fase 4, item 6)
 * — PURO. Só servem para a tela: o agente recebe o texto firme.
 *
 * Cada fala no canal é um item. Medido na Realtime em 28/09: os pedaços chegam durante a fala com
 * o item que a confirmação vai criar; depois de uma limpeza do canal (tosse), a fala seguinte
 * chega com item NOVO, e nada do item limpo aparece depois. O item limpo fica marcado mesmo
 * assim: pedaço atrasado de áudio descartado não volta para a tela.
 */
export type ParcialDoCanal = {
  /** Soma um pedaço. Devolve o parcial da fala em curso, ou `undefined` se o pedaço é de áudio descartado. */
  soma(item: string, pedaco: string): string | undefined;
  /** O áudio em curso saiu do canal (descarte, fala recomeçada, canal caiu no meio). */
  descarta(): void;
};

export function criaParcialDoCanal(): ParcialDoCanal {
  let atual: string | null = null;
  let texto = '';
  const descartados = new Set<string>();
  return {
    soma(item, pedaco) {
      if (descartados.has(item)) return undefined;
      if (item !== atual) {
        atual = item;
        texto = '';
      }
      texto += pedaco;
      return texto;
    },
    descarta() {
      if (atual !== null) descartados.add(atual);
      atual = null;
      texto = '';
    },
  };
}
