import type { GestoDaConversa } from './gesto-de-arrasto.ts';
import type { Cena } from './moldura-estado.ts';

/**
 * Segurar a tela para pensar (fase 4, desenho aceito pelo Rica em 27/09). Na vez dele, o
 * dedo parado por 500 ms segura a vez: a contagem do silêncio para enquanto o dedo estiver
 * na tela, e soltar volta a contar os 2 s inteiros. O toque rápido continua parando a
 * conversa; o dedo que anda é gesto e não segura. Fora da vez dele, o dedo parado não faz
 * nada — e o soltar desse dedo também não vira toque.
 */
export const SEGURAR_MS = 500;

/** A vez é do Rica: ouvindo, com ou sem fala detectada. */
export function podeSegurar(cena: Cena): boolean {
  return cena === 'ouvindo';
}

/**
 * A história do dedo até o soltar: `rapido` ainda não fez nada; `andou` passou do raio do
 * toque; `parado` ficou 500 ms fora da vez do Rica; `segurando` ficou 500 ms na vez dele.
 */
export type Dedo = 'rapido' | 'andou' | 'parado' | 'segurando';

/** O dedo passou do raio do toque. Depois de parado ou segurando, andar não muda nada. */
export function dedoQueAnda(dedo: Dedo): Dedo {
  return dedo === 'rapido' ? 'andou' : dedo;
}

/** Aos 500 ms de dedo na tela: parado na vez do Rica segura; em outra cena, só fica parado. */
export function dedoAosQuinhentos(dedo: Dedo, cena: Cena): Dedo {
  if (dedo !== 'rapido') return dedo;
  return podeSegurar(cena) ? 'segurando' : 'parado';
}

export type AoSoltar = 'solta' | GestoDaConversa;

/**
 * O que o soltar faz: `solta` devolve a contagem do silêncio; o dedo parado não faz nada;
 * o rápido e o que andou são o gesto de sempre (toque, configurações ou nada).
 */
export function aoSoltar(dedo: Dedo, gesto: GestoDaConversa): AoSoltar {
  if (dedo === 'segurando') return 'solta';
  if (dedo === 'parado') return 'nada';
  return gesto;
}
