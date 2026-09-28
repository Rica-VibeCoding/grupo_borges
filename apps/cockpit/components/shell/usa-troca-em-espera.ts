'use client';

import { useEffect, useSyncExternalStore } from 'react';

import { esperasDeTroca } from './esperas-de-troca-cliente.ts';
import type { EstadoDaEspera } from './esperas-de-troca.ts';
import { andamentoDoChip, type PedidoDeTroca } from './troca-em-espera.ts';

const VAZIO: EstadoDaEspera = { espera: null, voando: null, recado: null };

/** O chip que espera o agente terminar e reenvia sozinho (27/09). A espera e o
 *  envio moram fora do React, por slug, e sobrevivem à troca de agente (28/09);
 *  aqui só a ponte. O recado guardado — falha, teto vencido — é entregue ao chip
 *  montado uma vez, mesmo que tenha nascido com ele desmontado. */
export function usaTrocaEmEspera(slug: string, aoRecado: (texto: string) => void) {
  const estado = useSyncExternalStore(
    (fn) => esperasDeTroca.assinar(slug, fn),
    () => esperasDeTroca.ler(slug),
    () => VAZIO,
  );

  useEffect(() => {
    if (!estado.recado) return;
    aoRecado(estado.recado);
    esperasDeTroca.esquecerRecado(slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispara no recado, só
  }, [estado.recado, slug]);

  const emVoo = estado.voando !== null;
  return {
    espera: estado.espera,
    emVoo,
    /** O valor escolhido que está trocando ou esperando. */
    pedido: estado.voando ?? estado.espera?.pedido ?? null,
    andamento: andamentoDoChip({ espera: estado.espera, emVoo }),
    andamentoLongo: andamentoDoChip({ espera: estado.espera, emVoo }, true),
    pedir: (pedido: PedidoDeTroca) => void esperasDeTroca.pedir(slug, pedido),
    cancelar: () => esperasDeTroca.cancelar(slug),
  };
}
