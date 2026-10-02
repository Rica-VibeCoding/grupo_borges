/**
 * Uma fala na vez dele, sem fone (02/10). Sem fone, a espera não ouve: no iPhone, microfone vivo
 * põe o áudio em modo de chamada (`maquina.ts`). O botão do microfone abre a escuta só para uma
 * fala — sem frear o Zé; a fala vai para a fila da fala e sai quando o turno fechar — e, terminada
 * a fala, o microfone volta a fechar sozinho (`encerraCaptura` desliga, `enviou` não religa).
 * Com fone nada disso existe: a espera já ouve.
 */

import { DESLIGA, LIGA, novo, noop } from './conversa-interna.ts';
import type { ConversaInterna, Resultado } from './conversa-interna.ts';
import type { Conversa } from './tipos.ts';

/** O microfone está aberto só para esta fala, com o Zé ainda no turno dele. */
export const umaFalaAberta = (c: Conversa): boolean => {
  const i = c as ConversaInterna;
  return i.estado === 'ouvindo' && i.umaFala === true && i.zeAcabou !== true;
};

/** O toque no botão com o Zé pensando ou trabalhando: abre para uma fala, sem freio. */
export function abrirUmaFala(c: ConversaInterna): Resultado {
  if (c.estado !== 'esperandoZe' || c.fone === true) return noop(c);
  return novo(c, 'ouvindo', [LIGA], { daEspera: true, umaFala: true, zeDescartado: c.zeDescartado });
}

/** O toque de novo, antes de começar a falar: fecha e volta a esperar por ele. Falando, a fala segue. */
export function fecharUmaFala(c: ConversaInterna & { segurando?: boolean }): Resultado {
  if (!umaFalaAberta(c) || c.capturando || c.segurando) return noop(c);
  return novo(c, 'esperandoZe', [DESLIGA], { zeDescartado: c.zeDescartado });
}
