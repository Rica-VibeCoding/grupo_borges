'use client';

/**
 * A troca de conversa vista do chat (F13): o marco e a espera.
 *
 * - Marco: o `conversa-trocada` do stream, ou o guardado na aba quando a página
 *   recarregou — só enquanto o stream estiver na conversa dele.
 * - Espera: quem conduz é o Histórico (`troca-em-curso.ts`). Com a gaveta
 *   fechada no meio, este hook assume a leitura do `/operacao` — a mesma que a
 *   API desenhou para a troca, e só enquanto há troca — para a linha
 *   "trocando" não ficar de pé para sempre.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { fetchConversaOperacao } from '@grupo_borges/cockpit-core/api';
import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { CONFERE_ERRO_MS, leOperacao, trocaGuardada } from '@/components/gaveta/acoes-de-conversa';
import { guardaMarco, marcoGuardado, marcoValeAqui, type ConversaTrocada } from '@/lib/conversa-trocada';
import {
  ESPERA_DO_STREAM_MS,
  assinaTrocaNoChat,
  concluiTroca,
  leTrocaNoChat,
  publicaTrocaNoChat,
  temDono,
  type TrocaNoChat,
} from '@/lib/troca-em-curso';

const LEITURA_MS = 2_000;

function sessao(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function usaTrocaNoChat(
  agentSlug: string,
  trocaDoStream: ConversaTrocada | null,
  mensagens: readonly MessagePayload[],
): { emCurso: TrocaNoChat | null; marco: ConversaTrocada | null } {
  const assina = useMemo(() => (fn: () => void) => assinaTrocaNoChat(agentSlug, fn), [agentSlug]);
  // O snapshot inclui o dono: soltar a gaveta precisa acordar o leitor daqui.
  const [versao, setVersao] = useState(0);
  useEffect(() => assina(() => setVersao((v) => v + 1)), [assina]);
  const emCurso = useSyncExternalStore(assina, () => leTrocaNoChat(agentSlug), () => null);

  // O stream trouxe a conversa nova: a espera acaba e o marco fica guardado.
  useEffect(() => {
    if (!trocaDoStream) return;
    concluiTroca(agentSlug);
    guardaMarco(sessao(), agentSlug, trocaDoStream);
  }, [agentSlug, trocaDoStream]);

  const [guardado] = useState(() => marcoGuardado(sessao(), agentSlug));
  // O guardado só vale com prova: sem mensagem ainda, a página pode estar
  // abrindo outra conversa, e o marco piscaria antes de sumir.
  const marco = trocaDoStream
    ? marcoValeAqui(trocaDoStream, mensagens) ? trocaDoStream : null
    : guardado && mensagens.length > 0 && marcoValeAqui(guardado, mensagens) ? guardado : null;

  // Página aberta no meio de uma troca: a aba sabe o que foi pedido.
  useEffect(() => {
    const troca = trocaGuardada(sessao(), agentSlug);
    if (!troca || leTrocaNoChat(agentSlug)) return;
    const controlador = new AbortController();
    fetchConversaOperacao(agentSlug, controlador.signal)
      .then((op) => {
        const leitura = leOperacao(op);
        if (leitura.tipo !== 'segue') return;
        publicaTrocaNoChat(agentSlug, {
          fase: 'trocando',
          tipo: troca.tipo,
          alvoTitulo: null,
          etapa: leitura.etapa,
          inicio: op.desde ?? Date.now(),
          desligado: troca.desligado,
          forcar: troca.forcar,
        });
      })
      .catch(() => {});
    return () => controlador.abort();
  }, [agentSlug]);

  // Pronta sem o aviso do stream: larga depois do prazo (o stream pode ter
  // trocado antes de o chat abrir, e aí não há aviso a esperar).
  useEffect(() => {
    if (emCurso?.fase !== 'pronta') return;
    const prazo = setTimeout(() => publicaTrocaNoChat(agentSlug, null), Math.max(0, emCurso.emMs + ESPERA_DO_STREAM_MS - Date.now()));
    return () => clearTimeout(prazo);
  }, [agentSlug, emCurso]);

  // Sem o Histórico montado, o chat lê o `/operacao` por conta própria.
  const semDono = emCurso?.fase === 'trocando' && !temDono(agentSlug);
  useEffect(() => {
    if (!semDono) return;
    let erroDesde: number | null = null;
    const leitor = setInterval(() => {
      fetchConversaOperacao(agentSlug)
        .then((op) => {
          const leitura = leOperacao(op);
          const atual = leTrocaNoChat(agentSlug);
          if (atual?.fase !== 'trocando') return;
          if (leitura.tipo === 'segue') {
            if (atual.etapa !== leitura.etapa) publicaTrocaNoChat(agentSlug, { ...atual, etapa: leitura.etapa });
          } else if (leitura.tipo === 'pronta') {
            publicaTrocaNoChat(agentSlug, { fase: 'pronta', emMs: Date.now() });
          } else if (leitura.tipo === 'sumiu') {
            publicaTrocaNoChat(agentSlug, null);
          } else {
            // A API às vezes erra com a troca feita (F11): o aviso do stream tem a palavra final.
            erroDesde ??= Date.now();
            if (Date.now() - erroDesde >= CONFERE_ERRO_MS) publicaTrocaNoChat(agentSlug, { fase: 'falhou', texto: leitura.texto });
          }
        })
        .catch(() => {});
    }, LEITURA_MS);
    return () => clearInterval(leitor);
  }, [agentSlug, semDono, versao]);

  // A NOVA não desenha marco (ordem do Rica, 02/10): aqui ele vira `null` para
  // não contar como conteúdo no `decideVazio` — o chat abre no vazio do produto.
  return { emCurso, marco: marco?.motivo === 'nova' ? null : marco };
}
