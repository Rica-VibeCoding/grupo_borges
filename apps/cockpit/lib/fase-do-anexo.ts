import type { EspecieAnexo } from './regras-do-anexo.ts';

/**
 * A máquina do anexo. Cinco fases, e cada uma existe porque tem consequência
 * na tela:
 *
 * - `escolhido` é o arquivo RETIDO: escolhido, validado e ainda não enviado.
 *   Antes ele não existia — escolher a foto disparava o upload na hora, e o
 *   Rica via o arquivo chegar ao agente sem legenda nenhuma, porque ele nem
 *   tinha tido a chance de escrever. Reter é o que separa o gesto em dois
 *   tempos: escolher e, depois, mandar foto e legenda de uma vez.
 * - `enviando` TRAVA o botão. É a única defesa contra o duplo envio: um vídeo de
 *   50 MB por Tailscale demora, e o segundo toque no mesmo botão mandaria o
 *   arquivo duas vezes ao agente.
 * - `erro` carrega a FRASE do backend, não um código. O `detail` do 422 diz se
 *   foi o tipo ou o tamanho; sem ele o Rica tenta de novo às cegas.
 *
 * O ARQUIVO ATRAVESSA AS FASES INTEIRO. `escolhido`, `enviando` e o `erro` de
 * upload seguram o mesmo `File` — ele muda de fase, nunca evapora. Sem isso, um
 * 422 de tamanho apagaria a foto da tela e o Rica teria de escolhê-la de novo
 * para ler o motivo pelo qual ela não subiu. O único `erro` sem arquivo na mão é
 * o da validação na escolha, onde reter seria guardar uma promessa falsa: aquele
 * arquivo não sobe nem tentando.
 * - `sucesso` some sozinho. Confirmação que fica na tela vira ruído — o arquivo
 *   já aparece no feed, este aviso só cobre o intervalo entre soltar o arquivo
 *   e ele existir por lá.
 *
 * - `nao-confirmado` é o `tmux_delivered: false` sem recusa explicada, ou a rede
 *   caindo depois do upload: o arquivo PODE ter chegado. É o `nao-confirmado`
 *   do texto — o recado âmbar fica, a bolha otimista fica, e o arquivo NÃO volta
 *   para a mão, porque reenviar duplicaria a entrega. Sai por dispensar ou pelo
 *   próximo gesto na gaveta.
 */
/** O arquivo em mãos. Fica INTEIRO no estado: a miniatura precisa dele para o
 *  preview e o despacho precisa dele para subir — guardar só o nome obrigaria a
 *  pedir o arquivo de volta ao input, que já foi zerado. */
export type Retido = { arquivo: File; especie: EspecieAnexo };

export type FaseAnexo =
  | { fase: 'ocioso' }
  | ({ fase: 'escolhido' } & Retido)
  | ({ fase: 'enviando' } & Retido)
  /** `retido` é `null` só quando a recusa veio da validação na escolha — ali não
   *  há arquivo enviável para segurar. Vindo de um upload que falhou, o arquivo
   *  continua na mão e o próximo toque em enviar é nova tentativa. */
  | { fase: 'erro'; nome: string; motivo: string; retido: Retido | null }
  | { fase: 'nao-confirmado'; nome: string; motivo: string }
  | { fase: 'sucesso'; nome: string; especie: EspecieAnexo };

/** O que a miniatura mostra e o que a porta conta como gesto — a pergunta "tem
 *  arquivo na mão?" atravessa três fases e não se responde por uma só. */
export function arquivoRetido(estado: FaseAnexo): Retido | null {
  if (estado.fase === 'escolhido' || estado.fase === 'enviando') {
    return { arquivo: estado.arquivo, especie: estado.especie };
  }
  if (estado.fase === 'erro') return estado.retido;
  return null;
}

/**
 * A gaveta mora no MESMO estado do envio porque as duas coisas se cruzam: a
 * gaveta fecha quando um item é escolhido, e não pode reabrir enquanto um
 * arquivo está subindo. Dois `useState` soltos no componente deixariam essa
 * regra implícita — e implícita ela é a que se perde na próxima edição.
 */
export type EstadoAnexo = FaseAnexo & { gaveta: boolean };

export const estadoInicialAnexo: EstadoAnexo = { fase: 'ocioso', gaveta: false };
