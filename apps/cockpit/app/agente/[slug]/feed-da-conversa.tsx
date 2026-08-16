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

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { ehMensagemResumoCompact } from '@grupo_borges/cockpit-core/chat-payload-classifier';
import type { AgentStatus } from '@grupo_borges/cockpit-core/cockpit-types';
import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import { buildToolResultLookup, textoEnfileirado } from '@grupo_borges/cockpit-core/render-items';
import { usaDelegacoes } from '@/components/feed/delegacoes.tsx';
import { Retrato } from '@/components/shell/retrato.tsx';
import { Feed } from '@/components/feed/feed';
import type { ItemDoFeed } from '@/components/feed/grupo-ferramentas.ts';
import { desdeDaLinhaViva, trabalhoEmVooNoFim } from '@/components/feed/linha-viva.ts';
import { usaLinhaVivaVencida } from '@/components/feed/linha-viva.tsx';
import { decideVazio } from '@/lib/decide-vazio.ts';
import { usaConversaCodex } from '@/lib/codex/usa-conversa-codex.ts';
import { usaCompact } from '@/lib/compact';
import {
  assinaPendentes,
  lePendentes,
  reconciliaPendentes,
  type EcoPendente,
} from '@/lib/codex/eco-pendente.ts';
import { publicaTurnoVivo } from '@/lib/turno-vivo.ts';
import { textosDoUsuario } from '@/lib/textos-do-usuario.ts';
import { HISTORICO_PADRAO } from '@/lib/preaquece-conversa.ts';
import { createIncrementalRenderItems } from '@/lib/spike/render-items-incremental';
import { useCanarioStream } from '@/lib/spike/use-canario-stream';
import { usaFrota } from '@/components/shell/frota-provider';
import { ancoraDaLinhaViva } from '@/components/shell/linha-viva-da-conversa';

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
  // O ECO OTIMISTA, agora TAMBÉM aqui. Este ramo passou meses sem ele apoiado
  // numa frase que estava escrita como fato em dois arquivos — *"no Claude Code
  // o eco volta pelo stream em milissegundos"*. Medi em 15/08 no `:3008`, com o
  // agente OCIOSO: o campo esvazia em 0,1 s e a bolha só aparece **18,9 s**
  // depois. São 18,8 segundos de tela muda entre o toque e qualquer sinal de
  // que a mensagem existe — o que o Rica descreve como *"o composer engole a
  // mensagem"*. A régua da NN/g põe o limite de atenção em 10 s
  // (nngroup.com/articles/response-times-3-important-limits): entregávamos
  // quase o dobro disso de nada.
  //
  // A pendência também segura o alarme de entrega, e isso é conserto, não
  // efeito colateral: `PRAZO_ECO_MS` são 12 s, calibrados em 30/07 sobre uma
  // amostra cujo pior caso era 1,434 s. Com o eco real em 18,9 s o prazo
  // estourava ANTES da confirmação chegar, e toda mensagem para agente ocioso
  // terminava em âmbar dizendo "não consegui confirmar se entrou — pode
  // duplicar". Falso, e é o que pausa a fila e pendura a mensagem seguinte
  // pedindo "enviar mesmo assim". Enquanto a pendência existe o prazo
  // reexamina (`usa-envio.ts:297`); quando ela reconcilia, a máquina recebe o
  // recibo por `assinaEntrega`. O teto de 3 min continua valendo para o caso
  // em que a mensagem realmente não entrou.
  const assina = useMemo(() => (fn: () => void) => assinaPendentes(agentSlug, fn), [agentSlug]);
  const le = useMemo(() => () => lePendentes(agentSlug), [agentSlug]);
  const pendentes = useSyncExternalStore(assina, le, () => SEM_PENDENCIA);
  useEffect(() => {
    reconciliaPendentes(agentSlug, textosDoUsuario(messages));
  }, [agentSlug, messages]);

  const comEco = useMemo(() => {
    if (pendentes.length === 0) return messages;
    const base = messages.length;
    return [...messages, ...pendentes.map((p, i) => criaBolhaOtimista(p, base + i))];
  }, [messages, pendentes]);

  const itensBase = useMemo(() => [...incrementalRef.current!.instance.update(comEco)], [comEco]);
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

  // O FREIO BEBE DA MESMA ÁGUA QUE O "PENSANDO", e a terceira rodada de 15/08
  // foi aprender que "mesma fonte" não bastava: eu publicava `isRunning` CRU,
  // enquanto a linha viva o consome com prazo e com corte por frota. Resultado
  // medido pelo Daniel no canarinho — `Pensando=False` e `■=True` na mesma tela,
  // com o agente `status=ocioso`. Duas afirmações contraditórias a três
  // centímetros uma da outra, que é exatamente o que este módulo veio consertar.
  //
  // `isRunning` conta o que o log conta, e turno que morre sem despedida não
  // escreve o fim: fica de pé para sempre. As mesmas duas guardas da linha viva
  // resolvem — o prazo (`vencida`) e o desligamento visto pela frota.
  //
  // O que NÃO entra aqui, e é a única diferença entre as duas réguas, é o
  // `trabalhoEmVooNoFim`: ele silencia a linha viva quando o último item do feed
  // já está no gerúndio, para não dizer "pensando" duas vezes. Ali é redundância
  // de texto; aqui seria apagar o freio no instante em que o agente mais está
  // trabalhando.
  useEffect(() => {
    publicaTurnoVivo(agentSlug, isRunning && !vencida && statusDaFrota !== 'offline');
    return () => publicaTurnoVivo(agentSlug, false);
  }, [agentSlug, isRunning, vencida, statusDaFrota]);

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

  // O vazio virou função pura testada (`lib/decide-vazio.ts`, 11/08 — task
  // 2dac8a8b). As duas intenções originais sobrevivem: branco enquanto o
  // histórico não chegou (mesmo com delegação batendo na porta — ela
  // entraria sozinha e o histórico a empurraria depois), e "Sem conversa
  // ainda." só no vazio de verdade. A novidade: delegação conta como
  // conteúdo — agente sem histórico que delegou mostra a linha de quem
  // trabalha por ele em vez de mentir que não há nada.
  const decisao = decideVazio({
    temHistorico: itensBase.length > 0,
    temDelegacao: delegacoes.length > 0,
    status,
  });
  if (decisao === 'nada') return null;
  if (decisao === 'sem-conversa') return <SemConversa geracao={geracao} agentSlug={agentSlug} />;

  // O wrapper existe pra `key` + fade da troca de geração sem tocar em
  // `components/feed/**` (território do Hiro): `flex column` + `min-h-0`
  // repassam ao Feed exatamente o espaço que ele tinha antes.
  return (
    <div
      key={geracao}
      className="ck-feed-enter flex min-h-0 flex-1 flex-col"
    >
      <Feed itens={itens} lookup={lookup} agentSlug={agentSlug} estaRodando={isRunning} />
    </div>
  );
}

