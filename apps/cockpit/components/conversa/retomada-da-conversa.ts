import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { textosDoZeDepoisDe, type TextoDoZe } from './textos-do-ze.ts';

/**
 * A conversa sobrevive à recarga da página (Rica, 28/09) — PURO. Recarregar voltava a tela ao
 * "parado" e perdia a conversa; em produção, todo deploy na 3008 recarrega o iPhone.
 *
 * O aparelho guarda (`sessionStorage`, por agente) só uma marca: até que texto dele a voz já
 * TOCOU INTEIRO. O resto se lê do stream, que reaparece depois da recarga: se ele segue no turno
 * e o que falta tocar. Parar apaga a marca.
 *
 * O navegador não toca som nem abre o microfone sem gesto numa página recém-carregada (a
 * ativação do usuário não sobrevive à recarga): a tela mostra o estado verdadeiro e **um toque**
 * retoma — toca o que ficou e segue a conversa.
 */

export type Guardado = { v: 1; ouvidoAte: number; em: number };

export const CHAVE_RETOMADA = 'ck-conversa-retomada';
export const chaveDaRetomada = (slug: string) => `${CHAVE_RETOMADA}:${slug}`;

/** Marca mais velha que isso não retoma: é outra conversa, não a que a recarga cortou. */
export const VALIDADE_MS = 30 * 60 * 1000;

export function gravaGuardado(g: Guardado): string {
  return JSON.stringify(g);
}

export function leGuardado(bruto: string | null | undefined, agora: number): Guardado | null {
  if (!bruto) return null;
  try {
    const g = JSON.parse(bruto) as Partial<Guardado>;
    if (g.v !== 1 || !Number.isFinite(g.ouvidoAte) || !Number.isFinite(g.em)) return null;
    if (agora - (g.em as number) > VALIDADE_MS) return null;
    return { v: 1, ouvidoAte: g.ouvidoAte as number, em: g.em as number };
  } catch {
    return null;
  }
}

/**
 * O que a tela mostra antes do toque, e o que o toque faz. `esperandoZe` = ele segue no turno e
 * não há o que tocar (pensando/trabalhando); `pronta` = há resposta dele que ainda não tocou.
 */
export type Retomada = { cena: 'esperandoZe' | 'pronta'; pendentes: TextoDoZe[]; emVoo: boolean };

/**
 * `null` = nada a retomar: abre em "parado", como antes. Sem marca guardada (conversa nova, ou
 * parada) e ele no turno, abre pensando: o log inteiro conta como ouvido (`use-retomada`).
 */
export function retomadaDoStream(
  g: Guardado | null,
  mensagens: readonly MessagePayload[],
  emVoo: boolean,
): Retomada | null {
  if (!g) return emVoo ? { cena: 'esperandoZe', pendentes: [], emVoo } : null;
  const pendentes = textosDoZeDepoisDe(mensagens, g.ouvidoAte);
  if (pendentes.length > 0) return { cena: 'pronta', pendentes, emVoo };
  return emVoo ? { cena: 'esperandoZe', pendentes: [], emVoo } : null;
}

export type PassoDaRetomada = { tipo: 'retomar' } | { tipo: 'texto'; id: number; texto: string } | { tipo: 'fecha' };

/**
 * O toque, em ordem: volta a esperar por ele, entrega o que ficou por tocar e, se o turno dele já
 * acabou, fecha — a voz termina e a conversa volta a ouvir. Com ele ainda no turno, o resto chega
 * pelo stream como sempre.
 */
export function passosDaRetomada(r: Retomada): PassoDaRetomada[] {
  const passos: PassoDaRetomada[] = [{ tipo: 'retomar' }];
  for (const p of r.pendentes) passos.push({ tipo: 'texto', id: p.id, texto: p.texto });
  if (r.pendentes.length > 0 && !r.emVoo) passos.push({ tipo: 'fecha' });
  return passos;
}
