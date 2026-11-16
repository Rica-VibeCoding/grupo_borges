'use client';

/**
 * A troca de um toque, fora do Histórico (F16): a Nova conversa da gaveta e o
 * "Voltar pra anterior" do chat.
 *
 * Mesma régua do Continuar esta: parado, um toque troca; ocupado, o botão já
 * vem âmbar e o toque interrompe; a frota dizia parado e a API respondeu 409
 * `ocupado`, o botão vira âmbar e espera o segundo toque.
 *
 * O pedido entra no store antes do POST para identificar o aviso do stream.
 * A espera do chat e a leitura do `/operacao` são compartilhadas com o Histórico.
 */
import { useEffect, useRef } from 'react';
import { ErroDeConversa, postConversaNova, postConversaRetomar } from '@grupo_borges/cockpit-core/api';
import type { EtapaDoCheio } from './acao-de-conversa';
import { explicaRecusa, type Troca } from './acoes-de-conversa';
import { usaTrocaEmCurso } from '../../lib/usa-troca-em-curso';
import { comecarTroca, dispensaTroca, leTroca, postMorreu, postRecusado, postRespondeu, trocaBloqueia } from '../../lib/troca-em-curso';

export type EstadoDaTrocaDireta = { fase: 'livre' } | { fase: 'enviando' } | { fase: 'ocupado' } | { fase: 'falhou'; texto: string };

export type PedidoDireto = {
  tipo: Troca['tipo'];
  /** Conversa do Retomar; `null` na Nova. */
  alvo: string | null;
  alvoTitulo?: string | null;
  /** O que a tela mostrou: o botão âmbar já disse que interrompe. */
  interrompe: boolean;
  desligado?: boolean;
  /** A API aceitou: a tela sai do caminho (a gaveta fecha). */
  aoAceitar?: () => void;
};

export function usaTrocaDireta(agentSlug: string, nome: string) {
  const troca = usaTrocaEmCurso(agentSlug);
  const local = troca?.tipo === 'nova' ? troca : null;
  const mostrada = useRef(local);
  mostrada.current = local;
  useEffect(() => () => {
    if (mostrada.current) dispensaTroca(agentSlug, mostrada.current.clienteId);
  }, [agentSlug]);
  const enviando = local?.post === 'pendente' && trocaBloqueia(local);
  const recusou = local?.fase === 'recusada' && local.recusa === 'ocupado' && !local.forcar;
  const estado: EstadoDaTrocaDireta = recusou ? { fase: 'ocupado' }
    : local?.fase === 'recusada' ? { fase: 'falhou', texto: explicaRecusa(local.recusa!, nome) }
    : local?.fase === 'falhou' ? { fase: 'falhou', texto: local.erro! }
    : enviando ? { fase: 'enviando' } : { fase: 'livre' };
  const etapa: EtapaDoCheio = local && (local.viuId || local.viuEtapa) ? local.etapa : 'pedindo';

  async function pede(p: PedidoDireto) {
    const corrente = leTroca(agentSlug);
    if (trocaBloqueia(corrente)) {
      if (corrente?.post !== 'pendente') p.aoAceitar?.();
      return;
    }
    const recusada = corrente?.tipo === p.tipo && corrente.alvo === p.alvo
      && corrente.fase === 'recusada' && corrente.recusa === 'ocupado' && !corrente.forcar;
    const forcar = !p.desligado && (p.interrompe || recusada);
    const id = comecarTroca(agentSlug, { tipo: p.tipo, alvo: p.alvo, alvoTitulo: p.alvoTitulo,
      forcar, desligado: p.desligado ?? false });
    let aceitou = true;
    try {
      const resposta = p.tipo === 'nova' ? await postConversaNova(agentSlug, forcar, id)
        : await postConversaRetomar(agentSlug, p.alvo ?? '', forcar, id);
      postRespondeu(agentSlug, id, resposta);
    } catch (erro) {
      if (erro instanceof ErroDeConversa && [400, 404, 409].includes(erro.status)) {
        postRecusado(agentSlug, id, erro.codigo);
        aceitou = erro.codigo === 'operacao_em_curso';
      } else postMorreu(agentSlug, id);
    }
    if (aceitou) p.aoAceitar?.();
  }
  return { estado, etapa, pede: (p: PedidoDireto) => void pede(p), recusou,
    /** Erro e recusa fecham; uma troca em andamento continua acompanhada. */
    larga: () => { if (local) dispensaTroca(agentSlug, local.clienteId); } };
}
