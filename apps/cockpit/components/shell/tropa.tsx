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
 * Dono: Daniel (pele). As medidas vêm do esqueleto.
 */
import Link from 'next/link';
import type { Agent, AgentStatus } from '@grupo_borges/cockpit-core/cockpit-types';
import { resolveContextPct } from '@grupo_borges/cockpit-core/cockpit-types';
import { Badge } from '@/components/ui/badge';
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

function pastaCurta(workspacePath: string | null | undefined): string | null {
  if (!workspacePath) return null;
  const limpo = workspacePath.replace(/\/+$/, '');
  if (!limpo) return null;
  return limpo.startsWith(RAIZ_DOS_REPOS) ? limpo.slice(RAIZ_DOS_REPOS.length) : limpo;
}

/** Chip de estado: ponto + palavra. A cor sozinha nunca carrega o sentido. */
function ChipEstado({ status }: { status: AgentStatus }) {
  const estado = estadoDe(status);
  return (
    <Badge
      variant="ghost"
      className="shrink-0"
      style={{
        gap: '5px',
        padding: '2px 8px',
        background: 'var(--ck-surface-raised)',
        fontSize: 'var(--ck-text-xs)',
        color: estado.cor,
      }}
    >
      <span
        aria-hidden
        className="ck-pulso shrink-0 rounded-full"
        data-estado={status}
        style={{ width: '5px', height: '5px', background: 'currentColor' }}
      />
      {estado.rotulo}
    </Badge>
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
  const pasta = pastaCurta(agente.workspace_path);
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
          padding: 'var(--ck-space-2) var(--ck-space-3)',
          // Filete só marca SELEÇÃO. O estado já está dito duas vezes no chip
          // (cor + palavra); uma terceira seria ruído.
          borderLeft: `2px solid ${selecionado ? 'var(--ck-text-primary)' : 'transparent'}`,
        }}
      >
        {/* Na coluna de 260px o estado vira ponto no retrato e devolve a linha
            inteira ao nome — com a palavra sobrando, "Daniel Singh" virava
            "Daniel …". No celular há largura pro chip escrito. */}
        <Retrato
          slug={agente.slug}
          nome={agente.name}
          tamanho={compacta ? 34 : 40}
          marca={
            compacta
              ? { cor: estado.cor, rotulo: estado.rotulo, estado: agente.status }
              : undefined
          }
        />

        <span className="flex min-w-0 flex-1 flex-col" style={{ gap: '3px' }}>
          <span className="flex min-w-0 items-center" style={{ gap: 'var(--ck-space-2)' }}>
            <span
              // SEM `flex-1`: esticava até a borda da linha e empurrava o chip
              // pra ponta. No nav compacto (260px) não muda nada — não há chip
              // pra empurrar. Na raiz (`/`), onde a coluna de leitura chega a
              // 32rem, era isso que abria o rio entre o nome e o chip; a folga
              // que sobra agora vai pro FIM da linha, depois do chip, onde não
              // lê como "os dois se separaram".
              className="min-w-0 truncate tracking-title"
              style={{
                fontSize: compacta ? 'var(--ck-text-sm)' : 'var(--ck-text-base)',
                color: 'var(--ck-text-primary)',
              }}
            >
              {agente.name}
            </span>
            {compacta ? null : <ChipEstado status={agente.status} />}
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
}: {
  agente: Agent;
  selecionado: boolean;
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
            <Barra pct={pct} />
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

function Overline({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="flex items-baseline tracking-overline"
      style={{
        gap: 'var(--ck-space-2)',
        padding: 'var(--ck-space-3) var(--ck-space-3) var(--ck-space-1)',
        fontSize: 'var(--ck-text-xs)',
        textTransform: 'uppercase',
        // tertiary dá 3.55:1 e o contrato o restringe a ícone/separador/texto
        // ≥20px. Overline é label de 12px, então vai de secondary (6.0:1).
        color: 'var(--ck-text-secondary)',
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
  const ordenar = (a: Agent, b: Agent) => {
    const da = estadoDe(a.status).ordem;
    const db = estadoDe(b.status).ordem;
    return da !== db ? da - db : a.name.localeCompare(b.name, 'pt-BR');
  };
  const vivos = agents.filter((a) => a.status !== 'offline').sort(ordenar);
  const dormindo = agents.filter((a) => a.status === 'offline').sort(ordenar);
  const chamando = agents.filter((a) => a.status === 'aguardando').length;

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
      <Overline>
        <span>Tropa</span>
        {chamando > 0 ? (
          <span className="ck-tabular" style={{ color: 'var(--ck-state-attention)' }}>
            {chamando} chamando
          </span>
        ) : null}
      </Overline>

      <ul>
        {vivos.map((a) => (
          <CartaoVivo
            key={a.slug}
            agente={a}
            selecionado={a.slug === slugSelecionado}
            agora={agora}
            compacta={compacta}
          />
        ))}
      </ul>

      {dormindo.length > 0 ? (
        <>
          <Overline>
            <span>Offline</span>
            <span className="ck-tabular" style={{ color: 'var(--ck-text-tertiary)' }}>
              {dormindo.length}
            </span>
          </Overline>
          <ul>
            {dormindo.map((a) => (
              <LinhaDormindo
                key={a.slug}
                agente={a}
                selecionado={a.slug === slugSelecionado}
              />
            ))}
          </ul>
        </>
      ) : null}
    </nav>
  );
}
