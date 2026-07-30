'use client';

// Bancada do spike do passo 5 — a fatia vertical que o gate mede.
// SSE real (canário) → coalescedor → buildRenderItems → toThreadMessages →
// useExternalStoreRuntime → thread virtualizada.
//
// Rota DESCARTÁVEL: não é linkada pelo shell e morre junto com o spike. Se o
// gate reprovar a biblioteca, este arquivo some inteiro e nada mais se mexe.
//
// NÃO é entrega visual. O gate estético é outro e vem depois; aqui é bancada de
// medição. Feio e correto passa.
//
// ---------------------------------------------------------------------------
// MITIGAÇÃO DA EMENDA (ownership §5.3): a biblioteca tem UM DIA e não está no
// meu treino, então cada API usada abaixo vem com arquivo:linha do PACOTE
// INSTALADO. Caminhos relativos a node_modules/@assistant-ui/core/dist/ salvo
// indicação. Nada aqui foi escrito de memória; o que não estava no .d.ts não
// entrou.
//
//   useExternalStoreRuntime      react/runtimes/useExternalStoreRuntime.d.ts:4
//                                <T>(store: ExternalStoreAdapter<T>) => AssistantRuntime
//   ExternalStoreAdapter         runtimes/external-store/external-store-adapter.d.ts:168
//     .messages                  :81   readonly T[]
//     .isRunning / .isLoading    :79 / :80
//     .convertMessage            :122  (obrigatório quando T ≠ ThreadMessage, pela
//                                       interseção da linha 168)
//     .onNew                     :108  OBRIGATÓRIO, não opcional
//   ExternalStoreMessageConverter runtimes/external-store/external-store-adapter.d.ts:43
//                                (message: T, idx: number) => ThreadMessageLike
//   AssistantRuntimeProvider     react/AssistantRuntimeProvider.d.ts:27  ({runtime, aui?, children})
//   unstable_useThreadMessageIds react/primitive-hooks/useThreadMessageIds.d.ts:12
//                                () => readonly string[]; o próprio doc (linha 7)
//                                manda parear com Unstable_MessageById para lista
//                                virtualizada — é exatamente este caso
//   ThreadPrimitive.Unstable_MessageById
//                                react/primitives/thread/ThreadMessages.d.ts:63-71
//                                Props = { messageId: string; components: MessagesComponentConfig }
//   MessagesComponentConfig      react/primitives/thread/ThreadMessages.d.ts:5-39
//   MessagePrimitive.Parts       react/primitives/message/MessageParts.d.ts:32-…
//     .components.Text           :43   TextMessagePartComponent
//     .components.Reasoning      :91   ReasoningMessagePartComponent
//     .components.tools.Fallback :78   ComponentType<ToolCallMessagePartProps>
//     .components.data.by_name   :35   Record<string, DataMessagePartComponent>
//     .components.data.Fallback  :37
//   TextMessagePartProps         react/types/MessagePartComponentTypes.d.ts:12
//   ReasoningMessagePartProps    react/types/MessagePartComponentTypes.d.ts:14
//   DataMessagePartProps         react/types/MessagePartComponentTypes.d.ts:29  (state & {type:'data',name,data})
//   ToolCallMessagePartProps     react/types/MessagePartComponentTypes.d.ts:31
//
// ⚠️ A chave de `data.by_name` é o nome SEM o prefixo `data-`. Não é suposição:
// `convertDataPrefixedPart` em runtime/utils/thread-message-like.js:4-11 faz
// `type.substring(5)`, então o part `data-chip` que a minha ponte emite chega
// aqui como `{ type:'data', name:'chip' }`. O mesmo arquivo, linha 77, confirma
// que part `data-*` é aceito em mensagem de assistant (e a 107, em user).
//
// NÃO foi usado `client/ExternalThread`: é um `Resource` do @assistant-ui/tap,
// não componente React, e puxaria dois pacotes internos sem documentação para
// dentro de um spike cujo objetivo é medir frame (docs/cockpit-v2-stack.md §8).
//
// @tanstack/react-virtual 3.14.9 (virtual-core 3.17.7):
//   useVirtualizer               react-virtual/dist/esm/index.d.ts:48
//   opções count/getScrollElement/estimateSize/measureElement/overscan/getItemKey
//                                virtual-core/dist/esm/index.d.ts:53,54,55,65,66,73
//   getVirtualItems/getTotalSize/scrollToIndex   :161, :176, :173
//   VirtualItem { key,index,start,end,size }     :23-30
// ---------------------------------------------------------------------------

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  unstable_useThreadMessageIds,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import type {
  AppendMessage,
  DataMessagePartProps,
  ReasoningMessagePartProps,
  TextMessagePartProps,
  ToolCallMessagePartProps,
} from '@assistant-ui/react';

import type { RenderItem } from '@grupo_borges/cockpit-core/render-items';
import { buildToolResultLookup } from '@grupo_borges/cockpit-core/render-items';
import { createIncrementalRenderItems } from '@/lib/spike/render-items-incremental';

import { useCanarioStream } from '@/lib/spike/use-canario-stream';
import { toThreadMessages } from '@/lib/spike/to-thread-messages';

