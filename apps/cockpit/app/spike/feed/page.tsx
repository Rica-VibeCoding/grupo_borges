'use client';

// TERCEIRO BRAÇO da bancada do G1 — o feed REAL, de produto.
//
//   /spike            → com assistant-ui, DOM feio      (referência de medição)
//   /spike/sem-lib    → sem a biblioteca, DOM feio      (braço de controle)
//   /spike/feed       → sem a biblioteca, RENDERERS DE VERDADE   ← aqui
//
// A pergunta desta rota é a única que o G1 ainda não respondeu: o feed real
// segura o p95 que o esqueleto segurava, agora carregando markdown, execução e
// raciocínio em vez de `<p>` e `<div>`? O DOM ficou mais caro de propósito —
// medir é a forma de saber quanto.
//
// Tudo o que não é o miolo é IDÊNTICO ao `/spike/sem-lib`: mesmo slug, mesmo
// `?historico=N`, mesmo header, mesmo probe, mesmos seletores. Mudar duas
// variáveis ao mesmo tempo é o que invalidou as duas primeiras rodadas.
//
// As três rotas ficam de pé até o Rica medir no iPhone.

import { Suspense, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

import { buildToolResultLookup } from '@grupo_borges/cockpit-core/render-items';
import { Feed } from '@/components/feed/feed';
import { createIncrementalRenderItems } from '@/lib/spike/render-items-incremental';
import { useCanarioStream } from '@/lib/spike/use-canario-stream';

const SLUG_CANARIO = 'canario';
const HISTORICO_PADRAO = 1000;

function Bancada() {
  const parametros = useSearchParams();
  const pedido = Number.parseInt(parametros.get('historico') ?? '', 10);
  const historico = Number.isSafeInteger(pedido) && pedido > 0 ? pedido : HISTORICO_PADRAO;

  const { messages, status, descartados } = useCanarioStream({
    slug: SLUG_CANARIO,
    limit: historico,
    recentes: true,
  });

  const incrementalRef = useRef<ReturnType<typeof createIncrementalRenderItems> | null>(null);
  if (incrementalRef.current === null) incrementalRef.current = createIncrementalRenderItems();

  const itens = useMemo(() => [...incrementalRef.current!.update(messages)], [messages]);
  const lookup = useMemo(() => buildToolResultLookup(messages), [messages]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        background: 'var(--ck-surface-canvas)',
        color: 'var(--ck-text-primary)',
        paddingTop: 'var(--ck-safe-top)',
        paddingBottom: 'var(--ck-safe-bottom)',
      }}
    >
      <header
        style={{
          display: 'flex',
          gap: 'var(--ck-space-3)',
          alignItems: 'baseline',
          flexShrink: 0,
          padding: 'var(--ck-space-2) var(--ck-space-4)',
          borderBottom: '1px solid var(--ck-edge-hairline)',
          background: 'var(--ck-surface-nav)',
          fontSize: 'var(--ck-text-sm)',
          color: 'var(--ck-text-secondary)',
        }}
      >
        <strong style={{ color: 'var(--ck-text-primary)' }}>spike-feed · {SLUG_CANARIO}</strong>
        <span>{status}</span>
        <span>{messages.length} msg</span>
        <span>{itens.length} itens</span>
        <span>teto {historico}</span>
        <span style={{ color: descartados ? 'var(--ck-state-attention)' : undefined }}>
          {descartados} descartados
        </span>
      </header>

      <Feed itens={itens} lookup={lookup} />

      <script async src="/gate-probe.js?dur=60&ind=%5Bdata-gate-new-messages%5D" />
    </div>
  );
}

export default function SpikeFeedPage() {
  return (
    <Suspense fallback={null}>
      <Bancada />
    </Suspense>
  );
}
