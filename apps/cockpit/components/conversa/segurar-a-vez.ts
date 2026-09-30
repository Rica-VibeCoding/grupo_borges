import type { GestoDaConversa } from './gesto-de-arrasto.ts';
import type { Cena } from './moldura-estado.ts';

/**
 * Segurar a tela para pensar (fase 4, desenho aceito pelo Rica em 27/09). Na vez dele, o
 * dedo parado por 500 ms segura a vez: a contagem do silêncio para enquanto o dedo estiver
 * na tela, e soltar volta a contar os 2 s inteiros. O toque rápido continua parando a
 * conversa; o dedo que anda é gesto e não segura. Fora da vez dele, dedo parado é toque,
 * curto ou longo — um toque firme no iPhone passa de 500 ms fácil, e ele tem de começar.
 */
export const SEGURAR_MS = 500;

/** A vez é do Rica: ouvindo, com ou sem fala detectada. */
export function podeSegurar(cena: Cena): boolean {
  return cena === 'ouvindo';
}

/**
 * A história do dedo até o soltar: `toque` não andou nem segurou, dure o que durar; `andou`
 * passou do raio do toque; `segurando` ficou 500 ms parado na vez do Rica.
 */
export type Dedo = 'toque' | 'andou' | 'segurando';

/** O dedo passou do raio do toque. Depois de segurar, andar não muda nada. */
export function dedoQueAnda(dedo: Dedo): Dedo {
  return dedo === 'toque' ? 'andou' : dedo;
}

/** Aos 500 ms de dedo na tela: parado na vez do Rica segura; em outra cena, segue toque. */
export function dedoAosQuinhentos(dedo: Dedo, cena: Cena): Dedo {
  return dedo === 'toque' && podeSegurar(cena) ? 'segurando' : dedo;
}

export type AoSoltar = 'solta' | GestoDaConversa;

/**
 * O que o soltar faz: `solta` devolve a contagem do silêncio; o resto é o gesto de sempre
 * (toque, cima ou nada).
 */
export function aoSoltar(dedo: Dedo, gesto: GestoDaConversa): AoSoltar {
  return dedo === 'segurando' ? 'solta' : gesto;
}
