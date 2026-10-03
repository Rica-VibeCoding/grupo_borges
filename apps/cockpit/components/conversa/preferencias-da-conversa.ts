/**
 * As chaves de liga/desliga das configurações da conversa. Como a escolha de visual,
 * moram no `localStorage` do aparelho e não passam pelo backend. Qualquer valor
 * que não seja o "ligado" gravado aqui conta como desligado: o padrão é a tela
 * limpa e a conversa sem fone.
 */

export const CHAVE_FONE = 'ck-conversa-fone';
export const CHAVE_TEXTO = 'ck-conversa-texto';
export type ChaveLigada = typeof CHAVE_FONE | typeof CHAVE_TEXTO;

const LIGADO = '1';

export function leLigado(bruto: string | null | undefined): boolean {
  return bruto === LIGADO;
}

export function gravaLigado(ligado: boolean): string {
  return ligado ? LIGADO : '0';
}

/** A resposta falada na tela de voz: "curta" (duas frases, o resto no chat) é o padrão — Rica, 03/10. */
export const CHAVE_RESPOSTA = 'ck-conversa-resposta';
export type Resposta = 'curta' | 'completa';

export function leResposta(bruto: string | null | undefined): Resposta {
  return bruto === 'completa' ? 'completa' : 'curta';
}

/** O motor da voz do cockpit, por aparelho: Chirp (natural) é o padrão; WaveNet é a econômica. */
export const CHAVE_MOTOR = 'ck-conversa-motor';
export const MOTORES = ['chirp', 'wavenet', 'minimax'] as const;
export type Motor = (typeof MOTORES)[number];

export function leMotor(bruto: string | null | undefined): Motor {
  return MOTORES.find((motor) => motor === bruto) ?? 'chirp';
}

/** Fora de React (o pedido da fala): lê direto do aparelho; no servidor, o padrão. */
export function motorGravado(): Motor {
  try {
    return leMotor(typeof window === 'undefined' ? null : window.localStorage.getItem(CHAVE_MOTOR));
  } catch {
    return 'chirp';
  }
}
