/**
 * A CHEGADA DA MENSAGEM (28/09). A fala nova do agente sobe 6px e acende, em
 * vez de aparecer seca no pé do feed. Isto aqui decide QUEM ganha o gesto; o
 * movimento em si é `.ck-chega` em `globals.css`.
 *
 * Só ganha quem chegou AO VIVO. A primeira lista não vazia que o feed vê é a
 * carga (o replay do histórico, ou a conversa já em cache ao voltar ao chat) e
 * vira a semente: nada dela anima. O `key={geracao}` do feed remonta tudo no
 * reset de sessão, então a semente se refaz sozinha.
 *
 * Só a fala do agente (`assistant`). A bolha otimista do Rica é `user` e já tem
 * o voo do envio (`lib/voo-do-envio.ts`); animá-la aqui seria o segundo
 * movimento em cima do primeiro.
 *
 * O prazo existe por causa do virtualizador: item que chega com o Rica rolado
 * para cima NÃO é montado, e sem prazo ele animaria minutos depois, quando o
 * Rica descesse — o gesto de "acabou de chegar" em coisa velha. E `terminou`
 * tira o item da lista assim que a animação acaba, para ele não repetir o
 * gesto ao sair e voltar da janela virtual.
 */

/** Mais que isso entre chegar e montar, o item já não é "novo" para o olho. */
export const PRAZO_DA_CHEGADA_MS = 1000;

export type ItemObservado = { chave: string; kind: string };

export type Chegadas = {
  /** Chamado a cada render com a lista inteira. Idempotente: o StrictMode e o
   *  render descartado do React podem chamá-lo duas vezes com a mesma lista. */
  observa(itens: readonly ItemObservado[], agoraMs: number): void;
  chegando(chave: string, agoraMs: number): boolean;
  terminou(chave: string): void;
};

export function criaChegadas(): Chegadas {
  let semeado = false;
  const vistas = new Set<string>();
  const aoVivo = new Map<string, number>();

  return {
    observa(itens, agoraMs) {
      if (!semeado) {
        if (itens.length === 0) return;
        semeado = true;
        for (const item of itens) vistas.add(item.chave);
        return;
      }
      for (const item of itens) {
        if (vistas.has(item.chave)) continue;
        vistas.add(item.chave);
        if (item.kind === 'assistant') aoVivo.set(item.chave, agoraMs);
      }
    },
    chegando(chave, agoraMs) {
      const desde = aoVivo.get(chave);
      if (desde === undefined) return false;
      if (agoraMs - desde > PRAZO_DA_CHEGADA_MS) {
        aoVivo.delete(chave);
        return false;
      }
      return true;
    },
    terminou(chave) {
      aoVivo.delete(chave);
    },
  };
}
