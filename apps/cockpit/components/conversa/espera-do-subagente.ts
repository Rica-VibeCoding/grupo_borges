/**
 * A régua da espera pelo subagente (`use-espera-do-subagente.ts`): enquanto ela vale, o toque não
 * freia e o fim do trabalho sem turno novo devolve a vez ao Rica. Cai quando o turno dele abre
 * (`rodando`) ou a conversa sai da espera de vez. A fala do Rica dentro da espera — a tosse com
 * fone, a uma fala sem fone — não é saída: se não virar pedido, volta a esperar o mesmo trabalho.
 */

import type { ConversaInterna } from '../../lib/conversa/conversa-interna.ts';
import type { Conversa } from '../../lib/conversa/tipos.ts';

export function esperaSegue(conversa: Conversa, rodando: boolean): boolean {
  if (rodando) return false;
  const c = conversa as ConversaInterna;
  // A voz do que ficou por tocar ainda é a mesma espera.
  if (c.estado === 'esperandoZe' || c.estado === 'falando') return true;
  // A fala que começou na espera: segue até virar pedido (`enviando`) ou um turno fechar nela.
  return (c.estado === 'ouvindo' || c.estado === 'transcrevendo') && c.daEspera === true && !c.enviando && !c.zeAcabou;
}
