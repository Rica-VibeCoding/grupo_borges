/**
 * A memória interna da máquina do modo conversa e os três jeitos de sair de uma transição
 * (`novo`, `preserva`, `noop`). Mora à parte porque a máquina (`maquina.ts`) e a fala por cima
 * (`fala-por-cima.ts`) montam o resultado do mesmo jeito; `tipos.ts` segue sendo o contrato público.
 */

import type { Conversa, Efeito, Estado } from './tipos.ts';

export type ConversaInterna = Conversa & {
  fone?: boolean; // chave "estou de fone" — a única memória que atravessa estados
  capturando?: boolean;
  enviando?: boolean;
  vozGuardada?: boolean;
  zeAcabou?: boolean; // `zeTerminou` já veio neste turno de `falando`/`interrompendo`
  vozAcabou?: boolean; // `vozTerminou` já veio neste turno de `falando`/`interrompendo`
  interrompeuEm?: number; // `agora` do `falaIniciou`; base do relógio de desclassificação
  zeDescartado?: boolean; // turno do Zé descartado (fala por cima ou toque que parou); residual é ignorado
  daEspera?: boolean; // a fala começou com o Zé pensando: se não virar pedido, volta a esperar por ele
};

export type Resultado = { conversa: Conversa; efeitos: Efeito[] };

export const LIGA: Efeito = { tipo: 'ligarDetector' };
export const DESLIGA: Efeito = { tipo: 'desligarDetector' };

// Estado novo, memória zerada — só o que vem em `extra` sobrevive, e sempre a chave
// `fone`, que vale em qualquer estado, inclusive `parado`.
export const novo = (
  c: ConversaInterna,
  estado: Estado,
  efeitos: Efeito[] = [],
  extra: Partial<ConversaInterna> = {},
): Resultado => ({ conversa: { estado, fone: c.fone, ...extra }, efeitos });

// Preserva a memória (mesmo estado) e aplica `extra`.
export const preserva = (
  c: ConversaInterna,
  efeitos: Efeito[] = [],
  extra: Partial<ConversaInterna> = {},
): Resultado => ({ conversa: { ...c, ...extra }, efeitos });

export const noop = (c: ConversaInterna): Resultado => ({ conversa: c, efeitos: [] });
