'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';

import type { FleetResponse } from '@grupo_borges/cockpit-core/cockpit-types';
import { MODO_CLIENTE } from '@/lib/modo';
import { useFrotaAoVivo } from '@/lib/usa-frota-ao-vivo';
import { useFrotaDoCliente } from '@/lib/usa-frota-do-cliente';
import { esperasDeTroca } from './esperas-de-troca-cliente.ts';

const FrotaContext = createContext<FleetResponse | null>(null);

// O modo é de build: a escolha é constante no bundle, então o hook chamado é
// sempre o mesmo em toda renderização (regra dos hooks preservada). O painel
// do cliente não tem `/api/fleet` nem `/api/stream` — ver `frota-do-cliente.ts`.
const useFrotaViva = MODO_CLIENTE ? useFrotaDoCliente : useFrotaAoVivo;

export function FrotaProvider({
  initialFleet,
  children,
}: {
  initialFleet: FleetResponse;
  children: ReactNode;
}) {
  const fleet = useFrotaViva(initialFleet);
  // A troca de motor que espera o agente terminar precisa do status de TODOS
  // os agentes, não só do aberto: ela segue reenviando com o Rica em outra tela.
  useEffect(() => {
    for (const agente of fleet.agents) esperasDeTroca.informarStatus(agente.slug, agente.status);
  }, [fleet]);
  return <FrotaContext.Provider value={fleet}>{children}</FrotaContext.Provider>;
}

export function usaFrota(): FleetResponse {
  const fleet = useContext(FrotaContext);
  if (!fleet) throw new Error('usaFrota deve ser usado dentro de <FrotaProvider>');
  return fleet;
}
