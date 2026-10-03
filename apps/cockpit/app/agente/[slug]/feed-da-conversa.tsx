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

import { memo, useEffect, useMemo, useReducer, useRef } from 'react';

import { ehMensagemResumoCompact } from '@grupo_borges/cockpit-core/chat-payload-classifier';
import type { AgentStatus } from '@grupo_borges/cockpit-core/cockpit-types';
import { buildToolResultLookup, textoEnfileirado } from '@grupo_borges/cockpit-core/render-items';
import { usaDelegacoes } from '@/components/feed/delegacoes.tsx';
import { Feed } from '@/components/feed/feed';
import type { ItemDoFeed } from '@/components/feed/grupo-ferramentas.ts';
import { estadoDoAgora, fraseEmVoo } from '@/components/feed/linha-do-agora.ts';
import { LinhaDoAgora } from '@/components/feed/linha-do-agora.tsx';
import { desdeDaLinhaViva } from '@/components/feed/linha-viva.ts';
import { usaLinhaVivaVencida } from '@/components/feed/linha-viva.tsx';
import { encerraOrfas } from '@/components/feed/orfas-do-turno.ts';
import { decideVazio } from '@/lib/decide-vazio.ts';
import { usaCompact } from '@/lib/compact';
import { publicaTurnoVivo, turnoVivoDe } from '@/lib/turno-vivo.ts';
import {
  publicaEscritaViva,
  saindoOutputNoFim,
} from '@/lib/escrita-viva.ts';
import { HISTORICO_PADRAO } from '@/lib/preaquece-conversa.ts';
import { createIncrementalRenderItems } from '@/lib/spike/render-items-incremental';
import { useCanarioStream } from '@/lib/spike/use-canario-stream';
import { usaFrota } from '@/components/shell/frota-provider';
import { dobraPedidosDoCockpit, poeMarco, poeTrocaEmAndamento } from '@/components/feed/troca-no-feed.ts';
import { SemConversa } from './sem-conversa';
import { usaEcoOtimista } from './usa-eco-otimista';
import { usaTrocaNoChat } from './usa-troca-no-chat';

/** O SELETOR. Executor decide a FONTE, nunca o desenho: os dois ramos terminam
 *  no mesmo `<Feed>`, com os mesmos itens e a mesma gramática. É a ordem do
 *  Rica em 09/08, olhando o chat vazio da Tara — *"tem que seguir a mesma UI
 *  que temos no CC"*.
 *
 *  O status da frota entra por prop, e não por hook lá dentro: o feed já lê a
 *  frota aqui para resolver o agente, e uma segunda assinatura do mesmo store
 *  dentro do filho só multiplicaria render. A frota muda a cada tique (relógio
 *  no `pane_excerpt`) e só esta casca paga: o `FeedClaudeCode` é memo e recebe
 *  o STATUS — tique que não muda o status deste agente não chega no feed. */
export function FeedDaConversa({ agentSlug }: { agentSlug: string }) {
  const { agents } = usaFrota();
  const agente = agents.find((a) => a.slug === agentSlug);

  return <FeedClaudeCode agentSlug={agentSlug} nome={agente?.name ?? agentSlug} statusDaFrota={agente?.status ?? null} />;
}

