/**
 * O estado do agente em palavra e tom — UMA régua para a pílula da voz, a pílula da gaveta e o
 * rótulo do pulso. Duas fontes entram: o status da frota (vale sempre) e a cena da tela de voz,
 * quando ela está aberta e a conversa anda (ouvindo, pensando, falando…), que é mais rica e vence.
 * Cena de repouso (parado, preparando) não diz nada do agente: aí quem fala é a frota.
 *
 * Módulo neutro — sem React — para o teste e o servidor.
 */
import type { AgentStatus } from '@grupo_borges/cockpit-core/cockpit-types';

import { rotuloDoEstado } from '../conversa/direcao-da-voz.ts';
import { tomDaCena, type Cena, type Tom } from '../conversa/moldura-estado.ts';

/** Os tons de estado do sistema (`--ck-tom-*` no globals.css). */
export type TomDeEstado = Tom;

export type EstadoDaPilula = { tom: TomDeEstado; rotulo: string };

/** O status da frota no MESMO vocabulário da voz: trabalhando é a cena "trabalhando", ocioso é "parado". */
const DA_FROTA: Record<Exclude<AgentStatus, 'aguardando'>, Cena> = {
  trabalhando: 'trabalhando',
  ocioso: 'parado',
  offline: 'desligado',
};

const daCena = (cena: Cena): EstadoDaPilula => ({ tom: tomDaCena(cena), rotulo: rotuloDoEstado(cena) });

export function estadoDaPilula(status: AgentStatus | undefined, cenaDaVoz: Cena | null): EstadoDaPilula {
  if (status === 'offline') return daCena('desligado');
  if (cenaDaVoz && cenaDaVoz !== 'parado' && cenaDaVoz !== 'preparando') return daCena(cenaDaVoz);
  // O único estado da frota sem cena na voz: ele parou e chama você.
  if (status === 'aguardando') return { tom: 'voce', rotulo: 'esperando você' };
  if (status === 'trabalhando') return daCena(DA_FROTA.trabalhando);
  return daCena(cenaDaVoz ?? DA_FROTA.ocioso);
}
