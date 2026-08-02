'use client';

// Costura própria da rota real: mesma receita do `FeedAoVivo`
// (components/feed/feed-ao-vivo.tsx — stream → classificador incremental →
// Feed), mas com UMA diferença de propósito — aqui o chamador precisa do
// `status` pra decidir o que pintar antes da primeira mensagem chegar. Por
// isso não importa `FeedAoVivo` e reimplementa as ~15 linhas com as mesmas
// APIs públicas (`useCanarioStream`, `createIncrementalRenderItems`,
// `buildToolResultLookup`, `Feed`) em vez de abrir uma segunda conexão SSE
// só para ler o status de uma que já existe dentro do `FeedAoVivo`.
//
// `components/feed/**` é território do Hiro (cockpit-v2-ownership.md §2) —
// este arquivo só CONSOME o que já é público de lá, nunca edita.

import { useMemo, useRef } from 'react';

import { buildToolResultLookup } from '@grupo_borges/cockpit-core/render-items';
import { Feed } from '@/components/feed/feed';
import type { ItemDoFeed } from '@/components/feed/grupo-ferramentas.ts';
import { desdeDaLinhaViva, trabalhoEmVooNoFim } from '@/components/feed/linha-viva.ts';
import { createIncrementalRenderItems } from '@/lib/spike/render-items-incremental';
import { useCanarioStream } from '@/lib/spike/use-canario-stream';

const HISTORICO_PADRAO = 1000;

export function FeedDaConversa({ agentSlug }: { agentSlug: string }) {
  const { messages, isRunning, status } = useCanarioStream({
    slug: agentSlug,
    limit: HISTORICO_PADRAO,
    recentes: true,
  });

  // Instância estável — mesma razão do FeedAoVivo: recriar por render jogaria
  // fora o estado incremental do classificador.
  const incrementalRef = useRef<ReturnType<typeof createIncrementalRenderItems> | null>(null);
  if (incrementalRef.current === null) incrementalRef.current = createIncrementalRenderItems();

  const itensBase = useMemo(() => [...incrementalRef.current!.update(messages)], [messages]);
  const lookup = useMemo(() => buildToolResultLookup(messages), [messages]);

  // A LINHA VIVA. A corrida está de pé (`isRunning`) mas o fim do feed não
  // tem trabalho em voo — o buraco entre o Rica mandar e a primeira
  // ferramenta, que antes era tela muda. Ela entra como ÚLTIMO ITEM, na
  // mesma gramática cinza das linhas de ferramenta; quando o trabalho de
  // verdade chega, é substituída por ele — não some deixando buraco.
  const itens = useMemo<readonly ItemDoFeed[]>(() => {
    if (!isRunning || trabalhoEmVooNoFim(itensBase, lookup)) return itensBase;
    const desdeMs = desdeDaLinhaViva(messages);
    if (desdeMs === null) return itensBase;
    return [...itensBase, { kind: 'linha-viva', desdeMs }];
  }, [isRunning, itensBase, lookup, messages]);

  if (itensBase.length === 0) {
    // `connecting`/`replaying`: o histórico ainda não chegou — ficar em
    // branco é honesto. "Sem conversa ainda." aqui seria mentira pra
    // qualquer agente com histórico de verdade, só ainda não carregado.
    // Mesmo convite do resto do app (bloco-de-acoes.tsx): sem spinner, sem
    // esqueleto — só nada até o dado chegar.
    if (status !== 'live') return null;

    return (
      <p
        style={{
          fontSize: 'var(--ck-text-hero)',
          lineHeight: 'var(--ck-leading-hero)',
          letterSpacing: 'var(--ck-track-hero)',
          color: 'var(--ck-text-secondary)',
        }}
      >
        Sem conversa ainda.
      </p>
    );
  }

  return <Feed itens={itens} lookup={lookup} />;
}
