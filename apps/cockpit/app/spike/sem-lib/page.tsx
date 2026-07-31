'use client';

// BRAÇO DE CONTROLE do G1 — a mesma bancada do /spike SEM a assistant-ui.
//
// Pergunta do experimento (docs/cockpit-v2-gate.md, ressalva 3366d32): o joelho
// de p95 que o G1 mediu (10× histórico → 1,8× p95) é da biblioteca ou herança
// da nossa própria camada? O painel antigo declara O(N) em
// apps/web/lib/use-messages-stream.ts:317 — se o joelho persistir aqui, trocar
// de biblioteca não resolve e o trabalho vira "consertar a nossa camada".
//
// O QUE É IDÊNTICO ao /spike, e isso é o experimento inteiro:
//   SSE real (canário, ?historico=N + recentes) → coalescedor → classificador
//   incremental → MESMO virtualizador @tanstack/react-virtual (não é da
//   assistant-ui; tirá-lo mudaria duas variáveis ao mesmo tempo) → mesmos
//   seletores de probe, mesmo header, mesma janela.
//
// O QUE MUDA: só o runtime. Sem AssistantRuntimeProvider, sem
// useExternalStoreRuntime, sem toThreadMessages, sem MessagePrimitive/
// ThreadPrimitive. Cada linha renderiza o RenderItem DIRETO, com o mesmo DOM
// feio dos renderers de part do /spike, para o peso de layout ser comparável.
//
// Rota DESCARTÁVEL como a irmã: respondida a pergunta do gate, este arquivo
// morre inteiro e nada mais se mexe.
// ---------------------------------------------------------------------------

import { Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { RenderItem } from '@grupo_borges/cockpit-core/render-items';
import { buildToolResultLookup, type ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';
import type { ContentPart } from '@grupo_borges/cockpit-core/messages-types';
import { createIncrementalRenderItems } from '@/lib/spike/render-items-incremental';

import { useCanarioStream } from '@/lib/spike/use-canario-stream';

const SLUG_CANARIO = 'canario';
/** Distância do fim, em px, dentro da qual consideramos "colado no fundo". */
const COLADO_PX = 24;

/** Iguais ao /spike — a estimativa adaptativa é conserto de G3, não afinação. */
const ALTURA_SEMENTE = 40;
const ALTURA_QUANTUM = 4;

/* ========================================================================== */
/* Renderers de part — o MESMO DOM feio do /spike, agora sobre RenderItem     */
/* ========================================================================== */

function Texto({ text }: { text: string }) {
  return (
    <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--ck-text-primary)' }}>{text}</p>
  );
}

function Raciocinio({ text }: { text: string }) {
  return (
    <p
      style={{
        margin: 0,
        whiteSpace: 'pre-wrap',
        color: 'var(--ck-state-thinking)',
        fontSize: 'var(--ck-text-sm)',
      }}
    >
      {text}
    </p>
  );
}

/** Mesma linha única do /spike: nome + resultado truncado em 160 chars. */
function Ferramenta({
  toolName,
  result,
  isError,
}: {
  toolName: string;
  result?: unknown;
  isError?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--ck-space-2)',
        alignItems: 'baseline',
        fontFamily: 'var(--ck-font-mono, ui-monospace, monospace)',
        fontSize: 'var(--ck-text-sm)',
        color: isError ? 'var(--ck-state-fail)' : 'var(--ck-text-secondary)',
        borderLeft: '2px solid',
        borderLeftColor: isError ? 'var(--ck-state-fail)' : 'var(--ck-state-ok)',
        paddingLeft: 'var(--ck-space-2)',
      }}
    >
      <span style={{ color: 'var(--ck-text-primary)' }}>{toolName}</span>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
          flex: 1,
        }}
      >
        {typeof result === 'string' ? result.slice(0, 160) : result ? '(resultado)' : ''}
      </span>
    </div>
  );
}

/** Tudo que não é texto/raciocínio/ferramenta cai aqui, como no Fallback do /spike. */
function Dado({ name, data }: { name: string; data: unknown }) {
  return (
    <div
      style={{
        fontFamily: 'var(--ck-font-mono, ui-monospace, monospace)',
        fontSize: 'var(--ck-text-xs)',
        color: 'var(--ck-text-secondary)',
        borderLeft: '2px solid var(--ck-edge-hairline)',
        paddingLeft: 'var(--ck-space-2)',
      }}
    >
      <span style={{ color: 'var(--ck-text-tertiary)' }}>{name}</span>{' '}
      {JSON.stringify(data).slice(0, 200)}
    </div>
  );
}

