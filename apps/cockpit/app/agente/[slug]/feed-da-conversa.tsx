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

import { useEffect, useMemo, useRef } from 'react';

import { ehMensagemResumoCompact } from '@grupo_borges/cockpit-core/chat-payload-classifier';
import { buildToolResultLookup } from '@grupo_borges/cockpit-core/render-items';
import { usaDelegacoes } from '@/components/feed/delegacoes.tsx';
import { Feed } from '@/components/feed/feed';
import type { ItemDoFeed } from '@/components/feed/grupo-ferramentas.ts';
import { desdeDaLinhaViva, trabalhoEmVooNoFim } from '@/components/feed/linha-viva.ts';
import { usaCompact } from '@/lib/compact';
import { createIncrementalRenderItems } from '@/lib/spike/render-items-incremental';
import { useCanarioStream } from '@/lib/spike/use-canario-stream';

const HISTORICO_PADRAO = 1000;

export function FeedDaConversa({ agentSlug }: { agentSlug: string }) {
  const { messages, isRunning, status } = useCanarioStream({
    slug: agentSlug,
    limit: HISTORICO_PADRAO,
    recentes: true,
  });

  // O FIM do `/compact` é daqui: o composer sabe quando o compact sai, mas só
  // o stream sabe quando o resumo CHEGA. A mensagem-resumo com timestamp
  // posterior ao início conclui a espera — e o `concluir` da máquina mede a
  // duração pelo timestamp DELA, não pelo instante da detecção (a aba podia
  // estar em segundo plano).
  const { estado: estadoCompact, concluir: concluirCompact } = usaCompact(agentSlug);
  const faseCompact = estadoCompact.fase;
  const desdeCompactMs = estadoCompact.desdeMs;

  useEffect(() => {
    if (faseCompact !== 'compactando' && faseCompact !== 'sem-retorno') return;
    if (desdeCompactMs === null) return;
    for (const m of messages) {
      if (!ehMensagemResumoCompact(m)) continue;
      const tsMs = typeof m.timestamp === 'string' ? Date.parse(m.timestamp) : Number.NaN;
      if (Number.isFinite(tsMs) && tsMs > desdeCompactMs) {
        concluirCompact(m.uuid, tsMs);
        return;
      }
    }
  }, [messages, faseCompact, desdeCompactMs, concluirCompact]);

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
  //
  // AS DELEGAÇÕES entram DEPOIS dela, e as duas podem coexistir: a linha viva
  // é o agente pensando, a delegação é alguém trabalhando a pedido dele
  // ("Tara trabalhando · há 4 min"). O poll de 3 s mora no `usaDelegacoes` —
  // fonte única, a mesma que a pílula do topo vai beber quando existir.
  const delegacoes = usaDelegacoes(agentSlug);

  const itens = useMemo<readonly ItemDoFeed[]>(() => {
    let lista = itensBase as ItemDoFeed[];
    if (isRunning && !trabalhoEmVooNoFim(itensBase, lookup)) {
      const desdeMs = desdeDaLinhaViva(messages);
      if (desdeMs !== null) lista = [...lista, { kind: 'linha-viva', desdeMs }];
    }
    if (delegacoes.length > 0) {
      lista = [
        ...lista,
        ...delegacoes.map((d) => ({
          kind: 'delegacao' as const,
          quem: d.quem,
          alvo: d.alvo,
          desdeMs: d.inicio * 1000,
        })),
      ];
    }
    return lista;
  }, [isRunning, itensBase, lookup, messages, delegacoes]);

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

  return <Feed itens={itens} lookup={lookup} agentSlug={agentSlug} />;
}
