/**
 * A FILA DO COMPACT — o que fazer com a mensagem escrita durante a espera.
 *
 * A `porta-de-envio` prometia, em letras: *"compactando — sua mensagem continua
 * aqui e sai quando a barra sumir"*. Nada reenviava. O texto ficava no campo e
 * morria ali se o Rica trocasse de tela, e o comentário do composer justificava
 * a ausência de botão dizendo que "não há algo a fazer além de esperar" — a
 * premissa falsa escrita dentro do código. Este módulo é a promessa virando
 * verdade.
 *
 * ## A régua em uma linha
 *
 * **Despacha em conclusão, pausa em falha.** O compact que TERMINA solta a fila;
 * o que some sem sinal, não — ali o compact pode estar vivo e mudo, e soltar
 * texto agora corta o resumo ao meio, que é o defeito original renascendo pelo
 * outro lado.
 *
 * ## Por que a fila é de N e não de 1
 *
 * Limitar a uma criaria um segundo estado de recusa ("já tem uma na fila"), que
 * é a mesma mentira de UI que esta peça existe para matar. A serialização sai de
 * graça: a porta já recusa `envio-em-voo`, então a próxima só sai quando o eco
 * da anterior voltar — ver `proximoDaFila`.
 *
 * Puro de propósito, sem React: a decisão de QUEM sai e QUANDO é o que precisa
 * de teste, e dentro do componente ela não seria observável por teste nenhum.
 */
import type { EstadoCompact } from '../../lib/compact.ts';
import type { FaseEnvio } from '../../lib/envio.ts';

export type ItemDaFila = {
  id: string;
  texto: string;
  origem: 'text' | 'stt';
};

export type MotivoDaPausa =
  /** O compact estourou os 6min sem dar sinal. Ele PODE estar vivo. */
  | 'sem-retorno'
  /** O despacho anterior não confirmou. Drenar por cima trocaria o texto
   *  pendurado da máquina de envio pelo próximo — descarte calado. */
  | 'envio-falhou';

export type EstadoDaFila = {
  itens: readonly ItemDaFila[];
  /** `null` = a fila anda sozinha. Preenchido = só sai com toque do Rica. */
  pausa: MotivoDaPausa | null;
};

export type FasesDoDespacho = {
  compact: EstadoCompact['fase'];
  envio: FaseEnvio;
};

export const FILA_VAZIA: EstadoDaFila = { itens: [], pausa: null };

export function enfileira(estado: EstadoDaFila, item: ItemDaFila): EstadoDaFila {
  return { ...estado, itens: [...estado.itens, item] };
}

/** Tira o item da fila e devolve o que ele carregava — quem chama põe o texto
 *  de volta no campo. Descartar calado aqui seria o incidente de 05/08 com
 *  roupa nova, e desta vez com o texto à vista até o instante em que some. */
export function retira(
  estado: EstadoDaFila,
  id: string,
): { estado: EstadoDaFila; item: ItemDaFila | null } {
  const item = estado.itens.find((i) => i.id === id) ?? null;
  if (!item) return { estado, item: null };
  return { estado: { ...estado, itens: estado.itens.filter((i) => i.id !== id) }, item };
}

/**
 * O despacho automático bateu na porta e voltou. Não pode acontecer — a porta e
 * `proximoDaFila` recusam pelas mesmas fases, lidas no mesmo instante —, mas
 * "não pode acontecer" é o que se dizia dos três portões mudos de 05/08. O item
 * volta para o INÍCIO (a ordem em que ele escreveu é dado) e a fila pausa: se a
 * porta recusou uma vez sem a fila saber por quê, insistir sozinha é girar.
 */
export function devolveAoInicio(estado: EstadoDaFila, item: ItemDaFila): EstadoDaFila {
  return { itens: [item, ...estado.itens], pausa: 'envio-falhou' };
}

function comPausa(estado: EstadoDaFila, pausa: MotivoDaPausa | null): EstadoDaFila {
  return estado.pausa === pausa ? estado : { ...estado, pausa };
}

/**
 * A máquina inteira em cinco linhas. Devolve o MESMO objeto quando nada muda —
 * o componente passa o retorno direto para `setState`, e identidade estável é o
 * que faz o React desistir do re-render em vez de girar em falso.
 *
 * A ordem das guardas é o desenho:
 *
 * 1. `sem-retorno` pausa, sempre.
 * 2. Pausada por `sem-retorno`, só o RESUMO CHEGANDO (`concluindo`) solta. O
 *    dismiss do aviso leva a máquina do compact a `ocioso` e essa volta não é
 *    permissão de envio: dispensar um aviso não é pedir para despachar.
 * 3. Insucesso do envio pausa. `nao-confirmado` entra junto com `falhou`: ali a
 *    máquina segura um texto pendurado esperando decisão, e despachar por cima
 *    o substituiria.
 * 4. `confirmado` é a prova de que o caminho voltou — a pausa de envio cai.
 */
export function reagiuAsFases(estado: EstadoDaFila, fases: FasesDoDespacho): EstadoDaFila {
  // Fila vazia não guarda pausa: ela é um estado da ESPERA, e sem ninguém
  // esperando ela sobreviveria à própria causa e travaria a fila seguinte.
  if (estado.itens.length === 0) return comPausa(estado, null);
  if (fases.compact === 'sem-retorno') return comPausa(estado, 'sem-retorno');
  if (estado.pausa === 'sem-retorno') {
    return fases.compact === 'concluindo' ? comPausa(estado, null) : estado;
  }
  if (fases.envio === 'falhou' || fases.envio === 'nao-confirmado') {
    return comPausa(estado, 'envio-falhou');
  }
  if (fases.envio === 'confirmado') return comPausa(estado, null);
  return estado;
}

/**
 * Quem sai agora, ou `null`. Espelha a porta de propósito: as fases que ela
 * recusa são as mesmas que seguram a fila, senão o despacho automático bateria
 * na porta e voltaria como aviso de recusa — barulho por um gesto que o Rica
 * não fez.
 */
export function proximoDaFila(
  estado: EstadoDaFila,
  fases: FasesDoDespacho,
): ItemDaFila | null {
  if (estado.pausa !== null) return null;
  if (fases.compact !== 'ocioso') return null;
  if (fases.envio !== 'ocioso' && fases.envio !== 'confirmado') return null;
  return estado.itens[0] ?? null;
}

/** O botão do estado pausado: o Rica assume o risco no lugar da máquina. */
export function soltaPausa(estado: EstadoDaFila): EstadoDaFila {
  return comPausa(estado, null);
}

/**
 * O que a fila diz de si. Uma frase só, sempre presente enquanto houver item —
 * o bloco descreve o que vai acontecer, não o que aconteceu.
 */
export function recadoDaFila(estado: EstadoDaFila): string {
  if (estado.itens.length === 0) return '';
  if (estado.pausa === 'sem-retorno') {
    return 'o compact não deu sinal — toque para enviar mesmo assim';
  }
  if (estado.pausa === 'envio-falhou') {
    return 'o envio anterior não confirmou — resolva acima ou envie mesmo assim';
  }
  // Sem nomear a espera: são duas (o compact e o eco da mensagem anterior) e
  // cada uma já tem quem a anuncie na mesma tela — a `BarraCompact` logo acima,
  // a linha de estado do composer logo abaixo. O que só esta frase sabe dizer é
  // o destino do texto, e é isso que ela diz.
  return 'na fila — sai sozinha quando liberar';
}
