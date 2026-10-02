'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { createControleEnvio } from './controle-envio.ts';
import { assinaEntrega } from './eco-pendente.ts';
import type { EstadoEnvio } from './envio.ts';
import type { OrigemEnvio } from './leitura-do-envio.ts';

/* O envio do composer em quatro peças: este hook, o controle
 * (`controle-envio.ts`), a leitura do que o servidor diz
 * (`leitura-do-envio.ts`) e a observação do stream (`observacao-do-eco.ts`).
 * Quem importa daqui continua importando daqui. */
export { createControleEnvio } from './controle-envio.ts';
export { MARCA_VOZ, type OrigemEnvio } from './leitura-do-envio.ts';
export type {
  ConstrutorFonteEventosEnvio,
  FonteEventosEnvio,
} from './observacao-do-eco.ts';

export function usaEnvio(agentSlug: string): {
  estado: EstadoEnvio;
  enviar: (texto: string, aoFalhar?: () => void, origem?: OrigemEnvio) => Promise<void>;
  reenviar: (aoFalhar?: () => void) => Promise<void>;
} {
  const controle = useMemo(() => createControleEnvio(agentSlug), [agentSlug]);
  const estado = useSyncExternalStore(
    controle.subscribe,
    controle.getEstado,
    controle.getEstado,
  );

  useEffect(() => {
    return () => controle.dispose();
  }, [controle]);

  // O recibo que não vem do SSE. O eco do stream leva 18,9 s medidos, e a
  // bolha otimista não podia esperar por isso. Quem não tiver pendência não
  // publica nada.
  useEffect(
    () => assinaEntrega(agentSlug, (texto) => controle.confirmarPorEco(texto)),
    [agentSlug, controle],
  );

  return {
    estado,
    enviar: controle.enviar,
    reenviar: controle.reenviar,
  };
}
