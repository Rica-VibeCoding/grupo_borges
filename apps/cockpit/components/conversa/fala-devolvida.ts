/**
 * A fala que o freio apagou. Tocar logo depois de falar, antes da primeira linha do Zé, faz o
 * Escape devolver o pedido à caixa do Claude Code, e o servidor o apaga (`pedido_limpo`). A fala
 * fica guardada aqui e a próxima sai emendada nela, numa mensagem só — o Rica completa o que disse.
 * Sem `pedido_limpo` a fala já está no histórico e nada muda. Módulo neutro: sem React, sem rede.
 */

export type FalaDevolvida = ReturnType<typeof criaFalaDevolvida>;

export function criaFalaDevolvida() {
  let guardada: string | null = null;
  let ultima: string | null = null; // a última fala posta: é ela que o freio pode apagar
  return {
    /** Um envio. `monta` roda a cada tentativa — um freio que responde no meio da retentativa entra nela. */
    envio(fala: string) {
      let usada: string | null = null;
      return {
        monta: (): string => {
          usada = guardada;
          ultima = usada ? `${usada} ${fala}` : fala;
          return ultima;
        },
        // Entrou a emenda: a guardada sai — a não ser que outro freio tenha guardado outra no meio.
        entrou: () => {
          if (guardada === usada) guardada = null;
        },
      };
    },
    /** Pedido o freio: a resposta dele diz se a fala que saía foi apagada. */
    freio() {
      const naHora = ultima;
      return (resposta: { pedido_limpo?: boolean }) => {
        if (resposta.pedido_limpo === true && naHora) guardada = naHora;
      };
    },
    /** O pedido entrou na fila do Claude Code, ou a conversa acabou: não há o que emendar. */
    descarta: () => {
      guardada = null;
    },
  };
}