const SEM_PENDENCIA: readonly EcoPendente[] = Object.freeze([]);

/** A bolha do Rica antes de o log saber que ela existe. Mesma forma que o
 *  stream produz — daqui pra baixo nenhuma peça do feed distingue as duas.
 *  Gêmea da `criaBolhaOtimista` de `lib/codex/usa-conversa-codex.ts`; as duas
 *  são pequenas e vivem em ramos que não se importam, e unificá-las custaria
 *  um módulo a mais para poupar dez linhas. */
function criaBolhaOtimista(pendente: EcoPendente, ordinal: number): MessagePayload {
  return {
    id: ordinal,
    kind: 'user',
    uuid: `cc-otimista-${pendente.id}`,
    parent_uuid: null,
    session_id: null,
    is_sidechain: false,
    user_type: 'external',
    timestamp: new Date(pendente.emMs).toISOString(),
    created_at: pendente.emMs,
    message: { role: 'user', content: pendente.texto },
  };
}

/** A coluna de leitura não vem mais de um wrapper na página (ela desceu pra
 *  dentro do Feed, pra barra de rolagem encostar na borda da tela) — o estado
 *  vazio se centra sozinho na mesma medida. `key={geracao}` + `ck-feed-enter`:
 *  após um Restart, a saudação nasce com fade em vez de piscada dura. Virou
 *  peça própria quando a Tara ganhou o segundo ramo: os dois precisam do MESMO
 *  vazio, e vazio duplicado é vazio que diverge.
 *
 *  16/08 — saudação estilo Claude (referência que o Rica mandou): o retrato do
 *  agente como marca + "Boa tarde, Rica" centralizados, no lugar do "Sem
 *  conversa ainda." no topo. A hora se resolve DEPOIS do mount (useEffect): o
 *  componente é pré-renderizado no servidor, e `getHours()` no corpo daria HTML
 *  do servidor ≠ do cliente — hydration mismatch. Primeiro paint é só o
 *  retrato; o texto entra no primeiro efeito. */
