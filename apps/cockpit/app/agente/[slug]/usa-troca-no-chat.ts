'use client';

/**
 * A troca de conversa vista do chat (F13): o marco e a espera.
 *
 * - Marco: o `conversa-trocada` do stream, ou o guardado na aba quando a página
 *   recarregou — só enquanto o stream estiver na conversa dele.
 * - Espera: `troca-em-curso.ts` conduz; este hook entrega o evento e a sessão
 *   resolvida. O leitor do `/operacao` é único, mesmo com a gaveta aberta.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import { guardaMarco, marcoGuardado, marcoValeAqui, type ConversaTrocada } from '@/lib/conversa-trocada';
import { usaTrocaEmCurso } from '@/lib/usa-troca-em-curso';
import { assinaTrocaNoChat, conversaTrocada, confereTroca, leTrocaNoChat, sessaoDaTroca as sessao, type TrocaNoChat } from '@/lib/troca-em-curso';

export function usaTrocaNoChat(
  agentSlug: string,
  trocaDoStream: ConversaTrocada | null,
  mensagens: readonly MessagePayload[],
  sessaoResolvida: string | null,
): { emCurso: TrocaNoChat | null; marco: ConversaTrocada | null } {
  const acompanhamento = usaTrocaEmCurso(agentSlug);
  const assina = useMemo(() => (fn: () => void) => assinaTrocaNoChat(agentSlug, fn), [agentSlug]);
  const emCurso = useSyncExternalStore(assina, () => leTrocaNoChat(agentSlug), () => null);

  // O stream trouxe a conversa nova: a régua confere identidade antes de concluir.
  useEffect(() => {
    if (!trocaDoStream) return;
    conversaTrocada(agentSlug, trocaDoStream);
    guardaMarco(sessao(), agentSlug, trocaDoStream);
  }, [agentSlug, trocaDoStream]);
  useEffect(() => {
    confereTroca(agentSlug, { sessao: sessaoResolvida });
  }, [agentSlug, acompanhamento?.clienteId, acompanhamento?.fase, acompanhamento?.entrou, sessaoResolvida]);

  const [guardado] = useState(() => marcoGuardado(sessao(), agentSlug));
  // O guardado só vale com prova: sem mensagem ainda, a página pode estar
  // abrindo outra conversa, e o marco piscaria antes de sumir.
  const marco = trocaDoStream
    ? marcoValeAqui(trocaDoStream, mensagens) ? trocaDoStream : null
    : guardado && mensagens.length > 0 && marcoValeAqui(guardado, mensagens) ? guardado : null;

  // A NOVA não desenha marco (ordem do Rica, 02/10): aqui ele vira null para
  // não contar como conteúdo no decideVazio — o chat abre no vazio do produto.
  return { emCurso, marco: marco?.motivo === 'nova' ? null : marco };
}
