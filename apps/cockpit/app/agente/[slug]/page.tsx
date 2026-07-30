import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchFleet } from '@grupo_borges/cockpit-core/api';
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import { AppShell } from '@/components/shell/app-shell';
import { BarraDeTelas } from '@/components/shell/barra-de-telas';
import { Composer } from '@/components/shell/composer';
import { estadoDe } from '@/components/shell/estado';
import { leMotor } from '@/components/shell/motor';
import { Retrato } from '@/components/shell/retrato';
import { Tropa } from '@/components/shell/tropa';
import { lePane } from '@/lib/pane';

export const dynamic = 'force-dynamic';

/** Linha do painel. Rótulo em sans (voz do produto), valor em mono (voz da
 *  máquina) — a divisão do contrato §4 aplicada no menor lugar possível. */
function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <div className="flex flex-col" style={{ gap: '2px' }}>
      <span
        style={{
          fontSize: 'var(--ck-text-xs)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--ck-track-overline)',
          color: 'var(--ck-text-secondary)',
        }}
      >
        {rotulo}
      </span>
      <span
        className="truncate"
        style={{
          fontFamily: 'var(--ck-font-mono)',
          fontSize: 'var(--ck-text-sm)',
          color: 'var(--ck-text-primary)',
        }}
        title={valor}
      >
        {valor}
      </span>
    </div>
  );
}