const FeedClaudeCode = memo(function FeedClaudeCode({
  agentSlug,
  nome,
  statusDaFrota,
}: {
  agentSlug: string;
  nome: string;
  /** O que a frota VIVA diz deste agente. Entra aqui só para desligar o
   *  "Pensando" quando ele sai do ar — ver `linha-viva-da-conversa.ts`. */
  statusDaFrota: AgentStatus | null;
}) {
  // `geracao`: o backend emite `session-reset` quando um Restart sem contexto
  // zera o histórico — o hook a incrementa e nasce com `messages` vazias.
  // Ela vira `key` lá embaixo (padrão react.dev de reset): Feed, virtualizador
  // e classificador incremental remontam no MESMO commit em que a lista zera —
  // sem frame com conteúdo velho, sem frame vazio no meio.
  const { messages, isRunning, status, geracao, troca } = useCanarioStream({
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
  // O ECO OTIMISTA (texto e anexo, na ordem do gesto) mora em
  // `usa-eco-otimista.ts` — a medição de 15/08 que o justifica foi junto.
  const comEco = usaEcoOtimista(agentSlug, messages);

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
  // O GRUPO NUNCA PRESO EM "RODANDO": ferramenta sem resultado de turno que
  // já acabou vira interrompida (`orfas-do-turno.ts`). Mesmas guardas do turno
  // vivo abaixo — prazo e desligamento visto pela frota.
  const turnoAcabou = !(isRunning && !vencida && statusDaFrota !== 'offline');
  const lookupDoFeed = useMemo(
    () => encerraOrfas(messages, lookup, turnoAcabou),
    [messages, lookup, turnoAcabou],
  );

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

  // PENSAR E EXECUTAR SÃO CARAS DIFERENTES. O freio acima só quer saber se há
  // turno em voo; a bolinha do composer precisa da distinção, porque é ela que
  // vai ficar no lugar do "Pensando há 12 s". As mesmas guardas do turno vivo
  // valem aqui — prazo e desligamento visto pela frota —, mais a régua do
  // output: a MESMA que escolhe entre a linha "Executando" e a "Pensando".
  useEffect(() => {
    const produzindo =
      isRunning && !vencida && statusDaFrota !== 'offline' && saindoOutputNoFim(itensBase, lookup);
    publicaEscritaViva(agentSlug, produzindo);
    return () => publicaEscritaViva(agentSlug, false);
  }, [agentSlug, isRunning, vencida, statusDaFrota, itensBase, lookup]);

  // A TROCA DE CONVERSA (F13): o turno do cockpit vira uma linha, o marco
  // costura as duas conversas, e durante a troca a lista fecha com "trocando".
  const { emCurso, marco } = usaTrocaNoChat(agentSlug, troca, messages);

  const itens = useMemo<readonly ItemDoFeed[]>(() => {
    let lista = dobraPedidosDoCockpit(itensBase) as ItemDoFeed[];
    if (marco) lista = poeMarco(lista, marco);
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
    return poeTrocaEmAndamento(lista, emCurso);
  }, [itensBase, delegacoes, marco, emCurso]);

  // A LINHA DO AGORA substitui a linha viva (02/10): a esfera fica sempre no
  // fim do feed, e a frase ao lado diz o que ele faz. As guardas são as do
  // turno vivo acima — prazo e desligamento visto pela frota.
  const turnoVivo = turnoVivoDe({ isRunning, vencida, statusDaFrota });
  const estadoAgora = estadoDoAgora({
    status: statusDaFrota ?? undefined,
    turnoVivo,
    produzindo: turnoVivo && saindoOutputNoFim(itensBase, lookup),
  });
  const emVoo = useMemo(() => fraseEmVoo(itensBase, lookup), [itensBase, lookup]);

  // O vazio virou função pura testada (`lib/decide-vazio.ts`, 11/08 — task
  // 2dac8a8b). As duas intenções originais sobrevivem: branco enquanto o
  // histórico não chegou (mesmo com delegação batendo na porta — ela
  // entraria sozinha e o histórico a empurraria depois), e "Sem conversa
  // ainda." só no vazio de verdade. A novidade: delegação conta como
  // conteúdo — agente sem histórico que delegou mostra a linha de quem
  // trabalha por ele em vez de mentir que não há nada.
  // O marco e a espera contam como conteúdo: a Nova nasce vazia, e o que ela
  // tem a dizer é justamente que acabou de nascer.
  const decisao = decideVazio({
    temHistorico: itensBase.length > 0 || marco !== null || emCurso !== null,
    temDelegacao: delegacoes.length > 0,
    status,
  });
  if (decisao !== 'feed') {
    return (
      <>
        {decisao === 'sem-conversa' ? <SemConversa geracao={geracao} agentSlug={agentSlug} /> : null}
      </>
    );
  }

  // O wrapper existe pra `key` + fade da troca de geração sem tocar em
  // `components/feed/**` (território do Hiro): `flex column` + `min-h-0`
  // repassam ao Feed exatamente o espaço que ele tinha antes.
  //
  // `ck-feed-chega` e não mais `ck-feed-enter` (28/09): a coluna que entra na
  // troca de agente sobe 6px além de acender. As duas classes juntas animariam
  // a opacidade em dobro; esta substitui aquela, e o Restart ganha o mesmo
  // gesto. O deslize é SÓ aqui, nunca no palco — ver `.ck-feed-chega`.
  return (
    <>
      <div
        key={geracao}
        className="ck-feed-chega flex min-h-0 flex-1 flex-col"
        data-saindo={emCurso?.fase === 'trocando' || emCurso?.fase === 'pronta' ? '' : undefined}
      >
        <Feed
          itens={itens}
          lookup={lookupDoFeed}
          agentSlug={agentSlug}
          // `turnoVivo`, não `isRunning` cru: turno que morreu sem despedida
          // deixaria o anel do grupo girando, o relógio contando e o cursor
          // piscando para sempre, com a linha do agora já parada.
          estaRodando={turnoVivo}
          rodape={<LinhaDoAgora estado={estadoAgora} emVoo={emVoo} desdeMs={desdeMs} />}
        />
      </div>
    </>
  );
});