function SemConversa({ geracao, agentSlug }: { geracao: number; agentSlug: string }) {
  const [saudacao, setSaudacao] = useState<string | null>(null);
  useEffect(() => {
    const hora = new Date().getHours();
    setSaudacao(hora < 5 || hora >= 18 ? 'Boa noite, Rica' : hora < 12 ? 'Bom dia, Rica' : 'Boa tarde, Rica');
  }, []);

  return (
    <div
      key={geracao}
      className="ck-feed-enter flex min-h-0 flex-1 flex-col items-center justify-center"
      style={{ gap: 'var(--ck-space-5)', padding: '0 var(--ck-space-4)' }}
    >
      <Retrato slug={agentSlug} nome={agentSlug} tamanho={56} />
      <p
        style={{
          margin: 0,
          minHeight: 'calc(var(--ck-text-hero) * var(--ck-leading-hero))',
          fontSize: 'var(--ck-text-hero)',
          lineHeight: 'var(--ck-leading-hero)',
          letterSpacing: 'var(--ck-track-hero)',
          color: 'var(--ck-text-secondary)',
          textAlign: 'center',
        }}
      >
        {saudacao}
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

  const itensBase = useMemo<readonly ItemDoFeed[]>(
    () => [...incrementalRef.current!.update(mensagens)],
    [mensagens],
  );
  const lookup = useMemo(() => buildToolResultLookup(mensagens), [mensagens]);

  // A LINHA VIVA ("| Pensando"), como no CC. O ramo do CC a liga pelo
  // `isRunning` do stream; aqui não há stream, e a frota é o sinal
  // equivalente — o comentário deste ramo já apontava o status da frota como
  // substituto (10/08). Mesma régua de exibição (`ancoraDaLinhaViva`), mesma
  // fonte de tempo (última mensagem). A diferença é que a frota LIGA e
  // DESLIGA em vez de só desligar: sem `isRunning` não existe outra fonte de
  // "trabalhando" — é o buraco que a borda azul tapava, agora na gramática do
  // CC.
  const { agents } = usaFrota();
  const statusDaFrota = agents.find((a) => a.slug === agentSlug)?.status ?? null;
  const desdeMs = useMemo(() => desdeDaLinhaViva(mensagens), [mensagens]);
  const vencida = usaLinhaVivaVencida(desdeMs);

  const itens = useMemo<readonly ItemDoFeed[]>(() => {
    let lista = itensBase as ItemDoFeed[];
    const desdeLinhaViva = ancoraDaLinhaViva({
      correndo: statusDaFrota === 'trabalhando',
      vencida,
      trabalhoEmVooNoFim: trabalhoEmVooNoFim(itensBase, lookup),
      desdeMs,
      statusDaFrota,
    });
    if (desdeLinhaViva !== null) {
      lista = [...lista, { kind: 'linha-viva', desdeMs: desdeLinhaViva }];
    }
    return lista;
  }, [statusDaFrota, vencida, desdeMs, itensBase, lookup]);

  // Mesma honestidade do ramo do CC: em branco enquanto não perguntei. Dizer
  // "Sem conversa ainda." antes da primeira resposta é a mentira que esta tela
  // veio consertar.
  if (itens.length === 0) return carregou ? <SemConversa geracao={0} agentSlug={agentSlug} /> : null;

  // O cursor no fim da última fala é o que faz o chat da Tara parecer o mesmo
  // app que o do CC — ordem do Rica, 15/08: "todos tem que ficar com a UI igual
  // ficou definido para a tara", "eu tenho que pensar que estou no mesmo app e
  // não cada chat parecer um app diferente". O ramo do CC passa isto desde
  // sempre (linha 194); o do Codex nunca passou.
  //
  // A fonte NÃO é `statusDaFrota` cru: no Codex ele oscila entre polls e o
  // cursor piscaria no vale. É a presença da linha viva — que já nasce
  // amortecida por `ancoraDaLinhaViva` (vencida + trabalho em voo) e é sempre
  // o último item quando existe.
  const estaRodando = itens[itens.length - 1]?.kind === 'linha-viva';

  return (
    <div className="ck-feed-enter flex min-h-0 flex-1 flex-col">
      <Feed itens={itens} lookup={lookup} agentSlug={agentSlug} estaRodando={estaRodando} />
    </div>
  );
}
