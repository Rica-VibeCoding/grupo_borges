import type { Cena } from './moldura-estado.ts';

/**
 * A tela inteira é o botão: um toque inicia; com a conversa andando, um toque para.
 * "Para" em todo estado ativo — calar o Zé e seguir ouvindo é a fala por cima, com
 * fone. Quem decide se o turno do Zé é freado no servidor é a máquina (`frearZe`).
 */
export type AcaoDoToque = 'comecar' | 'parar' | 'nada';

export function acaoDoToque(cena: Cena, preparacaoFalhou: boolean): AcaoDoToque {
  // Detector ainda baixando (ou que não carregou): o toque não faz nada.
  if (preparacaoFalhou || cena === 'preparando') return 'nada';
  // Do erro, o toque é o "tentar de novo".
  if (cena === 'parado' || cena === 'erro') return 'comecar';
  return 'parar';
}

/**
 * O freio no servidor só sai quando o Zé já começou a responder. Antes disso, o Escape
 * faz o Claude Code cancelar e DEVOLVER o pedido à caixa de entrada do pane, e o envio
 * seguinte (de voz ou de texto) é recusado com "campo ocupado" — medido em 27/09 no
 * canarinho. Sem o freio, o turno termina e a resposta fica no chat de texto; a voz
 * dela não volta, porque a máquina já marcou o turno como descartado.
 */
export function freiaNoServidor(antesDaResposta: boolean, zeJaRespondeu: boolean): boolean {
  return !antesDaResposta || zeJaRespondeu;
}

/** Toque duplo não liga e desliga: o que vem antes disso do último aceito é ignorado. */
export const JANELA_DO_TOQUE_MS = 400;

export function toqueConta(agora: number, ultimoAceito: number | null): boolean {
  return ultimoAceito === null || agora - ultimoAceito >= JANELA_DO_TOQUE_MS;
}
