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
import type { AgentStatus } from '@grupo_borges/cockpit-core/cockpit-types';
import { buildToolResultLookup } from '@grupo_borges/cockpit-core/render-items';
import { usaDelegacoes } from '@/components/feed/delegacoes.tsx';
import { Feed } from '@/components/feed/feed';
import type { ItemDoFeed } from '@/components/feed/grupo-ferramentas.ts';
import { desdeDaLinhaViva, trabalhoEmVooNoFim } from '@/components/feed/linha-viva.ts';
import { usaLinhaVivaVencida } from '@/components/feed/linha-viva.tsx';
import { usaConversaCodex } from '@/lib/codex/usa-conversa-codex.ts';
import { usaCompact } from '@/lib/compact';
import { createIncrementalRenderItems } from '@/lib/spike/render-items-incremental';
import { useCanarioStream } from '@/lib/spike/use-canario-stream';
import { usaFrota } from '@/components/shell/frota-provider';
import { ancoraDaLinhaViva } from '@/components/shell/linha-viva-da-conversa';

/** Era 1000 até 09/08, quando o Rica cravou 100 — *"as mensagens ficam nas
 *  sessões do CC (…) pode mandar 100 mensagens, no máximo"*. Em 10/08 ele
 *  subiu para 300: rolando o chat do Pavan para trás a conversa acabava antes
 *  do começo da própria sessão, e 100 mensagens não cobriam nem uma tarde.
 *
 *  Medido em 10/08 no replay de uma sessão longa do `pavan`: 100 mensagens
 *  custam 220 KB e 300 custam 723 KB (~2,5 KB por mensagem a mais). Longe das
 *  2,82 MB que o teto de 1000 custava, que foi o que motivou o corte.
 *
 *  Isto NÃO alcança o que veio antes de um `/clear`: o replay é filtrado pela
 *  sessão atual, então o arquivo morto continua sendo o JSONL da sessão. */
const HISTORICO_PADRAO = 300;

/** O SELETOR. Executor decide a FONTE, nunca o desenho: os dois ramos terminam
 *  no mesmo `<Feed>`, com os mesmos itens e a mesma gramática. É a ordem do
 *  Rica em 09/08, olhando o chat vazio da Tara — *"tem que seguir a mesma UI
 *  que temos no CC"*.
 *
 *  Dois componentes irmãos em vez de um com `if`: o ramo do CC abre SSE e o da
 *  Tara abre um `setInterval`, e nenhum dos dois pode nascer pendurado num hook
 *  que às vezes roda. Montando um OU outro, cada um chama os seus hooks
 *  incondicionalmente e o que não está na tela não tem conexão aberta. */
export function FeedDaConversa({ agentSlug }: { agentSlug: string }) {
  const { agents } = usaFrota();
  const agente = agents.find((a) => a.slug === agentSlug);
  const ehCodex = agente?.executor_kind === 'codex' || agente?.cli_default === 'codex';

  return ehCodex ? (
    <FeedCodex agentSlug={agentSlug} />
  ) : (
    <FeedClaudeCode agentSlug={agentSlug} statusDaFrota={agente?.status ?? null} />
  );
}

