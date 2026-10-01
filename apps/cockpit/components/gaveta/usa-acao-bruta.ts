'use client';

/**
 * A máquina do Desligar (armar → confirmar → enviar → recibo), tirada do
 * `bloco-de-acoes.tsx` sem mudar uma regra — lá estão os porquês. Aqui só
 * mudou o endereço, porque a gaveta nova desenha o Desligar como interruptor.
 */
import { useEffect, useRef, useState } from 'react';
import { postAgentDesligar } from '@grupo_borges/cockpit-core/api';

import {
  CONFIRMA_ACAO_MS,
  RECIBO_MS,
  diagnosticaCicloDeVida,
  leiaDesligar,
  type AcaoBruta,
  type FaseBruta,
  type Impedimento,
} from '../shell/acoes-rapidas';

const REDE = { desliga: postAgentDesligar };

export function usaAcaoBruta(
  agentSlug: string,
  aberto: boolean,
  setFalha: (falha: Impedimento | null) => void,
  aoConcluir: () => void,
) {
  const [estado, setEstado] = useState<{ acao: AcaoBruta; fase: FaseBruta } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (aberto) return;
    setEstado((atual) => (atual?.fase === 'confirmando' ? null : atual));
    if (timer.current) clearTimeout(timer.current);
  }, [aberto]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function acionar(acao: AcaoBruta) {
    if (estado?.fase === 'enviando') return;

    if (estado?.acao !== acao || estado.fase !== 'confirmando') {
      setFalha(null);
      setEstado({ acao, fase: 'confirmando' });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setEstado((atual) => (atual?.fase === 'confirmando' ? null : atual));
      }, CONFIRMA_ACAO_MS);
      return;
    }

    if (timer.current) clearTimeout(timer.current);
    setFalha(null);
    setEstado({ acao, fase: 'enviando' });
    try {
      const aviso = leiaDesligar(await REDE.desliga(agentSlug));
      if (aviso) {
        setFalha(aviso);
        setEstado(null);
        aoConcluir();
        return;
      }
      setEstado({ acao, fase: 'concluido' });
      aoConcluir();
      timer.current = setTimeout(() => setEstado(null), RECIBO_MS);
    } catch (erro) {
      setEstado(null);
      setFalha(diagnosticaCicloDeVida(erro, 'desligar'));
    }
  }

  const faseDe = (acao: AcaoBruta): FaseBruta => (estado?.acao === acao ? estado.fase : 'ocioso');
  return { faseDe, acionar } as const;
}