const SLUG_CANARIO = 'canario';
/** Distância do fim, em px, dentro da qual consideramos "colado no fundo". */
const COLADO_PX = 24;

/**
 * SEMENTE do estimateSize, não verdade sobre o conteúdo: vale só até as
 * primeiras linhas serem medidas de verdade, e a partir daí a média corrente
 * manda. Ver `ALTURA_QUANTUM` e o comentário do `medir`.
 */
const ALTURA_SEMENTE = 40;

/**
 * A estimativa só muda em degraus de 4px. Reagir a cada nó medido faria a
 * estimativa oscilar, e cada oscilação vira correção de scroll em item ainda
 * não medido — trocaria um erro grande por um tremor permanente.
 */
const ALTURA_QUANTUM = 4;

/* ========================================================================== */
/* Renderers de part — feios de propósito, densos por contrato (§7 da estética) */
/* ========================================================================== */

function Texto({ text }: TextMessagePartProps) {
  return (
    <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--ck-text-primary)' }}>{text}</p>
  );
}

function Raciocinio({ text }: ReasoningMessagePartProps) {
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

/** Ferramenta colapsada = UMA linha. Densidade é o que faz parecer profissional. */
function Ferramenta({ toolName, result, isError }: ToolCallMessagePartProps) {
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

/** Tudo que a lib não modela chega aqui como `{type:'data', name, data}`. */
function Dado({ name, data }: DataMessagePartProps) {
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

const COMPONENTES_DE_PART = {
  Text: Texto,
  Reasoning: Raciocinio,
  tools: { Fallback: Ferramenta },
  // by_name fica vazio de propósito: o Fallback já cobre as oito famílias
  // data-* que a ponte emite, e nomear cada uma é trabalho da fase de
  // renderers, não da bancada.
  data: { Fallback: Dado },
} as const;

function Bolha() {
  return (
    <MessagePrimitive.Root
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--ck-space-1)',
        padding: 'var(--ck-space-2) 0',
      }}
    >
      <MessagePrimitive.Parts components={COMPONENTES_DE_PART} />
    </MessagePrimitive.Root>
  );
}

const COMPONENTES_DE_MENSAGEM = { Message: Bolha };

/* ========================================================================== */
/* Feed virtualizado                                                          */
/* ========================================================================== */

