'use client';

/**
 * Estado e rede da gaveta nova — o MESMO ciclo do `BlocoDeAcoes` (leitura do
 * `/painel` com backoff, Destravar com a trava do compact, Ligar com as
 * releituras do boot, Desligar armado, pulso, operação de motor), copiado sem
 * mudar regra. O `bloco-de-acoes.tsx` foi removido; os porquês de cada linha
 * moram nos comentários dele, no `git log`. Aqui o
 * hook devolve só o que a forma nova precisa desenhar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchAgentPainel,
  postAgentDestrava,
  postAgentLigar,
} from '@grupo_borges/cockpit-core/api';
import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import {
  RECIBO_MS,
  RETENTA_PAINEL_BASE_MS,
  RETENTA_PAINEL_TETO_MS,
  ESPERAS_APOS_LIGAR_MS,
  descreveAcaoBruta,
  diagnosticaCicloDeVida,
  leiaDestrava,
  leiaLigar,
  type FaseDestrava,
  type Impedimento,
} from '../shell/acoes-rapidas';
import { usaPulso } from '../shell/faixa-do-pulso';
import { sinalizarPainel } from '../shell/operacao-de-motor.ts';
import { usaOperacaoDeMotor } from '../shell/usa-operacao-de-motor.ts';
import { usaCompact } from '../../lib/compact';
import { usePainelAberto } from '../shell/superficie-otimista';
import { publicarPainel } from '../shell/sincronizacao-painel';
import { usaAcaoBruta } from './usa-acao-bruta';

const CONFIRMA_COMPACT_MS = 4_000;

const REDE = {
  lePainel: fetchAgentPainel,
  destrava: postAgentDestrava,
  liga: postAgentLigar,
};

export type Carga = 'ocioso' | 'carregando' | 'pronto' | 'indisponivel';

export function usaVidaDoAgente(agentSlug: string, abertoDoServidor: boolean) {
  const aberto = usePainelAberto(abertoDoServidor);

  const [painel, setPainel] = useState<AgentPainelResponse | null>(null);
  const [carga, setCarga] = useState<Carga>('ocioso');
  const [falha, setFalha] = useState<Impedimento | null>(null);
  const [destrava, setDestrava] = useState<FaseDestrava>('ocioso');
  const [ligar, setLigar] = useState<FaseDestrava>('ocioso');
  const [retentativa, setRetentativa] = useState(0);
  const operacao = usaOperacaoDeMotor(agentSlug);
  const aplicandoMotor = operacao.fase === 'aplicando';

  const { estado: estadoCompact, cancelar: cancelarCompact } = usaCompact(agentSlug);
  const compactEmVoo = estadoCompact.fase === 'compactando';
  const [confirmaCompact, setConfirmaCompact] = useState(false);
  const confirmaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (compactEmVoo) return;
    setConfirmaCompact(false);
    if (confirmaTimer.current) clearTimeout(confirmaTimer.current);
  }, [compactEmVoo, aberto]);

  useEffect(
    () => () => {
      if (confirmaTimer.current) clearTimeout(confirmaTimer.current);
    },
    [],
  );

  const reciboTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const timersDoBoot = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => {
    timersDoBoot.current.forEach(clearTimeout);
    timersDoBoot.current = [];
  }, []);

  const leituras = useMemo(() => ({ ativa: false, sequencia: 0 }), [agentSlug]);
  useEffect(() => {
    leituras.ativa = true;
    return () => { leituras.ativa = false; leituras.sequencia += 1; };
  }, [leituras]);

  const buscar = useCallback(
    (signal?: AbortSignal) => {
      if (!leituras.ativa) return;
      const minha = ++leituras.sequencia;
      setCarga((atual) => (atual === 'pronto' ? atual : 'carregando'));
      REDE
        .lePainel(agentSlug, signal)
        .then((novo) => {
          if (signal?.aborted || !leituras.ativa || minha !== leituras.sequencia || novo.slug !== agentSlug) return;
          setPainel(novo);
          publicarPainel(novo);
          sinalizarPainel(novo);
          setCarga('pronto');
        })
        .catch(() => {
          if (signal?.aborted || !leituras.ativa || minha !== leituras.sequencia) return;
          setCarga('indisponivel');
        });
    },
    [agentSlug, leituras],
  );

  const { faseDe: faseBruta, acionar: acionarBruta } = usaAcaoBruta(
    agentSlug,
    aberto,
    setFalha,
    buscar,
  );
  const desligar = faseBruta('desligar');
  const pulso = usaPulso(agentSlug, aberto);
  const semSinal = pulso.leitura?.tom === 'sem-sinal';

  const sessao = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!aberto) {
      setFalha(null);
      return;
    }
    const controlador = new AbortController();
    sessao.current = controlador;
    buscar(controlador.signal);
    return () => controlador.abort();
  }, [aberto, buscar]);

  useEffect(() => {
    if (!aberto || carga === 'pronto') {
      if (retentativa !== 0) setRetentativa(0);
      return;
    }
    if (carga !== 'indisponivel') return;
    const espera = Math.min(
      RETENTA_PAINEL_BASE_MS * 2 ** retentativa,
      RETENTA_PAINEL_TETO_MS,
    );
    const agendado = setTimeout(() => {
      setRetentativa((n) => n + 1);
      buscar(sessao.current?.signal);
    }, espera);
    return () => clearTimeout(agendado);
  }, [aberto, carga, retentativa, buscar]);

  useEffect(
    () => () => {
      if (reciboTimer.current) clearTimeout(reciboTimer.current);
    },
    [],
  );

  async function acionarDestrava() {
    if (destrava === 'enviando') return;
    if (compactEmVoo && !confirmaCompact) {
      setConfirmaCompact(true);
      if (confirmaTimer.current) clearTimeout(confirmaTimer.current);
      confirmaTimer.current = setTimeout(() => setConfirmaCompact(false), CONFIRMA_COMPACT_MS);
      return;
    }
    if (confirmaCompact) {
      setConfirmaCompact(false);
      if (confirmaTimer.current) clearTimeout(confirmaTimer.current);
      cancelarCompact();
    }
    setFalha(null);
    setDestrava('enviando');
    try {
      const resposta = await REDE.destrava(agentSlug);
      const aviso = leiaDestrava(resposta);
      if (aviso) {
        setFalha(aviso);
        setDestrava('ocioso');
        return;
      }
      setDestrava('entregue');
      if (reciboTimer.current) clearTimeout(reciboTimer.current);
      reciboTimer.current = setTimeout(() => setDestrava('ocioso'), RECIBO_MS);
    } catch (erro) {
      setDestrava('ocioso');
      setFalha({
        resumo: erro instanceof Error ? 'o destrava não chegou ao servidor' : 'o destrava falhou',
        saida: 'tente de novo; se repetir, a sessão do agente pode estar fora do ar',
      });
    }
  }

  async function acionarLigar() {
    if (ligar === 'enviando') return;
    setFalha(null);
    setLigar('enviando');
    try {
      const aviso = leiaLigar(await REDE.liga(agentSlug));
      buscar();
      timersDoBoot.current.forEach(clearTimeout);
      timersDoBoot.current = ESPERAS_APOS_LIGAR_MS.map((ms) => setTimeout(() => buscar(), ms));
      if (aviso) {
        setFalha(aviso);
        setLigar('ocioso');
        return;
      }
      setLigar('entregue');
      if (reciboTimer.current) clearTimeout(reciboTimer.current);
      reciboTimer.current = setTimeout(() => setLigar('ocioso'), RECIBO_MS);
    } catch (erro) {
      setLigar('ocioso');
      setFalha(diagnosticaCicloDeVida(erro, 'ligar'));
    }
  }

  const dePe = painel?.vida.processo ?? true;


  const avisoConfirmacao =
    confirmaCompact && compactEmVoo
      ? 'Confirmar? Destravar agora interrompe o resumo do compact — tocar de novo confirma'
      : desligar === 'confirmando'
        ? descreveAcaoBruta(desligar)
        : null;

  return {
    aberto,
    painel,
    carga,
    falha,
    setFalha,
    buscar,
    destrava,
    ligar,
    desligar,
    pulso,
    semSinal,
    dePe,
    operacao,
    aplicandoMotor,
    confirmaCompact,
    compactEmVoo,
    avisoConfirmacao,
    acionarDestrava,
    acionarLigar,
    acionarDesligar: () => acionarBruta('desligar'),
  };
}
