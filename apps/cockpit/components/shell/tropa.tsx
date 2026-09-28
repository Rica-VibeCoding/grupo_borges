/**
 * Tropa — a lista de agentes.
 *
 * Mora aqui, e não dentro de `app/page.tsx`, porque aparece em DUAS superfícies:
 * é a rota `/` inteira no celular e é a coluna de navegação no desktop, inclusive
 * quando você já está dentro de um agente.
 *
 * SEGUNDA VERSÃO — a primeira o Rica reprovou de olho, e com razão: nove linhas
 * de peso idêntico, emoji de família visual diferente cada um (três deles nulos,
 * virando bolinha), e nenhuma telemetria. O levantamento contra o cockpit antigo
 * está em `docs/cockpit-v2-tropa-levantamento.md`. As três decisões que saíram
 * dele:
 *
 * 1. RETRATO NO LUGAR DE EMOJI. O antigo nunca usou emoji — usa foto por slug com
 *    inicial de reserva, e é daí que vem o "mais bonito". Detalhe em `retrato.tsx`.
 * 2. TELEMETRIA DE VOLTA. Modelo, tempo de sessão e contexto — a statusline é o
 *    que ele mais olha. Sessão morta mostra só o CONTEXTO (ordem do Rica, 03/08:
 *    "tipo 30% de um milhão de tokens", é o número que decide o /compact na
 *    volta); modelo, tempo de sessão, pasta e "há 20h" somem — telemetria de
 *    sessão morta é ruído, e o relógio ele disse que não lê.
 * 3. HIERARQUIA POR VIDA. Quem está de pé ganha cartão de duas linhas; quem está
 *    offline vira uma linha rasa sob um divisor que conta quantos são. A lista
 *    plana era o que fazia sete agentes dormindo pesarem igual ao que trabalha.
 *
 * O que ficou da primeira versão porque estava certo: `aguardando` sobe pro topo.
 * O único estado quente é o único que chama o Rica.
 *
 * TERCEIRA VERSÃO (09/08) — ordem do Rica: *"tem que deixar uma tela bonita,
 * como se fosse pintar as paredes da casa nova"*. Nada aqui é gosto; as quatro
 * mudanças saíram de olhar a coluna renderizada e perguntar o que cada pixel
 * informa:
 *
 * 4. O ESTADO VIRA SEÇÃO. A lista já ordenava por estado desde a v2, mas a tela
 *    não contava isso: na coluna de 260px o único sinal era um ponto de 9px no
 *    canto do retrato, e a ordem lia como alfabética quebrada. Agora cada estado
 *    é um grupo com título contado e GRUDADO no topo enquanto se rola — a
 *    palavra que diz em que estado você está lendo nunca sai da tela. Com isso o
 *    chip por linha saiu: repetia nove vezes, três pixels abaixo, a palavra que
 *    o título já diz.
 * 5. A PASTA VIRA EXCEÇÃO. `ze_claude/<slug>` é o endereço-casa de quem mora no
 *    próprio workspace, e era o que seis das nove linhas diziam — uma linha
 *    inteira repetindo o nome logo acima. Some quando é a casa, aparece quando
 *    não é. Deixou de ser rótulo e virou informação: quem exibe pasta está fora
 *    de casa.
 * 6. COR SÓ ONDE HÁ JULGAMENTO. Detalhe na `BarraDeContexto`.
 * 7. O PULSO DE 24H. O `/api/fleet` sempre entregou `sparkline` — 24 baldes de
 *    token por hora, por agente — e nenhuma tela do v2 lia. Sem ele, quem não
 *    gastou um token hoje pesa igual a quem gastou um milhão. Entra como marca
 *    d'água na base do cartão: não pede linha, não compete com texto nenhum, e
 *    quem não trabalhou simplesmente não desenha nada. A ausência é a
 *    informação.
 *
 * QUARTA VERSÃO (10/08) — A COLUNA GANHA UMA VERTICAL. A ordem do Rica foi
 * "melhore a UI da sidebar"; o que a medição mostrou é que a lista não tinha
 * grade nenhuma. Cada linha se arranjava sozinha por flex, então barra e
 * percentual pousavam onde o texto à esquerda tivesse terminado — medido no
 * browser, o `%` caía em cinco `x` diferentes, com **72px** de dança na coluna
 * de 260px e **84px** na tela cheia. É o que fazia a coluna serrilhar, e é o
 * mesmo defeito que o Rica reprovou de olho no print de 09/08.
 *
 * A pesquisa do Canário (`docs/pesquisa-sidebar-tropa-canario.md`) chegou nisso
 * por outro caminho, citando a Linear: *"alinhar labels, ícones e botões
 * vertical e horizontalmente na sidebar"* é descrito lá como o trabalho que o
 * usuário só sente depois de alguns minutos — nunca na primeira olhada. As
 * quatro mudanças, todas a mesma tese:
 *
 * 8. O CONTEXTO ENCOSTA NA DIREITA e o número é a última coluna da linha, com
 *    largura reservada (`ValorDoContexto`). Depois: dança **zero** nos dois
 *    tamanhos. De quebra o modelo herda todo o espaço à esquerda e para de ser
 *    cortado no meio da palavra.
 * 9. A AUSÊNCIA VIRA TRAÇO. `sem contexto` tinha doze caracteres na coluna onde
 *    os outros têm dois, e quem cedia era o nome do agente: `Lucas Marchetti`
 *    precisava de 95px, tinha 80, e saía `Lucas Marc…`. O dado sumia para caber
 *    a falta dele. Detalhe em `SemContexto`.
 * 10. O RETRATO TEM COLUNA. O de quem dorme é menor (28 contra 34/40), e sem um
 *    slot de largura fixa o nome dele começava 6px (coluna) e 12px (tela cheia)
 *    à esquerda do nome de quem trabalha — a lista descia em ziguezague.
 * 11. O PERCENTUAL É INTEIRO. Só a Tara vinha com casa decimal (`14.5%`) e ela
 *    sozinha quebrava a coluna tabular. Detalhe em `ValorDoContexto`.
 *
 * QUINTA VERSÃO (11/08) — A POSIÇÃO PARA DE CARREGAR O ESTADO. Ordem do Rica:
 * a coluna dançava — cada flip trabalhando↔ocioso movia a linha de seção, e a
 * seção que esvaziava sumia junto com o título, empurrando todo mundo abaixo.
 * Ele reprovou a experiência, e a correção saiu da boca dele: SÓ COMPORTAMENTO.
 * Nada de chip, nada de componente novo, nada de pixel redesenhado. As seções
 * morrem e a lista vira UMA ordem só (`ordenaTropa` em `lib/ordena-tropa.ts`);
 * a palavra do estado sai da tela junto com os títulos — o ponto do retrato
 * fica. O visual de cada linha fica intocado — quem dorme continua linha rasa,
 * porque isso é decisão POR LINHA, não por seção.
 *
 * SEXTA VERSÃO (11/08) — A ORDEM VIRA DITADA. O alfabeto matou a dança mas
 * embaralhava a leitura: quem estava de pé ficava separado por quem dorme. O
 * Rica ditou a sequência agente a agente e ela vale sempre, viva ou morta a
 * sessão. `aguardando` deixou de subir junto — ordem fixa não tem exceção.
 *
 * SÉTIMA VERSÃO (17/08) — A ORDEM DITADA VIRA ORDEM ARRASTADA. Ordem do Rica:
 * *"eu quero poder arrastar eles como se fosse um kanban, para cima, para
 * baixo"*. A sequência da v6 não morre: ela vira a ordem de fábrica, e vale até
 * o primeiro arrasto (`lib/ordena-tropa.ts`). O que muda de dono é a posição —
 * era do arquivo, passa a ser dele, gravada em `agent_state.ordem`.
 *
 * O gesto entra pela LINHA INTEIRA. A primeira tentativa punha o arrasto numa
 * alça de pontinhos à direita; o teste no iPhone do Rica mostrou que ele não
 * achava a alça e que o pedido dele era o oposto — *"clicar direto no card sem
 * ter esses pontinhos"*. Toque curto abre o agente, toque-e-segure carrega a
 * linha, deslize rola a coluna: a separação é do iOS, não nossa. O porquê
 * detalhado, com fonte de cada decisão, está em `arrasto-da-tropa.tsx`.
 *
 * OITAVA VERSÃO (28/09) — O ESTADO MORA NA FOTO. Ordem do Rica: *"faça uma
 * releitura da sidebar… mais bonita, na UX melhor"*. O print do celular mostrou
 * que a pergunta nº 1 de quem abre a tropa — quem está trabalhando? — não se
 * lia: era um ponto de 9px no canto do retrato. A ousadia foi gasta num lugar só
 * e o resto ficou quieto:
 *
 * 12. O ANEL. `trabalhando` ganha um anel na cor de execução em volta da foto,
 *    respirando devagar; `aguardando`, anel de atenção num ritmo curto e a
 *    segunda linha dizendo "aguarda você". Ocioso e offline, sem anel. Com
 *    `prefers-reduced-motion`, o anel fica parado. O ponto saiu — o estado
 *    segue no `title` e no nome acessível do link. CSS em `.ck-anel`.
 * 13. UM TEXTO PRIMÁRIO POR LINHA. O nome. "Opus 5.5" saía na cor primária, do
 *    tamanho do nome, e competia com ele em toda linha viva: virou metadado
 *    menor, junto do relógio. Relógio e percentual saíram da mono (sans
 *    tabular não dança igual); a mono ficou só na pasta, que é endereço.
 * 14. O PERCENTUAL SOBE PARA A LINHA DO NOME, vivo ou dormindo: uma vertical
 *    só, na altura do nome. A barra saiu da lista — o número já é o dado e o
 *    âmbar acima do teto já é o julgamento; o desenho continua na gaveta.
 * 15. O PULSO ENTRA NO FLUXO. Era marca d'água absoluta e, no celular,
 *    encavalava no percentual. Agora é caixa própria na segunda linha, nos
 *    dois layouts, com o lugar reservado mesmo quando não há o que desenhar.
 * 16. QUEM DORME PERDE O CHIP. Sete "off" com borda e sete trilhos vazios
 *    repetiam o que a linha rasa e a foto esmaecida já dizem — era o chip por
 *    linha repetindo estado que a v3 já tinha matado. A palavra "desligado"
 *    segue para o leitor de tela.
 * 17. A SEGUNDA LINHA NÃO FICA OCA. Quem está de pé sem modelo (Canário,
 *    Fluyt) sobe a pasta para ela, em vez de deixar um buraco.
 * 18. A VPS VIRA RELANCE. Quatro números numa faixa, cor só acima do teto, e a
 *    lista de processos recolhida atrás de "ver processos". Em `bloco-da-vps.tsx`.
 *
 * As linhas moram em `linha-da-tropa.tsx` desde esta versão: com elas aqui o
 * arquivo passava de 670 linhas fazendo duas coisas.
 *
 * Dono: Daniel (pele). As medidas vêm do esqueleto.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import { patchOrdemDaTropa } from '@grupo_borges/cockpit-core/api';
import { ordenaTropa } from '@/lib/ordena-tropa';
import {
  aplicaOrdem,
  mesmaOrdem,
  moveUmaCasa,
  novaOrdem,
  ordemJaChegou,
} from '@/lib/ordem-arrastada';
import { TIPO_ARRASTO } from './arrasto-da-tropa';
import { BlocoDaVps } from './bloco-da-vps';
import { estadoDe } from './estado';
import { CartaoVivo, LinhaDormindo, type EscolheAgente } from './linha-da-tropa';

export type { EscolheAgente };

export function Tropa({
  agents,
  slugSelecionado,
  agora,
  compacta = false,
  aoEscolher,
}: {
  agents: Agent[];
  slugSelecionado?: string;
  agora: number;
  /** `true` na coluna de navegação do desktop (260px), `false` na rota `/` do
   *  celular, que é tela cheia. Não é o mesmo layout em duas larguras — são dois
   *  layouts, e fingir o contrário foi o que cortou nome e modelo. */
  compacta?: boolean;
  aoEscolher?: EscolheAgente;
}) {
  // A posição carrega identidade, não estado (11/08): nenhum flip
  // trabalhando↔ocioso move linha nenhuma — a "dança" que o Rica reprovou.
  // Desde 17/08 a sequência vem do banco quando ele já arrastou; a lista ditada
  // em `lib/ordena-tropa.ts` virou a ordem de fábrica.
  const doServidor = useMemo(() => ordenaTropa(agents), [agents]);

  // A ordem que a tela mostra enquanto o servidor não confirma. O `/api/fleet`
  // só é relido no poll seguinte (5s), e sem isto a linha voltaria pro lugar
  // antigo assim que o dedo saísse da tela.
  const [ordemOtimista, setOrdemOtimista] = useState<string[] | null>(null);

  // Mover pela seta não muda nada que um leitor de tela perceba sozinho: o
  // foco fica no mesmo botão, com o mesmo rótulo, e a lista se reordena em
  // silêncio. A região viva é o que transforma o movimento em confirmação —
  // mesmo par `role="status"` + `aria-live` que o resto do shell já usa.
  const [recadoDoMovimento, setRecadoDoMovimento] = useState('');
  const agentesOrdenados = useMemo(
    () => aplicaOrdem(doServidor, ordemOtimista),
    [doServidor, ordemOtimista],
  );

  // Chegou a confirmação: a ordem otimista cumpriu o papel e sai de cena. Sem
  // isto ela seguiria mandando e a coluna pararia de refletir o banco.
  useEffect(() => {
    if (ordemJaChegou(doServidor, ordemOtimista)) setOrdemOtimista(null);
  }, [doServidor, ordemOtimista]);

  // Segurar a seta dispara uma tecla a cada ~30ms, e cada uma virava um PATCH
  // solto. Nada garantia que o último a sair fosse o último a gravar: bastava
  // uma resposta antiga vencer pro banco ficar com ordem mais velha que a tela,
  // sem se corrigir sozinho. A sequência descarta o que já foi ultrapassado —
  // é a mesma proteção que a LEITURA já tem em `usa-frota-ao-vivo.ts`.
  const sequenciaDaGravacao = useRef(0);

  const gravaOrdem = useCallback((nova: string[]) => {
    setOrdemOtimista(nova);
    const minhaVez = ++sequenciaDaGravacao.current;
    patchOrdemDaTropa(nova).catch(() => {
      // Falhou a gravação: devolve a ordem do servidor em vez de deixar a tela
      // mentindo uma posição que o banco não tem. Só que a requisição vencida
      // não manda mais em nada — limpar aqui apagaria a ordem de um PATCH
      // POSTERIOR que ainda está no ar.
      if (minhaVez === sequenciaDaGravacao.current) setOrdemOtimista(null);
    });
  }, []);

  const move = useCallback(
    (slug: string, direcao: -1 | 1) => {
      const slugs = agentesOrdenados.map((a) => a.slug);
      const movida = moveUmaCasa(slugs, slug, direcao);
      if (movida === slugs) return;
      gravaOrdem(movida);
      const posicao = movida.indexOf(slug) + 1;
      setRecadoDoMovimento(
        `${agentesOrdenados.find((a) => a.slug === slug)?.name ?? slug}, posição ${posicao} de ${movida.length}`,
      );
    },
    [agentesOrdenados, gravaOrdem],
  );

  // Um monitor pra lista inteira, não um por linha: quem sabe a ordem completa
  // é a lista, e o alvo de soltura só sabe de si mesmo.
  useEffect(
    () =>
      monitorForElements({
        canMonitor: ({ source }) => source.data.tipo === TIPO_ARRASTO,
        onDrop: ({ source, location }) => {
          const alvo = location.current.dropTargets[0];
          if (!alvo) return;
          const slugs = agentesOrdenados.map((a) => a.slug);
          const reordenada = novaOrdem(
            slugs,
            String(source.data.slug),
            String(alvo.data.slug),
            extractClosestEdge(alvo.data) as 'top' | 'bottom' | null,
          );
          // Soltou onde já estava: não gasta requisição nem pisca a lista.
          // Compara CONTEÚDO, não referência — soltar na borda de cima do
          // vizinho de baixo devolve a mesma sequência num array novo, e a
          // comparação por referência deixava esse caso passar batido.
          if (mesmaOrdem(reordenada, slugs)) return;
          gravaOrdem(reordenada);
        },
      }),
    [agentesOrdenados, gravaOrdem],
  );

  // Frota vazia: o backend responde, só não há ninguém. Diferente de erro, e a
  // tela precisa dizer qual dos dois é — lista vazia e sem palavra nenhuma lê
  // como falha de carregamento.
  if (agents.length === 0) {
    return (
      <nav
        aria-label="Tropa"
        className="flex flex-col justify-center"
        style={{ gap: 'var(--ck-space-1)', padding: 'var(--ck-space-5) var(--ck-space-4)' }}
      >
        <p style={{ fontSize: 'var(--ck-text-base)', color: 'var(--ck-text-primary)' }}>
          Nenhum agente na frota
        </p>
        <p style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
          O cockpit respondeu, mas não há sessão registrada.
        </p>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Tropa"
      // `flex-1`: a nav enche a faixa pra que o bloco da VPS, com `margin-top:
      // auto`, pouse no pé da coluna quando a lista é curta — e role junto com
      // ela quando não é. Na rota `/` o pai não tem altura fixa e o `flex-1`
      // não muda nada.
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      style={{ padding: '0 var(--ck-space-2) var(--ck-space-4)' }}
    >
      {/* Só quem move pela seta enche isto — o arrasto por ponteiro já se
          explica na tela. Fora da vista, mas na árvore de acessibilidade: a
          região precisa existir ANTES do recado pra que o leitor de tela a
          observe; criada junto com o texto, ela costuma não ser anunciada. */}
      <span role="status" aria-live="polite" className="sr-only">
        {recadoDoMovimento}
      </span>

      {/* Lista única, ordem ditada (11/08). O overline "Tropa" não
          existe desde a v3 e os títulos de estado morreram na v5 — a lista é a
          lista. A escolha de cartão ou linha rasa é POR LINHA, pelo estado
          resolvido (`estadoDe`): status desconhecido dorme como o offline, como
          a v3 já fazia. */}
      <ul>
        {agentesOrdenados.map((a) =>
          estadoDe(a.status).ordem === 3 ? (
            <LinhaDormindo
              key={a.slug}
              agente={a}
              selecionado={a.slug === slugSelecionado}
              compacta={compacta}
              aoEscolher={aoEscolher}
              aoMover={(direcao) => move(a.slug, direcao)}
            />
          ) : (
            <CartaoVivo
              key={a.slug}
              agente={a}
              selecionado={a.slug === slugSelecionado}
              agora={agora}
              compacta={compacta}
              aoEscolher={aoEscolher}
              aoMover={(direcao) => move(a.slug, direcao)}
            />
          ),
        )}
      </ul>

      {/* Ordem do Rica (07/09): o consumo da máquina na sidebar. Rodapé, e
          não cabeçalho: a tropa é o que ele abre pra ver; a máquina é o que
          ele confere de relance. */}
      <BlocoDaVps />
    </nav>
  );
}
