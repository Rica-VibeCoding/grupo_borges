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
 * A fala só é recusada por ocupação num turno que conta: descartado (toque ou fala por cima)
 * não conta, o Claude Code enfileira. O freio sai sempre; antes da primeira linha do Zé, o
 * servidor limpa o pedido devolvido à caixa e grava o fim no stream — o `isRunning` cai por ele.
 */
export function zeOcupado(rodando: boolean, descartado: boolean): boolean {
  return rodando && !descartado;
}

/** Toque duplo não liga e desliga: o que vem antes disso do último aceito é ignorado. */
export const JANELA_DO_TOQUE_MS = 400;

export function toqueConta(agora: number, ultimoAceito: number | null): boolean {
  return ultimoAceito === null || agora - ultimoAceito >= JANELA_DO_TOQUE_MS;
}
