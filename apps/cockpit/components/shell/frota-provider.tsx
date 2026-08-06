'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { FleetResponse } from '@grupo_borges/cockpit-core/cockpit-types';
import { useFrotaAoVivo } from '@/lib/usa-frota-ao-vivo';

const FrotaContext = createContext<FleetResponse | null>(null);

export function FrotaProvider({
  initialFleet,
  children,
}: {
  initialFleet: FleetResponse;
  children: ReactNode;
}) {
  const fleet = useFrotaAoVivo(initialFleet);
  return <FrotaContext.Provider value={fleet}>{children}</FrotaContext.Provider>;
}

export function usaFrota(): FleetResponse {
  const fleet = useContext(FrotaContext);
  if (!fleet) throw new Error('usaFrota deve ser usado dentro de <FrotaProvider>');
  return fleet;
}
