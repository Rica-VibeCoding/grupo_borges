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
 * Dono: Daniel (pele). As medidas vêm do esqueleto.
 */
import Link from 'next/link';
import type { MouseEvent } from 'react';
import type {
  Agent,
  SparklineBucket,
} from '@grupo_borges/cockpit-core/cockpit-types';
import { resolveContextPct } from '@grupo_borges/cockpit-core/cockpit-types';
import { ordenaTropa } from '@/lib/ordena-tropa';
import {
  BarraDeContexto,
  LARGURA_NA_LISTA,
  SemContexto,
  ValorDoContexto,
} from './barra-de-contexto';
import { estadoDe } from './estado';
import { Off } from './etiqueta-off';
import { TETO_PCT } from './medidor';
import { Retrato } from './retrato';
import { Statusline } from './statusline';
import { cliqueSimples } from './superficie-otimista';

/** Quem sabe navegar sem esperar o servidor. `undefined` fora do provider da
 *  tropa (e sem JavaScript): aí os itens são `<Link>` de verdade, como sempre
 *  foram. */
export type EscolheAgente = (slug: string, href: string) => void;

/** O `onClick` dos dois formatos de item. Só intercepta clique primário sem
 *  modificador — ctrl/cmd/shift continua abrindo noutra aba pelo navegador. */
function escolheNoToque(slug: string, href: string, aoEscolher?: EscolheAgente) {
  if (!aoEscolher) return undefined;
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (!cliqueSimples(e)) return;
    e.preventDefault();
    aoEscolher(slug, href);
  };
}

/**
 * A pasta em que o agente trabalha, sem a raiz que todos compartilham.
 *
 * Ordem do Rica (02/08): *"toda tropa eu tenho que saber em que pasta que tá,
 * para não ficar perguntando"*. Em 03/08 ele recortou: a pasta vale pra quem
 * está DE PÉ (cartão de duas linhas); na linha de quem dorme ela saiu junto
 * com o "há 20h" — nome + contexto bastam. Então hoje só o `CartaoVivo` chama.
 *
 * Cortamos só `/home/clawd/repos/`: `fluyt/apps/pos` distingue app de app, coisa
 * que o último segmento sozinho (`pos`) não faria. Gêmea da do cockpit antigo
 * (`apps/web/lib/cockpit-types.ts`) e deliberadamente NÃO compartilhada — o
 * `cockpit-core` é do Pavan, e o antigo está congelado, então a cópia morre com ele.
 */
const RAIZ_DOS_REPOS = '/home/clawd/repos/';

/** O endereço-casa: quem mora no próprio workspace da frota. */
const CASA_DA_FROTA = 'ze_claude/';

function pastaCurta(
  workspacePath: string | null | undefined,
  slug: string,
): string | null {
  if (!workspacePath) return null;
  const limpo = workspacePath.replace(/\/+$/, '');
  if (!limpo) return null;
  const curta = limpo.startsWith(RAIZ_DOS_REPOS)
    ? limpo.slice(RAIZ_DOS_REPOS.length)
    : limpo;
  // Quem está em `ze_claude/<slug>` está na própria casa, e dizer isso é
  // repetir o nome que está três pixels acima. O que informa é o DESVIO: o
  // Daniel em `grupo_borges`, o Hiro em `promob-splitter-hiro`. Comparado
  // contra o slug, não contra uma lista — agente novo entra sozinho.
  return curta === `${CASA_DA_FROTA}${slug}` ? null : curta;
}