function Painel({ agente, fecharHref }: { agente: Agent; fecharHref: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex shrink-0 items-center justify-between border-b"
        style={{
          gap: 'var(--ck-space-2)',
          padding: 'var(--ck-space-3) var(--ck-space-4)',
          borderColor: 'var(--ck-edge-hairline)',
        }}
      >
        <span
          style={{
            fontSize: 'var(--ck-text-xs)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--ck-track-overline)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          Detalhes
        </span>
        {/* Fechar é navegar. O `xl:hidden` que estava aqui vinha de um plano em
            que a gaveta virava coluna fixa nas telas grandes; ela nunca virou —
            é overlay em qualquer largura —, então o botão sumia em `xl` e
            sobrava o véu como única saída. */}
        <Link
          href={fecharHref}
          aria-label="Fechar detalhes"
          className="ck-veil flex items-center justify-center"
          style={{
            minWidth: 'var(--ck-touch-min)',
            minHeight: 'var(--ck-touch-min)',
            marginRight: 'calc(var(--ck-space-3) * -1)',
            borderRadius: 'var(--ck-radius-chip)',
            fontSize: 'var(--ck-text-lg)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          ×
        </Link>
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        style={{ gap: 'var(--ck-space-4)', padding: 'var(--ck-space-4)' }}
      >
        <Campo rotulo="Papel" valor={agente.role} />
        <Campo rotulo="Modelo" valor={agente.state_model ?? agente.model_default} />
        <Campo rotulo="Executor" valor={agente.state_cli ?? agente.cli_default} />
        <Campo rotulo="Sessão tmux" valor={agente.tmux_session} />
        <Campo rotulo="Workspace" valor={agente.workspace_path} />
        <Campo
          rotulo="Contexto"
          valor={agente.context_pct != null ? `${agente.context_pct}% · teto 30%` : null}
        />
      </div>
    </div>
  );
}

// Rota, não estado: é isto que faz deep-link do Telegram, refresh e botão voltar
// do Android funcionarem. Em Next 16 `params` e `searchParams` são Promise.
export default async function AgentePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const fleet = await fetchFleet();
  const agora = Math.floor(Date.now() / 1000);
  const agente = fleet.agents.find((a) => a.slug === slug);

  if (!agente) notFound();

  const painelAberto = typeof sp.painel === 'string' && sp.painel.length > 0;
  const navAberta = sp.nav === 'aberto';
  const fecharHref = `/agente/${slug}`;
  const estado = estadoDe(agente.status);
  const motor = leMotor({ modeloSessao: agente.state_model, modeloPadrao: agente.model_default });

  return (
    <AppShell
      nav={<Tropa agents={fleet.agents} slugSelecionado={slug} agora={agora} compacta />}
      navAberta={navAberta}
      fecharNavHref={fecharHref}
      drawer={<Painel agente={agente} fecharHref={fecharHref} />}
      painelAberto={painelAberto}
      fecharPainelHref={fecharHref}
      rotuloPainel="detalhes do agente"
    >
      {/* Chrome do topo — nav overlay à esquerda, pill de telas centralizado,
          painel à direita. §12.3/§13: dois controles na mesma faixa. */}
      <BarraDeTelas
        telas={[{ rotulo: 'Chat', ativa: true }]}
        abrirNavHref={navAberta ? fecharHref : `${fecharHref}?nav=aberto`}
        navAberta={navAberta}
        abrirPainelHref={painelAberto ? fecharHref : `${fecharHref}?painel=detalhes`}
        painelAberto={painelAberto}
      />

      {/* Identidade do agente — abaixo do chrome, não mais dono do botão de
          voltar nem do "⋯": os dois viraram os ícones da BarraDeTelas.
          Sem cor própria: é o topo da folha, e a folha é uma superfície só. */}
      <header
        className="flex shrink-0 items-center border-b"
        style={{
          gap: 'var(--ck-space-2)',
          borderColor: 'var(--ck-edge-hairline)',
          padding: 'var(--ck-space-2) var(--ck-space-3)',
        }}
      >
        <Retrato slug={agente.slug} nome={agente.name} tamanho={32} />

        <span className="flex min-w-0 flex-1 flex-col" style={{ gap: '1px' }}>
          <span
            className="truncate"
            style={{
              fontSize: 'var(--ck-text-lg)',
              lineHeight: '1.2',
              letterSpacing: 'var(--ck-track-title)',
              color: 'var(--ck-text-primary)',
            }}
          >
            {agente.name}
          </span>
          <span
            className="truncate"
            style={{ fontSize: 'var(--ck-text-xs)', color: estado.cor }}
          >
            {/* Só a palavra do estado. `lifecycle_detail` estava vazando cru aqui
                — "trabalhando · tool_use" — que é o mesmo jargão de máquina que
                saiu da TROPA. O detalhe técnico vive no painel `?painel=detalhes`,
                que é onde quem quer o detalhe vai buscar. */}
            {estado.rotulo}
          </span>
        </span>
      </header>

      {/* Coluna de leitura por container query: a coluna não sabe o tamanho da
          tela, só o do espaço que recebeu. As medidas do ChatGPT são de desktop —
          no celular a escada desce sozinha. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ containerType: 'inline-size', background: 'var(--ck-surface-canvas)' }}
      >
        <div
          className="mx-auto flex flex-col"
          style={{
            maxWidth: 'var(--ck-read-wide)',
            gap: 'var(--ck-space-4)',
            padding: 'var(--ck-space-5) var(--ck-space-4)',
          }}
        >
          {agente.last_assistant_message ? (
            <p style={{ color: 'var(--ck-text-primary)', whiteSpace: 'pre-wrap' }}>
              {agente.last_assistant_message}
            </p>
          ) : null}

          {agente.pane_excerpt ? (
            // Bloco elevado com fio de luz: é a voz da máquina, e é onde a tese
            // do contrato aparece — log de execução, não bolha de chat.
            <pre
              className="ck-lit"
              style={{
                // O pane é de 80 colunas e a tela tem 390px: com rolagem
                // horizontal o FIM de cada linha some, e num log o fim da linha é
                // justamente onde está o resultado. Quebra em vez de cortar.
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                margin: 0,
                padding: 'var(--ck-space-3)',
                background: 'var(--ck-surface-raised)',
                borderRadius: 'var(--ck-radius-frame)',
                fontFamily: 'var(--ck-font-mono)',
                fontSize: 'var(--ck-text-sm)',
                lineHeight: 'var(--ck-leading-body)',
                color: 'var(--ck-text-primary)',
              }}
            >
              {lePane(agente.pane_excerpt).map((trecho, i) =>
                trecho.tipo === 'link' ? (
                  <a
                    key={i}
                    href={trecho.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ck-link"
                  >
                    {trecho.texto}
                  </a>
                ) : (
                  <span key={i}>{trecho.texto}</span>
                ),
              )}
            </pre>
          ) : null}

          {!agente.last_assistant_message && !agente.pane_excerpt ? (
            // Estado vazio de verdade: uma frase, sem ilustração — ilustração
            // genérica é a assinatura do mequetrefe.
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
          ) : null}
        </div>
      </div>

      <div
        className="shrink-0"
        style={{
          background: 'var(--ck-surface-canvas)',
          padding: 'var(--ck-space-3) var(--ck-space-4)',
          paddingBottom: 'calc(var(--ck-space-3) + var(--ck-safe-bottom))',
        }}
      >
        {/* Sem `esforcoValor`/`esforcoPermitido`/`onEnviar`: o Composer busca o
            painel e envia sozinho — ver o cabeçalho do próprio componente. */}
        <Composer agentSlug={agente.slug} agentName={agente.name} motor={motor} />
      </div>
    </AppShell>
  );
}
