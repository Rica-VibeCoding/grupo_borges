'use client';

import { useEffect, useRef, useState } from 'react';

import {
  andamentoDoChip,
  esperaVenceu,
  podeReenviar,
  proximaEspera,
  type DesfechoDoPedido,
  type EsperaDaTroca,
  type PedidoDeTroca,
} from './troca-em-espera.ts';

const PASSO_DO_RELOGIO_MS = 1_000;

/** O chip que espera o agente terminar e reenvia sozinho (27/09). A regra mora
 *  em `troca-em-espera.ts`; aqui só o relógio e o estado do React. */
export function usaTrocaEmEspera(
  status: string | null | undefined,
  executar: (pedido: PedidoDeTroca) => Promise<DesfechoDoPedido>,
  aoDesistir: () => void,
) {
  const [espera, setEspera] = useState<EsperaDaTroca | null>(null);
  const [voando, setVoando] = useState<PedidoDeTroca | null>(null);
  const emVoo = voando !== null;
  const ultimaTentativa = useRef(0);
  // Cancelar ou escolher de novo invalida o envio em voo: se ele voltar
  // "ocupado", não rearma uma espera que o Rica já largou.
  const geracao = useRef(0);
  const executarAtual = useRef(executar);
  executarAtual.current = executar;
  const desistirAtual = useRef(aoDesistir);
  desistirAtual.current = aoDesistir;

  async function enviar(pedido: PedidoDeTroca, esperaAtual: EsperaDaTroca | null) {
    const minha = geracao.current;
    ultimaTentativa.current = Date.now();
    setVoando(pedido);
    let desfecho: DesfechoDoPedido = 'falhou';
    try {
      desfecho = await executarAtual.current(pedido);
    } finally {
      if (minha === geracao.current) {
        setVoando(null);
        setEspera(proximaEspera(esperaAtual, pedido, desfecho, Date.now()));
      }
    }
  }

  function pedir(pedido: PedidoDeTroca) {
    geracao.current += 1;
    setEspera(null);
    void enviar(pedido, null);
  }

  function cancelar() {
    geracao.current += 1;
    setEspera(null);
    setVoando(null);
  }

  useEffect(() => {
    if (!espera) return;
    const relogio = setInterval(() => {
      const agora = Date.now();
      if (esperaVenceu(espera, agora)) {
        geracao.current += 1;
        setEspera(null);
        desistirAtual.current();
        return;
      }
      if (podeReenviar({ espera, emVoo, status, ultimaTentativaMs: ultimaTentativa.current, agoraMs: agora })) {
        void enviar(espera.pedido, espera);
      }
    }, PASSO_DO_RELOGIO_MS);
    return () => clearInterval(relogio);
  }, [espera, emVoo, status]);

  return {
    espera,
    emVoo,
    /** O valor escolhido que está trocando ou esperando. */
    pedido: voando ?? espera?.pedido ?? null,
    andamento: andamentoDoChip({ espera, emVoo }),
    andamentoLongo: andamentoDoChip({ espera, emVoo }, true),
    pedir,
    cancelar,
  };
}