function Feed() {
  const ids = unstable_useThreadMessageIds();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const coladoRef = useRef(true);
  const [temNovas, setTemNovas] = useState(false);

  // Estimativa ADAPTATIVA, e isso é conserto de G3, não afinação de desempenho.
  // Medido em 30/07: altura real mediana de 36px contra estimativa fixa de 72.
  // Cada PRIMEIRA medição gerava delta de −36px, e o virtual-core corrige o
  // scroll por esse delta (virtual-core index.js:855-859) — subir por ~600 itens
  // nunca medidos acumulava ~20k px de correção, que foi exatamente o que o G3
  // mediu no iPhone. Em ref, não em estado: `estimateSize` não entra em
  // `getMeasurementOptions` (index.js:571), então mudar o valor NÃO invalida
  // medição já feita e não força re-layout — só vale para item ainda não medido.
  const alturaRef = useRef(ALTURA_SEMENTE);
  const somaRef = useRef({ soma: 0, n: 0 });

  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => alturaRef.current,
    overscan: 6,
    // Chave estável por id: sem isto o virtualizador remonta linha quando a
    // lista cresce, e remontagem é exatamente o que o G4 conta como repintura.
    getItemKey: (i) => ids[i] ?? i,
  });

  /**
   * Envelope do `measureElement` da lib: mede primeiro (semântica dela intacta),
   * depois alimenta a média corrente. Identidade estável — `virtualizer` é a
   * mesma instância entre renders, e ref que troca de identidade faz o React
   * desanexar e reanexar, o que geraria medição a mais em vez de a menos.
   */
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

  // Cola no fim SÓ se já estava colado. É a regra que o G3 mede: com o usuário
  // rolado para cima, a viewport não pode se mexer sozinha — nem um pixel.
  useLayoutEffect(() => {
    if (!ids.length) return;
    if (coladoRef.current) virtualizer.scrollToIndex(ids.length - 1, { align: 'end' });
    else setTemNovas(true);
  }, [ids.length, virtualizer]);

  const itens = virtualizer.getVirtualItems();

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      {/* O scroller carrega data-gate-messages: foi o meu pedido e é o que
          torna a atribuição do G4 exata em vez de heurística. */}
      <div
        ref={scrollerRef}
        data-gate-messages=""
        onScroll={aoRolar}
        style={{
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '0 var(--ck-space-4)',
          // Sem isto o Safari mantém o offset ao inserir acima e o G3 pega
          // deslocamento de âncora que não é culpa do app.
          overflowAnchor: 'none',
        }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {itens.map((v) => (
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
              <ThreadPrimitive.Unstable_MessageById
                messageId={ids[v.index]}
                components={COMPONENTES_DE_MENSAGEM}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 2ª cláusula do corte do G3: "0 px E indicador de mensagem nova
          visível". O seletor é estável para o probe apontar com `ind=`. */}
      {temNovas ? (
        <button
          type="button"
          data-gate-new-messages=""
          onClick={() => {
            coladoRef.current = true;
            setTemNovas(false);
            virtualizer.scrollToIndex(ids.length - 1, { align: 'end' });
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
/* Composer                                                                   */
/* ========================================================================== */

/**
 * Isolado num componente próprio de propósito, e isso é medição, não estilo:
 * um textarea controlado no componente-pai re-renderizaria o feed a cada tecla,
 * e essas re-renderizações entrariam no G4 como repintura de mensagem selada —
 * artefato do instrumento, não do app. Aqui o estado morre nesta fronteira.
 *
 * O spike só observa; enviar texto está fora de escopo (o `sendText` do
 * contrato de dados não entra nesta rodada). O campo existe porque o G2 precisa
 * de onde digitar.
 */
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
          // 16px é piso, não estética: abaixo disso o Safari dá zoom ao focar.
          fontSize: 'var(--ck-text-md)',
        }}
      />
    </div>
  );
}

/* ========================================================================== */
/* Página                                                                     */
/* ========================================================================== */

export default function SpikePage() {
  const { messages, isRunning, isLoading, status, descartados } = useCanarioStream({
    slug: SLUG_CANARIO,
    limit: 1000,
  });

  // O classificador é o ativo que sobrevive aos dois caminhos do gate; a
  // biblioteca entra depois dele, nunca antes. O que muda aqui é só QUANTO dele
  // roda por flush: `buildRenderItems` reclassificava a lista inteira a cada
  // evento (O(N) por flush, a causa do G1 reprovar com p95 de 361ms), e a versão
  // incremental da Tara só reprocessa a cauda.
  //
  // Instância em ref, criada uma vez: ela É o estado (guarda a lista anterior e
  // as entradas já classificadas). Recriar por render zeraria esse estado e
  // devolveria o O(N) sem aparecer em lugar nenhum.
  const incrementalRef = useRef<ReturnType<typeof createIncrementalRenderItems> | null>(null);
  if (incrementalRef.current === null) incrementalRef.current = createIncrementalRenderItems();

  // ⚠️ A cópia rasa NÃO é decoração. `update()` devolve sempre o MESMO array,
  // mutado no lugar — e external-store-thread-runtime-core.js:122 curto-circuita
  // quando `oldStore.messages === store.messages`, devolvendo antes de
  // reconstruir. Sem o array novo, mensagem nova simplesmente não aparecia.
  // Copiar N ponteiros é trivial perto de reclassificar N mensagens, e o que
  // importa preservar é a identidade dos ITENS, não a do array: com ela estável,
  // o WeakMap de thread-message-converter.js:5 finalmente acerta no prefixo e só
  // a cauda é reconvertida.
  const itens = useMemo(() => [...incrementalRef.current!.update(messages)], [messages]);
  const lookup = useMemo(() => buildToolResultLookup(messages), [messages]);

  // convertMessage é por item (assinatura :43); a minha ponte é por lista, daí
  // a lista de um. Memoizado porque identidade instável aqui recria o adapter
  // a cada render.
  const convertMessage = useCallback(
    (item: RenderItem) => toThreadMessages([item], lookup)[0],
    [lookup],
  );

  const onNew = useCallback(async (_message: AppendMessage) => {
    // Obrigatório pelo tipo (:108). O painel observa sessões do Claude Code; o
    // envio de volta é `sendText` do contrato de dados e não entra no spike.
  }, []);

  const runtime = useExternalStoreRuntime<RenderItem>({
    messages: itens,
    isRunning,
    isLoading,
    convertMessage,
    onNew,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {/* UMA SUPERFÍCIE POR VEZ: coluna única, sem tropa e sem gaveta. O gate
          mede no iPhone com o teclado abrindo — 100dvh, não 100vh, senão a
          barra do Safari faz a altura mentir e o composer sai da tela. */}
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
          <strong style={{ color: 'var(--ck-text-primary)' }}>spike · {SLUG_CANARIO}</strong>
          <span>{status}</span>
          <span>{messages.length} msg</span>
          <span>{itens.length} itens</span>
          {/* Descarte por id não-crescente é contável de propósito: em teste de
              paridade, diferente de zero é sinal, não ruído. */}
          <span style={{ color: descartados ? 'var(--ck-state-attention)' : undefined }}>
            {descartados} descartados
          </span>
        </header>

        <Feed />
        <Composer />
      </div>

      {/* O probe é servido de public/ e se auto-instala, mas nada o carregava —
          a bancada subiu sem instrumento e isso só apareceu com o Rica de celular
          na mão. Sem parâmetro de seletor de propósito: os defaults do probe
          ([data-gate-messages] / [data-gate-message]) já são os atributos desta
          página. `ind` fecha a segunda cláusula do G3 (indicador de mensagem
          nova), que era o achado M2 da auditoria. Sem `auto`: quem dá a partida
          sou eu, sincronizado com a carga. */}
      <script
        async
        src="/gate-probe.js?dur=60&ind=%5Bdata-gate-new-messages%5D"
      />
    </AssistantRuntimeProvider>
  );
}
