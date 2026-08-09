'use client';

// Montagem do feed sobre o stream real de um agente.
//
// O `Feed` puro não sabe de rede: recebe itens e desenha. Isto aqui é o único
// lugar que costura stream → classificador incremental → feed, e existe
// separado para o `Feed` continuar montável em teste.

import { useMemo, useRef } from 'react';

import { buildToolResultLookup } from '@grupo_borges/cockpit-core/render-items';
import { createIncrementalRenderItems } from '@/lib/spike/render-items-incremental';
import { useCanarioStream } from '@/lib/spike/use-canario-stream';

import { Feed } from './feed';

export type FeedAoVivoProps = {
  agentSlug: string;
  sessionId?: string | null;
  /** Teto de histórico. `recentes` faz o limite morder na CAUDA, não no começo. */
  limite?: number;
};

/** 100, não 1000 — mesma razão e mesma medição do `feed-da-conversa.tsx`: o
 *  histórico profundo mora no JSONL da sessão, não nesta tela, e as 900
 *  mensagens a mais custavam 77% do peso do replay. Teto cravado pelo Rica. */
const HISTORICO_PADRAO = 100;

export function FeedAoVivo({ agentSlug, sessionId, limite = HISTORICO_PADRAO }: FeedAoVivoProps) {
  const { messages } = useCanarioStream({
    slug: agentSlug,
    sessionId,
    limit: limite,
    recentes: true,
  });

  // Instância estável: recriar o classificador por render jogaria fora o estado
  // incremental e voltaria ao `buildRenderItems` full por flush — 3,14 ms contra
  // 0,06 ms medidos (48,4×). O que se preserva é a identidade dos ITENS; a cópia
  // rasa existe para o `useMemo` a jusante enxergar a mudança.
  const incrementalRef = useRef<ReturnType<typeof createIncrementalRenderItems> | null>(null);
  if (incrementalRef.current === null) incrementalRef.current = createIncrementalRenderItems();

  const itens = useMemo(() => [...incrementalRef.current!.update(messages)], [messages]);
  const lookup = useMemo(() => buildToolResultLookup(messages), [messages]);

  return <Feed itens={itens} lookup={lookup} agentSlug={agentSlug} />;
}