function ParteDeAssistant({ part, lookup }: { part: ContentPart; lookup?: ToolResultLookup }) {
  switch (part.type) {
    case 'text':
      return <Texto text={part.text} />;
    case 'thinking':
      return <Raciocinio text={part.thinking} />;
    case 'tool_use': {
      const achado = lookup?.get(part.id);
      return <Ferramenta toolName={part.name} result={achado?.content} isError={achado?.isError} />;
    }
    case 'tool_result':
      // O classificador dobra tool_result no lookup; chegando aqui, vira dado
      // em vez de sumir — mesmo critério da ponte do /spike.
      return (
        <Dado
          name="tool-result"
          data={{ toolUseId: part.tool_use_id, content: part.content, isError: part.is_error === true }}
        />
      );
  }
}

/** Espelha `converte()` da ponte: um RenderItem vira as mesmas peças visuais,
 *  sem passar por ThreadMessageLike. */
function CorpoDoItem({ item, lookup }: { item: RenderItem; lookup?: ToolResultLookup }) {
  switch (item.kind) {
    case 'user':
      return <Texto text={item.text} />;
    case 'user-internal':
      return (
        <>
          <Texto text={item.text} />
          <Dado name="internal" data={{ userType: item.payload.user_type }} />
        </>
      );
    case 'assistant':
      return (
        <>
          {item.parts.map((part, indice) => (
            <ParteDeAssistant key={indice} part={part} lookup={lookup} />
          ))}
        </>
      );
    case 'chip': {
      if (item.classifierKind === 'tool') {
        const usos = (item.payload.message?.content ?? []) as ContentPart[];
        const uso = Array.isArray(usos)
          ? usos.find((p): p is Extract<ContentPart, { type: 'tool_use' }> => p.type === 'tool_use')
          : undefined;
        const achado = uso ? lookup?.get(uso.id) : undefined;
        return (
          <Ferramenta
            toolName={uso?.name ?? item.chip.label}
            result={achado ? achado.content : item.expandBody}
            isError={achado ? achado.isError : item.tone === 'error'}
          />
        );
      }
      return (
        <Dado
          name="chip"
          data={{
            classifierKind: item.classifierKind,
            chip: item.chip,
            expandBody: item.expandBody,
            tone: item.tone,
          }}
        />
      );
    }
    case 'synthetic':
      return <Dado name="synthetic" data={{ syntheticKind: item.syntheticKind, rawText: item.rawText }} />;
    case 'channel':
      return <Dado name="channel" data={{ raw: item.raw }} />;
    case 'meta-decision':
      return <Dado name="meta" data={{ text: item.text }} />;
    case 'sidechain-group':
      return (
        <Dado
          name="sidechain"
          data={{ forma: 'group', rootUuid: item.rootUuid, count: item.count, durMs: item.durMs }}
        />
      );
    case 'sidechain-cluster':
      return (
        <Dado
          name="sidechain"
          data={{ forma: 'cluster', subagentCount: item.subagentCount, totalDurMs: item.totalDurMs }}
        />
      );
    case 'ask-user':
      return <Dado name="ask-user" data={{ entry: item.entry }} />;
    case 'tool-group':
      return (
        <Dado
          name="tool-group"
          data={{ count: item.count, toolNames: item.items.map((chip) => chip.chip.label) }}
        />
      );
  }
}

/** Identidade estável por item — a mesma régua do `refDe` da ponte
 *  (uuid || id), com os quatro kinds sem payload cobertos pelas chaves naturais. */
function chaveDe(item: RenderItem): string {
  switch (item.kind) {
    case 'sidechain-group':
      return `sg-${item.rootUuid}`;
    case 'sidechain-cluster':
      return `sc-${item.groups[0]?.rootUuid ?? 'sem-raiz'}`;
    case 'ask-user':
      return `ask-${item.entry.request_id}`;
    case 'tool-group':
      return `tg-${item.items[0]?.payload.uuid ?? 'sem-raiz'}`;
    default:
      return item.payload.uuid || String(item.payload.id);
  }
}

/* ========================================================================== */
/* Feed virtualizado — idêntico ao do /spike, menos os primitives da lib      */
/* ========================================================================== */