/**
 * O pulso das últimas 24 horas — `sparkline` do `/api/fleet`, um balde por hora.
 *
 * Marca d'água na base do cartão, atrás do conteúdo: é contexto de fundo, não
 * um dado a ler. Quem trabalhou tem relevo; quem passou o dia parado devolve
 * `null` e o cartão fica liso — a ausência do desenho É a leitura, e desenhar
 * uma régua reta de zeros seria dizer "medi e não achei nada" com a mesma tinta
 * de quem produziu.
 *
 * Normalizado pelo próprio máximo do agente, nunca pelo da frota: a Tara sozinha
 * responde por três ordens de grandeza a mais que o resto, e numa escala comum
 * ela achataria as outras oito em linha reta. Aqui a pergunta é "o dia DELE foi
 * cheio?", não "quem gastou mais".
 *
 * Barra de 2px com 1px de respiro, largura própria de 71px — NÃO `flex-1`
 * espalhado pela linha inteira. Com 24 baldes numa faixa de 700px cada barra
 * saía com 28px de largura e o desenho parava de ler como gráfico: virava um
 * bloco cinza solto na base do cartão. Sparkline é textura, e textura precisa
 * de traço fino.
 *
 * Só no modo largo. Na coluna de 260px a telemetria já ocupa a linha inteira e
 * o pulso encostaria no percentual — dois layouts, não um responsivo.
 */
function Pulso({ buckets }: { buckets: SparklineBucket[] }) {
  const max = Math.max(0, ...buckets.map((b) => b.tokens));
  if (max <= 0) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute flex items-end"
      style={{
        right: 'var(--ck-space-3)',
        bottom: 'var(--ck-space-2)',
        gap: '1px',
        height: '13px',
        // O chão das 24 horas. Sem ele os traços de quem trabalhou em duas
        // horas do dia ficam boiando e leem como falha de renderização; com
        // ele, a mesma tinta vira eixo, e o vazio ao lado passa a significar
        // "aqui não houve nada" em vez de "aqui não desenhou".
        borderBottom: '1px solid var(--ck-text-primary)',
        opacity: 0.22,
      }}
    >
      {buckets.map((b) => (
        // Hora sem token não desenha traço, mas continua ocupando o seu lugar na
        // fila — a grade das 24 horas é o que deixa ler QUANDO o trabalho
        // aconteceu. Um piso de altura para todo mundo enchia o desenho de
        // pontinhos e o que se via era um pontilhado, não um gráfico.
        <span
          key={b.bucket}
          className="block"
          style={{
            width: '2px',
            height: b.tokens > 0 ? `${Math.max(12, Math.round((b.tokens / max) * 100))}%` : 0,
            borderRadius: '1px 1px 0 0',
            background: 'var(--ck-text-primary)',
          }}
        />
      ))}
    </span>
  );
}

