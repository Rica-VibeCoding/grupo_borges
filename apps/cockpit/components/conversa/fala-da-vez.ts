/**
 * O texto da vez do Rica na tela (fase 4, item 6) — PURO. Dois pedaços:
 * - `parcial`: as palavras do canal ao vivo enquanto ele fala. Só aparece na vez dele
 *   (`ouvindo`, `transcrevendo`) e nunca vai ao agente;
 * - `firme`: o texto que a máquina ACEITOU (`transcreveu` com ela em `transcrevendo`). É o
 *   "Você disse" do resto da vez — esperando, respondendo, ou no erro do envio desta fala.
 *
 * Tudo zera quando a vez volta ao Rica. Em 28/09 o iPhone mostrou "Não entendi o áudio" com o
 * texto de uma fala anterior: o texto era gravado em todo `transcreveu`, até no recusado, e
 * nunca apagado. Texto na tela junto de "Não entendi" era sempre de outra fala.
 */
import type { Estado, Evento } from '../../lib/conversa/tipos.ts';

import { textoDoCanal } from './transcricao-da-fala.ts';

export type FalaDaVez = { firme: string | null; parcial: string | null };
export const FALA_VAZIA: FalaDaVez = { firme: null, parcial: null };

const vezDoRica = (estado: Estado) => estado === 'ouvindo' || estado === 'transcrevendo';

/** A máquina foi de `antes` a `depois` com `evento`. */
export function falaDepois(fala: FalaDaVez, antes: Estado, evento: Evento, depois: Estado): FalaDaVez {
  if (depois === 'ouvindo' && antes !== 'ouvindo') return FALA_VAZIA;
  // A máquina só aceita o texto em `transcrevendo`; fora dele, o texto é de ninguém.
  if (evento.tipo === 'transcreveu' && antes === 'transcrevendo') {
    return { firme: textoDoCanal(evento.texto), parcial: null };
  }
  if (!vezDoRica(depois) && fala.parcial !== null) return { ...fala, parcial: null };
  return fala;
}

/** Palavras novas do canal (`null` = o áudio dele saiu do canal: tosse, fala descartada). */
export function comParcial(fala: FalaDaVez, estado: Estado, texto: string | null): FalaDaVez {
  if (!vezDoRica(estado) || fala.firme !== null) return fala;
  const parcial = textoDoCanal(texto);
  return parcial === fala.parcial ? fala : { ...fala, parcial };
}
