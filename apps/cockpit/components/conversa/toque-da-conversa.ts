import type { Cena } from './moldura-estado.ts';

/**
 * A tela inteira é o botão: um toque inicia; durante o turno do Zé, um toque interrompe —
 * o Esc no servidor e a voz cortada, seguindo a ouvir; fora do turno, com a conversa andando,
 * um toque para. O toque é o único sinal de interromper: a fala dele, mesmo por cima, entra
 * na fila do Claude Code sem cortar nada. `rodando` é o `isRunning` do stream.
 */
export type AcaoDoToque = 'comecar' | 'interromper' | 'parar' | 'nada';

export function acaoDoToque(cena: Cena, preparacaoFalhou: boolean, rodando = false): AcaoDoToque {
  // Detector ainda baixando (ou que não carregou): o toque não faz nada.
  // Desligado: não há quem ouça — o toque espera ele voltar.
  if (preparacaoFalhou || cena === 'preparando' || cena === 'desligado') return 'nada';
  // Do erro, o toque é o "tentar de novo".
  if (cena === 'parado' || cena === 'erro') return 'comecar';
  if (cena === 'esperandoZe' || cena === 'falando' || cena === 'interrompendo' || rodando) return 'interromper';
  return 'parar';
}

/** Toque duplo não liga e desliga: o que vem antes disso do último aceito é ignorado. */
export const JANELA_DO_TOQUE_MS = 400;

export function toqueConta(agora: number, ultimoAceito: number | null): boolean {
  return ultimoAceito === null || agora - ultimoAceito >= JANELA_DO_TOQUE_MS;
}
