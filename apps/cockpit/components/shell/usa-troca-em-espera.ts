'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';

import { esperasDeTroca } from './esperas-de-troca.ts';
import { andamentoDoChip, type DesfechoDoPedido, type PedidoDeTroca } from './troca-em-espera.ts';

const VAZIO = { espera: null, voando: null, desistiu: false };

/** O chip que espera o agente terminar e reenvia sozinho (27/09). A espera mora
 *  em `esperas-de-troca.ts`, por slug, e sobrevive à troca de agente (28/09);
 *  aqui só a ponte com o React. */
export function usaTrocaEmEspera(
  slug: string,
  executar: (pedido: PedidoDeTroca) => Promise<DesfechoDoPedido>,
  aoDesistir: () => void,
) {
  const executarAtual = useRef(executar);
  executarAtual.current = executar;

  useEffect(() => {
    esperasDeTroca.registrarExecutor(slug, (pedido) => executarAtual.current(pedido));
  }, [slug]);

  const estado = useSyncExternalStore(
    (fn) => esperasDeTroca.assinar(slug, fn),
    () => esperasDeTroca.ler(slug),
    () => VAZIO,
  );

  useEffect(() => {
    if (!estado.desistiu) return;
    aoDesistir();
    esperasDeTroca.esquecerDesistencia(slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispara na desistência, só
  }, [estado.desistiu, slug]);

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
