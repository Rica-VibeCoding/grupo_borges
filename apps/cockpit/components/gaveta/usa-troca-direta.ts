'use client';

/**
 * A troca de um toque, fora do Histórico (F16): a Nova conversa da gaveta e o
 * "Voltar pra anterior" do chat.
 *
 * Mesma régua do Continuar esta: parado, um toque troca; ocupado, o botão já
 * vem âmbar e o toque interrompe; a frota dizia parado e a API respondeu 409
 * `ocupado`, o botão vira âmbar e espera o segundo toque.
 *
 * Aceita a troca, quem acompanha é o chat (`usa-troca-no-chat.ts`): este hook
 * publica a "trocando" e larga. Sem o Histórico montado, o chat lê o
 * `/operacao` sozinho até o stream trazer a conversa nova.
 */
import { useEffect, useRef, useState } from 'react';

import { ErroDeConversa, postConversaNova, postConversaRetomar, type RespostaDaTroca } from '@grupo_borges/cockpit-core/api';

import { explicaRecusa, leOperacao, type Troca } from './acoes-de-conversa';
import { publicaTrocaNoChat } from '../../lib/troca-em-curso';

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
  const [estado, setEstado] = useState<EstadoDaTrocaDireta>({ fase: 'livre' });
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  function aceita(p: PedidoDireto, forcar: boolean, resposta: RespostaDaTroca | null) {
    publicaTrocaNoChat(agentSlug, {
      fase: 'trocando',
      tipo: p.tipo,
      alvoTitulo: p.alvoTitulo ?? null,
      etapa: p.desligado ? 'religando' : 'estacionando',
      inicio: Date.now(),
      desligado: p.desligado ?? false,
      forcar,
    });
    const leitura = resposta ? leOperacao(resposta) : null;
    if (leitura?.tipo === 'pronta') publicaTrocaNoChat(agentSlug, { fase: 'pronta', emMs: Date.now() });
    if (leitura?.tipo === 'erro') publicaTrocaNoChat(agentSlug, { fase: 'falhou', texto: leitura.texto });
    if (vivo.current) setEstado({ fase: 'livre' });
    p.aoAceitar?.();
  }

  async function pede(p: PedidoDireto) {
    if (estado.fase === 'enviando') return;
    const forcar = !p.desligado && (p.interrompe || estado.fase === 'ocupado');
    setEstado({ fase: 'enviando' });
    let resposta: RespostaDaTroca;
    try {
      resposta = p.tipo === 'nova' ? await postConversaNova(agentSlug, forcar) : await postConversaRetomar(agentSlug, p.alvo ?? '', forcar);
    } catch (erro) {
      // Rede caída ou troca já correndo: a troca pode seguir, e o chat decide pelo `/operacao`.
      if (!(erro instanceof ErroDeConversa) || erro.codigo === 'operacao_em_curso') return aceita(p, forcar, null);
      if (!vivo.current) return;
      if (erro.codigo === 'ocupado' && !forcar) return setEstado({ fase: 'ocupado' });
      return setEstado({ fase: 'falhou', texto: explicaRecusa(erro.codigo, nome) });
    }
    aceita(p, forcar, resposta);
  }

  return {
    estado,
    pede: (p: PedidoDireto) => void pede(p),
    /** O botão está âmbar porque a API recusou com 409? */
    recusou: estado.fase === 'ocupado',
    larga: () => setEstado((e) => (e.fase === 'enviando' ? e : { fase: 'livre' })),
  };
}