function FeedClaudeCode({
  agentSlug,
  statusDaFrota,
}: {
  agentSlug: string;
  /** O que a frota VIVA diz deste agente. Entra aqui só para desligar o
   *  "Pensando" quando ele sai do ar — ver `linha-viva-da-conversa.ts`. */
  statusDaFrota: AgentStatus | null;
}) {
  // `geracao`: o backend emite `session-reset` quando um Restart sem contexto
  // zera o histórico — o hook a incrementa e nasce com `messages` vazias.
  // Ela vira `key` lá embaixo (padrão react.dev de reset): Feed, virtualizador
  // e classificador incremental remontam no MESMO commit em que a lista zera —
  // sem frame com conteúdo velho, sem frame vazio no meio.
  const { messages, isRunning, status, geracao } = useCanarioStream({
    slug: agentSlug,
    limit: HISTORICO_PADRAO,
    recentes: true,
  });

  // O FIM do `/compact` é daqui: o composer sabe quando o compact sai, mas só
  // o stream sabe quando o resumo CHEGA. A mensagem-resumo com timestamp
  // posterior ao início conclui a espera — e o `concluir` da máquina mede a
  // duração pelo timestamp DELA, não pelo instante da detecção (a aba podia
  // estar em segundo plano).
  const {
    estado: estadoCompact,
    concluir: concluirCompact,
    registrarRelogioDoServidor,
  } = usaCompact(agentSlug);
  const faseCompact = estadoCompact.fase;
  const marcoCompactMs = estadoCompact.marcoServidorMs;

  // A HORA DO SERVIDOR, entregue por quem a tem. É a única peça da tela que vê
  // `timestamp` de mensagem, e é dela que sai a linha de base do compact.
  useEffect(() => {
    for (const m of messages) {
      if (typeof m.timestamp !== 'string') continue;
      registrarRelogioDoServidor(Date.parse(m.timestamp));
    }
  }, [messages, registrarRelogioDoServidor]);

  useEffect(() => {
    if (faseCompact !== 'compactando' && faseCompact !== 'sem-retorno') return;
    for (const m of messages) {
      if (!ehMensagemResumoCompact(m)) continue;
      const tsMs = typeof m.timestamp === 'string' ? Date.parse(m.timestamp) : Number.NaN;
      if (!Number.isFinite(tsMs)) continue;
      // Servidor contra SERVIDOR. Antes esta guarda comparava o timestamp do
      // resumo com o relógio do browser: com o iPhone adiantado mais do que a
      // duração do compact ela ficava falsa para sempre, `concluir` nunca
      // disparava e o composer ficava travado até o escape de 6 min — a cada
      // refresh de novo. `marcoCompactMs` nulo significa feed sem mensagem
      // nenhuma na largada, e aí qualquer resumo é posterior por definição.
      if (marcoCompactMs === null || tsMs > marcoCompactMs) {
        concluirCompact(m.uuid, tsMs);
        return;
      }
    }
  }, [messages, faseCompact, marcoCompactMs, concluirCompact]);

  // Instância estável POR GERAÇÃO — mesma razão do FeedAoVivo: recriar por
  // render jogaria fora o estado incremental do classificador. Na troca de
  // geração (session-reset), recriar é exatamente o pedido: o classificador
  // não pode herdar nada da conversa que foi apagada.
  const incrementalRef = useRef<{
    geracao: number;
    instance: ReturnType<typeof createIncrementalRenderItems>;
  } | null>(null);
  if (incrementalRef.current === null || incrementalRef.current.geracao !== geracao) {
    incrementalRef.current = { geracao, instance: createIncrementalRenderItems() };
  }

  const itensBase = useMemo(() => [...incrementalRef.current!.instance.update(messages)], [messages]);
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

  // O PRAZO DA LINHA VIVA. `isRunning` conta o que o log conta, e turno que
  // morre sem despedida (limite de uso, agente desligado, sessão derrubada)
  // não escreve nada — o "Pensando" ficava de pé sozinho. Ver o porquê medido
  // em `linha-viva.ts`. Quem NÃO precisa esperar os cinco minutos é o
  // desligamento: a frota viva conta isso em segundos, e a régua que cruza as
  // duas fontes mora em `linha-viva-da-conversa.ts`.
  const desdeMs = useMemo(() => desdeDaLinhaViva(messages), [messages]);
  const vencida = usaLinhaVivaVencida(desdeMs);

  const itens = useMemo<readonly ItemDoFeed[]>(() => {
    let lista = itensBase as ItemDoFeed[];
    const desdeLinhaViva = ancoraDaLinhaViva({
      correndo: isRunning,
      vencida,
      trabalhoEmVooNoFim: trabalhoEmVooNoFim(itensBase, lookup),
      desdeMs,
      statusDaFrota,
    });
    if (desdeLinhaViva !== null) {
      lista = [...lista, { kind: 'linha-viva', desdeMs: desdeLinhaViva }];
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
  }, [isRunning, vencida, desdeMs, statusDaFrota, itensBase, lookup, delegacoes]);

  if (itensBase.length === 0) {
    // `connecting`/`replaying`: o histórico ainda não chegou — ficar em
    // branco é honesto. "Sem conversa ainda." aqui seria mentira pra
    // qualquer agente com histórico de verdade, só ainda não carregado.
    // Mesmo convite do resto do app (bloco-de-acoes.tsx): sem spinner, sem
    // esqueleto — só nada até o dado chegar.
    if (status !== 'live') return null;

    return <SemConversa geracao={geracao} />;
  }

  // O wrapper existe pra `key` + fade da troca de geração sem tocar em
  // `components/feed/**` (território do Hiro): `flex column` + `min-h-0`
  // repassam ao Feed exatamente o espaço que ele tinha antes.
  return (
    <div
      key={geracao}
      className="ck-feed-enter flex min-h-0 flex-1 flex-col"
    >
      <Feed itens={itens} lookup={lookup} agentSlug={agentSlug} />
    </div>
  );
}

/** A coluna de leitura não vem mais de um wrapper na página (ela desceu pra
 *  dentro do Feed, pra barra de rolagem encostar na borda da tela) — o estado
 *  vazio se centra sozinho na mesma medida. `key={geracao}` + `ck-feed-enter`:
 *  após um Restart, o "Sem conversa ainda." nasce com fade em vez de piscada
 *  dura. Virou peça própria quando a Tara ganhou o segundo ramo: os dois
 *  precisam do MESMO vazio, e vazio duplicado é vazio que diverge. */
function SemConversa({ geracao }: { geracao: number }) {
  return (
    <div
      key={geracao}
      className="ck-feed-enter mx-auto w-full"
      style={{ maxWidth: 'var(--ck-read-wide)', padding: '0 var(--ck-space-4)' }}
    >
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
    </div>
  );
}

/** A TARA. Mesmo pipeline, outra fonte: `/codex/messages` por polling, traduzido
 *  pra `MessagePayload` antes de entrar (`lib/codex/adapta-mensagens.ts`). Daqui
 *  pra baixo nenhuma peça sabe que existe Codex.
 *
 *  O QUE ESTE RAMO NÃO TEM, e por quê:
 *  - `usaCompact` — `/compact` é comando de sessão Claude Code; o turno do Codex
 *    não tem esse ciclo.
 *  - `usaDelegacoes` — a Tara é o ALVO de delegação, não delegadora. A pílula
 *    "Tara trabalhando" pertence ao feed de quem a chamou.
 *  - linha viva — depende do `isRunning` do stream, que aqui não existe. O sinal
 *    equivalente é o `status_line` da frota; fica pra quando o Rica olhar a tela
 *    cheia e disser se sente falta. */
function FeedCodex({ agentSlug }: { agentSlug: string }) {
  const { mensagens, carregou } = usaConversaCodex(agentSlug, true);

  const incrementalRef = useRef<ReturnType<typeof createIncrementalRenderItems> | null>(null);
  incrementalRef.current ??= createIncrementalRenderItems();

  const itens = useMemo<readonly ItemDoFeed[]>(
    () => [...incrementalRef.current!.update(mensagens)],
    [mensagens],
  );
  const lookup = useMemo(() => buildToolResultLookup(mensagens), [mensagens]);

  // Mesma honestidade do ramo do CC: em branco enquanto não perguntei. Dizer
  // "Sem conversa ainda." antes da primeira resposta é a mentira que esta tela
  // veio consertar.
  if (itens.length === 0) return carregou ? <SemConversa geracao={0} /> : null;

  return (
    <div className="ck-feed-enter flex min-h-0 flex-1 flex-col">
      <Feed itens={itens} lookup={lookup} agentSlug={agentSlug} />
    </div>
  );
}