function CartaoVivo({
  agente,
  selecionado,
  agora,
  compacta,
  aoEscolher,
}: {
  agente: Agent;
  selecionado: boolean;
  agora: number;
  compacta: boolean;
  aoEscolher?: EscolheAgente;
}) {
  const estado = estadoDe(agente.status);
  const pasta = pastaCurta(agente.workspace_path, agente.slug);
  const href = `/agente/${agente.slug}`;
  return (
    <li>
      <Link
        href={href}
        onClick={escolheNoToque(agente.slug, href, aoEscolher)}
        className="ck-veil ck-aba relative flex items-center overflow-hidden"
        data-selecionado={selecionado ? 'true' : 'false'}
        aria-current={selecionado ? 'page' : undefined}
        style={{
          gap: 'var(--ck-space-3)',
          minHeight: 'var(--ck-touch-min)',
          // Só o respiro VERTICAL: o lateral mora na `.ck-aba`, que é quem sabe
          // devolvê-lo do lado direito quando a aba avança sobre a folha.
          paddingBlock: 'var(--ck-space-2)',
          // Filete só marca SELEÇÃO. O estado já está dito duas vezes — título
          // da seção e ponto no retrato; uma terceira seria ruído.
          borderLeft: `2px solid ${selecionado ? 'var(--ck-text-primary)' : 'transparent'}`,
        }}
      >
        {compacta ? null : <Pulso buckets={agente.sparkline} />}

        {/* O ponto de estado vale nos DOIS modos desde que o título da seção
            passou a carregar a palavra. Ele é o reforço local: quando a lista
            é longa e o título grudado já rolou pra fora do alcance do olho,
            o ponto continua dizendo em que estado esta linha está. */}
        <Retrato
          slug={agente.slug}
          nome={agente.name}
          tamanho={compacta ? 34 : 40}
          marca={{ cor: estado.cor, rotulo: estado.rotulo, estado: agente.status }}
        />

        <span className="relative flex min-w-0 flex-1 flex-col" style={{ gap: '3px' }}>
          <span
            className="min-w-0 truncate tracking-title"
            style={{
              fontSize: compacta ? 'var(--ck-text-sm)' : 'var(--ck-text-base)',
              color: 'var(--ck-text-primary)',
            }}
          >
            {agente.name}
          </span>

          <Statusline agente={agente} agora={agora} curta={compacta} />

          {/* Terceira linha, e não um pedaço da statusline: aquela é telemetria
              viva (modelo · sessão · contexto) e a pasta é fato de cadastro, que
              não muda no ritmo dos outros três. `secondary`, nunca `tertiary` —
              texto de 12px em `tertiary` fura o piso de 4.5:1 da §3. */}
          {pasta ? (
            <span
              className="min-w-0 truncate"
              style={{
                fontFamily: 'var(--ck-font-mono)',
                fontSize: 'var(--ck-text-xs)',
                color: 'var(--ck-text-secondary)',
              }}
              title={agente.workspace_path}
            >
              {pasta}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

function LinhaDormindo({
  agente,
  selecionado,
  compacta,
  aoEscolher,
}: {
  agente: Agent;
  selecionado: boolean;
  compacta: boolean;
  aoEscolher?: EscolheAgente;
}) {
  const pct = resolveContextPct(agente);
  const href = `/agente/${agente.slug}`;
  return (
    <li>
      <Link
        href={href}
        onClick={escolheNoToque(agente.slug, href, aoEscolher)}
        className="ck-veil ck-aba flex items-center"
        data-selecionado={selecionado ? 'true' : 'false'}
        aria-current={selecionado ? 'page' : undefined}
        style={{
          gap: 'var(--ck-space-3)',
          minHeight: 'var(--ck-touch-min)',
          paddingBlock: 'var(--ck-space-1)',
          borderLeft: `2px solid ${selecionado ? 'var(--ck-text-primary)' : 'transparent'}`,
        }}
      >
        {/* Retrato menor e esmaecido: quem dorme continua reconhecível de
            relance, sem competir por atenção com quem está de pé. A opacidade vai
            no próprio retrato — um `<span>` em volta virava item de flex, esticava
            até a altura da linha e achatava a cara de todo mundo.

            O `<span>` voltou, e agora é a COLUNA do retrato: ele reserva a
            largura do retrato de quem está de pé e centraliza o menor dentro.
            Sem isso o nome de quem dorme começava 6px (coluna) e 12px (tela
            cheia) à esquerda do nome de quem trabalha, e a lista descia em
            ziguezague — é o "alinhar labels e ícones vertical e horizontalmente"
            que a Linear descreve como o trabalho que só se sente depois de
            alguns minutos de uso. O achatamento de antes vinha do `stretch`
            que o pai dá a todo item de flex; `self-center` sem altura própria é
            o que o desliga. */}
        <span
          className="flex shrink-0 items-center self-center"
          style={{ flexBasis: compacta ? '34px' : '40px' }}
        >
          <Retrato slug={agente.slug} nome={agente.name} tamanho={28} opacidade={0.55} />
        </span>

        <span
          className="min-w-0 flex-1 truncate"
          style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}
        >
          {agente.name}
        </span>

        {/* Ordem do Rica (03/08): quem dorme mostra NOME + CONTEXTO — "a
            quantidade de contexto usado, tipo 30% de um milhão de tokens", o
            número que decide o /compact quando a sessão voltar. SEM pasta
            ("nenhum endereço do repositório ali") e SEM "há 20h" ("um timing
            que não me interessa") — a ordem de 02/08 valia pra tropa de pé; pra
            quem dorme, pasta e relógio viraram ruído na linha única.
            O instrumento é o MESMO da statusline dos vivos (`BarraDeContexto` +
            teto de 30%): dado velho lido com régua diferente mente duas vezes.
            O valor
            é o último que o pane gravou antes de morrer — `resolveContextPct`
            cai no `context_pct` do banco quando o excerpt já não tem barra. */}
        {pct !== null ? (
          <span
            className="ck-tabular flex shrink-0 items-center"
            style={{
              gap: 'var(--ck-space-1)',
              fontFamily: 'var(--ck-font-mono)',
              fontSize: 'var(--ck-text-xs)',
              color: 'var(--ck-text-secondary)',
            }}
            title={
              agente.context_stale
                ? `contexto ${pct}% de uma sessão anterior a esta — não é a leitura de quando ela fechou`
                : `contexto ${pct}% ao fechar a sessão — teto da frota ${TETO_PCT}%`
            }
          >
            {/* O chip OFF no lugar do "antigo" (15/08): o número desta linha é
                sempre de sessão morta, então "antigo" não distingue nada —
                dizia a velhice como se fosse exceção, e o Rica leu o rótulo
                num agente recém-desligado como se a leitura de agora estivesse
                atrasada. Quem está nesta linha está DESLIGADO por definição:
                a palavra é o estado. A origem do número (fechou assim ou
                veio de run antigo) continua no `title` do contêiner acima.
                Vem ANTES do número, como a etiqueta de sempre: depois dele, o
                chip empurrava o valor para dentro da linha e a Tara era a
                única a sair da coluna — 69px à esquerda de todo mundo. */}
            <Off />
            {/* Na coluna de 260px a barra sai e fica o número. Somados, barra +
                percentual + a palavra "antigo" comiam 142 dos 188px úteis da
                linha e sobrava "Tar…" no lugar de "Tara Kaur". Entre desenhar a
                régua e conseguir ler de quem é o número, ler de quem é vem
                primeiro — e o julgamento não se perde: o valor continua ao lado
                do teto de 30%, em âmbar quando passa. Na tela cheia cabe tudo. */}
            {compacta ? null : <BarraDeContexto pct={pct} largura={LARGURA_NA_LISTA} />}
            <ValorDoContexto pct={pct} />
          </span>
        ) : (
          // Gêmeo do da statusline viva: sessão que morreu sem gravar o número
          // não inventa zero — e a ausência mora na MESMA coluna do número, do
          // tamanho dela. Enquanto era a frase "sem contexto", os doze
          // caracteres cortavam o nome do agente ("Lucas Marc…") para caber.
          <span
            className="flex shrink-0 items-center"
            style={{
              fontFamily: 'var(--ck-font-mono)',
              fontSize: 'var(--ck-text-xs)',
            }}
          >
            <SemContexto />
          </span>
        )}
      </Link>
    </li>
  );
}

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
  // Ordem DITADA pelo Rica (11/08): a posição carrega identidade, não estado.
  // Antes cada estado era uma seção e qualquer flip trabalhando↔ocioso movia a
  // linha — a "dança" que ele reprovou. A sequência mora em
  // `lib/ordena-tropa.ts` e nenhum estado a altera.
  const agentesOrdenados = ordenaTropa(agents);

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
      className="flex min-h-0 flex-col overflow-y-auto"
      style={{ padding: '0 var(--ck-space-2) var(--ck-space-4)' }}
    >
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
            />
          ) : (
            <CartaoVivo
              key={a.slug}
              agente={a}
              selecionado={a.slug === slugSelecionado}
              agora={agora}
              compacta={compacta}
              aoEscolher={aoEscolher}
            />
          ),
        )}
      </ul>

      {/* No aplicativo instalado não existe barra de endereço: esta é a única
          porta para a tela de medição. Fora dela, digitar a URL resolve. */}
      <Link
        href="/diagnostico"
        style={{
          padding: 'var(--ck-space-4) var(--ck-space-2)',
          fontSize: 'var(--ck-text-sm)',
          color: 'var(--ck-text-secondary)',
        }}
      >
        Diagnóstico do aparelho
      </Link>
    </nav>
  );
}
