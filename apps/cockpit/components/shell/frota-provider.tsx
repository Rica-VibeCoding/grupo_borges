'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';

import type { FleetResponse } from '@grupo_borges/cockpit-core/cockpit-types';
import { useFrotaAoVivo } from '@/lib/usa-frota-ao-vivo';
import { esperasDeTroca } from './esperas-de-troca-cliente.ts';

const FrotaContext = createContext<FleetResponse | null>(null);

export function FrotaProvider({
  initialFleet,
  children,
}: {
  initialFleet: FleetResponse;
  children: ReactNode;
}) {
  const fleet = useFrotaAoVivo(initialFleet);
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
