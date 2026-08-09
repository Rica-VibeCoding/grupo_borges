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
 * 6. COR SÓ ONDE HÁ JULGAMENTO. Detalhe na `Barra` (statusline.tsx).
 * 7. O PULSO DE 24H. O `/api/fleet` sempre entregou `sparkline` — 24 baldes de
 *    token por hora, por agente — e nenhuma tela do v2 lia. Sem ele, quem não
 *    gastou um token hoje pesa igual a quem gastou um milhão. Entra como marca
 *    d'água na base do cartão: não pede linha, não compete com texto nenhum, e
 *    quem não trabalhou simplesmente não desenha nada. A ausência é a
 *    informação.
 *
 * Dono: Daniel (pele). As medidas vêm do esqueleto.
 */
import Link from 'next/link';
import type {
  Agent,
  AgentStatus,
  SparklineBucket,
} from '@grupo_borges/cockpit-core/cockpit-types';
import { resolveContextPct } from '@grupo_borges/cockpit-core/cockpit-types';
import { estadoDe } from './estado';
import { Retrato } from './retrato';
import { Barra, Statusline, TETO_PCT } from './statusline';

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
}: {
  agente: Agent;
  selecionado: boolean;
  agora: number;
  compacta: boolean;
}) {
  const estado = estadoDe(agente.status);
  const pasta = pastaCurta(agente.workspace_path, agente.slug);
  return (
    <li>
      <Link
        href={`/agente/${agente.slug}`}
        className="ck-veil ck-aba relative flex items-center overflow-hidden"
        data-selecionado={selecionado ? 'true' : 'false'}
        aria-current={selecionado ? 'page' : undefined}
        style={{
          gap: 'var(--ck-space-3)',
          minHeight: 'var(--ck-touch-min)',
          padding: 'var(--ck-space-2) var(--ck-space-3)',
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
}: {
  agente: Agent;
  selecionado: boolean;
  compacta: boolean;
}) {
  const pct = resolveContextPct(agente);
  return (
    <li>
      <Link
        href={`/agente/${agente.slug}`}
        className="ck-veil ck-aba flex items-center"
        data-selecionado={selecionado ? 'true' : 'false'}
        aria-current={selecionado ? 'page' : undefined}
        style={{
          gap: 'var(--ck-space-3)',
          minHeight: 'var(--ck-touch-min)',
          padding: 'var(--ck-space-1) var(--ck-space-3)',
          borderLeft: `2px solid ${selecionado ? 'var(--ck-text-primary)' : 'transparent'}`,
        }}
      >
        {/* Retrato menor e esmaecido: quem dorme continua reconhecível de
            relance, sem competir por atenção com quem está de pé. A opacidade vai
            no próprio retrato — um `<span>` em volta virava item de flex, esticava
            até a altura da linha e achatava a cara de todo mundo. */}
        <Retrato slug={agente.slug} nome={agente.name} tamanho={28} opacidade={0.55} />

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
            O instrumento é o MESMO da statusline dos vivos (Barra + teto de
            30%): dado velho lido com régua diferente mente duas vezes. O valor
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
            {/* Na coluna de 260px a barra sai e fica o número. Somados, barra +
                percentual + a palavra "antigo" comiam 142 dos 188px úteis da
                linha e sobrava "Tar…" no lugar de "Tara Kaur". Entre desenhar a
                régua e conseguir ler de quem é o número, ler de quem é vem
                primeiro — e o julgamento não se perde: o valor continua ao lado
                do teto de 30%, em âmbar quando passa. Na tela cheia cabe tudo. */}
            {compacta ? null : <Barra pct={pct} />}
            <span style={{ color: pct > TETO_PCT ? 'var(--ck-state-attention)' : undefined }}>
              {pct}%
            </span>
            {/* Mesma etiqueta da statusline viva, pelo mesmo motivo: aqui o
                número já é de quem dormiu, e sem a palavra ninguém separa "o
                que ele tinha ao fechar" de "o que outro run tinha antes". */}
            {agente.context_stale ? (
              <span className="shrink-0" style={{ color: 'var(--ck-text-tertiary)' }}>
                antigo
              </span>
            ) : null}
          </span>
        ) : (
          // Rótulo gêmeo do da statusline viva: sessão que morreu sem gravar o
          // número diz "sem contexto", não inventa zero.
          <span
            className="shrink-0"
            style={{
              fontFamily: 'var(--ck-font-mono)',
              fontSize: 'var(--ck-text-xs)',
              color: 'var(--ck-text-tertiary)',
            }}
          >
            sem contexto
          </span>
        )}
      </Link>
    </li>
  );
}