function Feed({ itens, lookup }: { itens: RenderItem[]; lookup?: ToolResultLookup }) {
  const chaves = useMemo(() => itens.map(chaveDe), [itens]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const coladoRef = useRef(true);
  const [temNovas, setTemNovas] = useState(false);

  const alturaRef = useRef(ALTURA_SEMENTE);
  const somaRef = useRef({ soma: 0, n: 0 });

  const virtualizer = useVirtualizer({
    count: itens.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => alturaRef.current,
    overscan: 6,
    getItemKey: (i) => chaves[i] ?? i,
  });

  const medir = useCallback(
    (node: HTMLElement | null) => {
      virtualizer.measureElement(node);
      if (!node) return;
      const h = node.offsetHeight;
      if (h <= 0) return;
      const acc = somaRef.current;
      acc.soma += h;
      acc.n += 1;
      const nova = Math.max(
        ALTURA_QUANTUM,
        Math.round(acc.soma / acc.n / ALTURA_QUANTUM) * ALTURA_QUANTUM,
      );
      if (nova !== alturaRef.current) alturaRef.current = nova;
    },
    [virtualizer],
  );

  const aoRolar = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    coladoRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= COLADO_PX;
    if (coladoRef.current) setTemNovas(false);
  }, []);

  useLayoutEffect(() => {
    if (!itens.length) return;
    if (coladoRef.current) virtualizer.scrollToIndex(itens.length - 1, { align: 'end' });
    else setTemNovas(true);
  }, [itens.length, virtualizer]);

  const virtuais = virtualizer.getVirtualItems();

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <div
        ref={scrollerRef}
        data-gate-messages=""
        onScroll={aoRolar}
        style={{
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '0 var(--ck-space-4)',
          overflowAnchor: 'none',
        }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtuais.map((v) => {
            const item = itens[v.index];
            return (
              <div
                key={v.key}
                data-gate-message=""
                data-index={v.index}
                ref={medir}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${v.start}px)`,
                }}
              >
                {/* Mesmo envelope da Bolha do /spike. */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--ck-space-1)',
                    padding: 'var(--ck-space-2) 0',
                  }}
                >
                  {item ? <CorpoDoItem item={item} lookup={lookup} /> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {temNovas ? (
        <button
          type="button"
          data-gate-new-messages=""
          onClick={() => {
            coladoRef.current = true;
            setTemNovas(false);
            virtualizer.scrollToIndex(itens.length - 1, { align: 'end' });
          }}
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 'var(--ck-space-3)',
            transform: 'translateX(-50%)',
            minHeight: 'var(--ck-touch-min)',
            padding: '0 var(--ck-space-4)',
            borderRadius: 'var(--ck-radius-pill)',
            border: '1px solid var(--ck-edge-functional)',
            background: 'var(--ck-surface-raised)',
            color: 'var(--ck-text-primary)',
            fontSize: 'var(--ck-text-sm)',
          }}
        >
          mensagens novas ↓
        </button>
      ) : null}
    </div>
  );
}

/* ========================================================================== */
/* Composer — idêntico ao do /spike (bancada — não envia)                     */
/* ========================================================================== */

function Composer() {
  const [texto, setTexto] = useState('');
  return (
    <div style={{ padding: 'var(--ck-space-3) var(--ck-space-4)', flexShrink: 0 }}>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={2}
        placeholder="digitar (bancada — não envia)"
        style={{
          width: '100%',
          resize: 'none',
          background: 'var(--ck-surface-composer)',
          color: 'var(--ck-text-primary)',
          border: '1px solid var(--ck-edge-functional)',
          borderRadius: 'var(--ck-radius-frame)',
          padding: 'var(--ck-space-2)',
          fontSize: 'var(--ck-text-md)',
        }}
      />
    </div>
  );
}

/* ========================================================================== */
/* Página                                                                      */
/* ========================================================================== */

/** Teto de histórico quando a URL não pede outro — igual ao /spike. */
const HISTORICO_PADRAO = 1000;

function Bancada() {
  // `?historico=N` é a MESMA variável independente do /spike, e morde pelo mesmo
  // mecanismo (`recentes=1` no SSE). O portão prova antes de medir.
  const parametros = useSearchParams();
  const pedido = Number.parseInt(parametros.get('historico') ?? '', 10);
  const historico =
    Number.isSafeInteger(pedido) && pedido > 0 ? pedido : HISTORICO_PADRAO;

  const { messages, isRunning, isLoading, status, descartados } = useCanarioStream({
    slug: SLUG_CANARIO,
    limit: historico,
    recentes: true,
  });

  // Mesmo classificador incremental em ref, com a mesma cópia rasa: o que se
  // preserva é a identidade dos ITENS (chave estável no virtualizador), não a
  // do array. isRunning/isLoading seguem lidos para o header ficar idêntico.
  void isRunning;
  void isLoading;
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
        <strong style={{ color: 'var(--ck-text-primary)' }}>spike-sem-lib · {SLUG_CANARIO}</strong>
        <span>{status}</span>
        <span>{messages.length} msg</span>
        <span>{itens.length} itens</span>
        <span>teto {historico}</span>
        <span style={{ color: descartados ? 'var(--ck-state-attention)' : undefined }}>
          {descartados} descartados
        </span>
      </header>

      <Feed itens={itens} lookup={lookup} />
      <Composer />

      {/* Mesmo probe, mesmos seletores default, mesma partida manual. */}
      <script
        async
        src="/gate-probe.js?dur=60&ind=%5Bdata-gate-new-messages%5D"
      />
    </div>
  );
}

// Mesma fronteira de Suspense do /spike: `useSearchParams` derruba a árvore
// para render de cliente e o build de produção falha sem ela.
export default function SpikeSemLibPage() {
  return (
    <Suspense fallback={null}>
      <Bancada />
    </Suspense>
  );
}