/**
 * Título de seção. GRUDA no topo enquanto a seção rola.
 *
 * Não é efeito: com o chip fora da linha, é este título que carrega a palavra
 * do estado, e uma palavra que sai da tela deixa de carregar coisa alguma. Ele
 * fica onde o olho já está.
 *
 * As margens negativas existem porque o `<nav>` tem respiro lateral de 8px: sem
 * elas o fundo do título pararia antes da borda da coluna e as linhas passariam
 * por baixo pelas frestas. O texto não se mexe — o padding devolve os mesmos
 * 8+12px de recuo a partir da borda nova.
 */
function Overline({
  children,
  cor = 'var(--ck-text-secondary)',
}: {
  children: React.ReactNode;
  cor?: string;
}) {
  return (
    <p
      className="sticky top-0 flex items-baseline tracking-overline"
      style={{
        zIndex: 1,
        gap: 'var(--ck-space-2)',
        margin: '0 calc(var(--ck-space-2) * -1)',
        padding: 'var(--ck-space-3) calc(var(--ck-space-2) + var(--ck-space-3)) var(--ck-space-1)',
        background: 'var(--ck-surface-nav)',
        fontSize: 'var(--ck-text-xs)',
        textTransform: 'uppercase',
        // tertiary dá 3.55:1 e o contrato o restringe a ícone/separador/texto
        // ≥20px. Overline é label de 12px, então vai de secondary (6.0:1).
        color: cor,
      }}
    >
      {children}
    </p>
  );
}

export function Tropa({
  agents,
  slugSelecionado,
  agora,
  compacta = false,
}: {
  agents: Agent[];
  slugSelecionado?: string;
  agora: number;
  /** `true` na coluna de navegação do desktop (260px), `false` na rota `/` do
   *  celular, que é tela cheia. Não é o mesmo layout em duas larguras — são dois
   *  layouts, e fingir o contrário foi o que cortou nome e modelo. */
  compacta?: boolean;
}) {
  const porNome = (a: Agent, b: Agent) => a.name.localeCompare(b.name, 'pt-BR');
  // Uma passada só, e a ordem das seções sai da mesma tabela que ordenava a
  // lista plana (`ESTADO[].ordem`) — a régua do que vem antes continua sendo
  // uma, não duas.
  const secoes = (['aguardando', 'trabalhando', 'ocioso', 'offline'] as AgentStatus[])
    .map((status) => ({
      status,
      estado: estadoDe(status),
      // Comparado pela ORDEM do estado resolvido, não pelo campo cru: status
      // desconhecido cai em `offline` dentro do `estadoDe` e continua aparecendo.
      // Filtrar por igualdade de string faria o agente sumir da tela em silêncio.
      membros: agents
        .filter((a) => estadoDe(a.status).ordem === estadoDe(status).ordem)
        .sort(porNome),
    }))
    .filter((s) => s.membros.length > 0);

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
      {/* O overline "Tropa" saiu daqui: ele nomeava o que o `aria-label` já
          nomeia e o que a tela inteira já é. No lugar dele entram os títulos que
          dizem algo — o estado e quantos estão nele. */}
      {secoes.map(({ status, estado, membros }) => (
        <section key={status}>
          <Overline cor={status === 'aguardando' ? estado.cor : undefined}>
            <span>{estado.rotulo}</span>
            <span className="ck-tabular" style={{ opacity: 0.75 }}>
              {membros.length}
            </span>
          </Overline>
          <ul>
            {membros.map((a) =>
              status === 'offline' ? (
                <LinhaDormindo
                  key={a.slug}
                  agente={a}
                  selecionado={a.slug === slugSelecionado}
                  compacta={compacta}
                />
              ) : (
                <CartaoVivo
                  key={a.slug}
                  agente={a}
                  selecionado={a.slug === slugSelecionado}
                  agora={agora}
                  compacta={compacta}
                />
              ),
            )}
          </ul>
        </section>
      ))}
    </nav>
  );
}
