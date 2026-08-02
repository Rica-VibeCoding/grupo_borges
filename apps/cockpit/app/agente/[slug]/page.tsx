import { notFound } from 'next/navigation';
import { fetchFleet } from '@grupo_borges/cockpit-core/api';
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import { AppShell } from '@/components/shell/app-shell';
import { BarraDeTelas } from '@/components/shell/barra-de-telas';
import { BlocoDeAcoes } from '@/components/shell/bloco-de-acoes';
import { Composer } from '@/components/shell/composer';
import { leMotor } from '@/components/shell/motor';
import { Regua } from '@/components/shell/regua';
import { LinkFechaPainel } from '@/components/shell/superficie-otimista';
import { Tropa } from '@/components/shell/tropa';
import { FeedDaConversa } from './feed-da-conversa';

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

function Painel({
  agente,
  fecharHref,
  painelAberto,
}: {
  agente: Agent;
  fecharHref: string;
  /** Valor do servidor. O `BlocoDeAcoes` usa como fallback e prefere o
   *  otimista quando está dentro do `PainelProvider` — é o que faz a re-busca
   *  do `/painel` começar no frame do clique, não 2s depois. */
  painelAberto: boolean;
}) {
  return (
    // `flex-auto` (base no conteúdo), NÃO `flex-1` (base 0) — 02/08. O `flex-1`
    // do Tailwind é `flex: 1 1 0%`, e o pai (`.ck-flutua`) tem altura vinda do
    // CONTEÚDO. Item com base 0 contribui 0 pro tamanho intrínseco do pai no
    // WebKit, e a gaveta inteira nascia com 0px de altura no iPhone do Rica —
    // visível, no lugar certo, largura certa e altura nenhuma. Com base `auto` a
    // contribuição é o conteúdo de verdade, nos dois motores. O `min-h-0`
    // continua deixando o item encolher quando o `max-height` do pai morde, que
    // é o que faz a área de baixo rolar em vez de estourar.
    <div className="flex min-h-0 flex-auto flex-col">
      <div
        className="flex shrink-0 items-center justify-between border-b"
        style={{
          gap: 'var(--ck-space-2)',
          padding: 'var(--ck-space-3) var(--ck-space-4)',
          // `edge-light`, não `edge-hairline`: a referência de textura que o
          // Rica mandou tem o fio entre duas áreas escuras MAIS CLARO que as
          // duas (#323232 sobre #202020/#181818). O hairline (#424242) é mais
          // duro que isso; branco a 7% sobre esta superfície dá (49,49,49) —
          // o valor que ele mediu, e a assinatura da §A: luz, não sombra.
          borderColor: 'var(--ck-edge-light)',
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
        {/* Fechar é navegar — e desde 30/07 também é otimista: o
            `LinkFechaPainel` vira o painel no mesmo frame e a URL alcança
            atrás; sem JS é o Link de sempre. O `xl:hidden` que estava aqui
            vinha de um plano em que a gaveta virava coluna fixa nas telas
            grandes; ela nunca virou — é overlay em qualquer largura —, então
            o botão sumia em `xl` e sobrava o véu como única saída. */}
        <LinkFechaPainel
          href={fecharHref}
          rotulo="detalhes"
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
        </LinkFechaPainel>
      </div>

      {/* AS AÇÕES RÁPIDAS (§17) — no topo, e FORA da área que rola. O Rica as
          chama de "ideia central do painel", e desde que a gaveta passou a
          ancorar no topo e crescer pra baixo, ficar aqui significa ficar
          sempre à vista: cresça o conteúdo quanto crescer, quem rola são os
          campos de referência, não os controles. */}
      <BlocoDeAcoes agentSlug={agente.slug} aberto={painelAberto} />

      <div
        className="flex min-h-0 flex-auto flex-col overflow-y-auto"
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
  const motor = leMotor({ modeloSessao: agente.state_model, modeloPadrao: agente.model_default });

  return (
    <AppShell
      nav={<Tropa agents={fleet.agents} slugSelecionado={slug} agora={agora} compacta />}
      navAberta={navAberta}
      fecharNavHref={fecharHref}
      drawer={<Painel agente={agente} fecharHref={fecharHref} painelAberto={painelAberto} />}
      painelAberto={painelAberto}
      fecharPainelHref={fecharHref}
      rotuloPainel="detalhes do agente"
    >
      {/* Chrome do topo — nav overlay à esquerda, pill de telas centralizado,
          painel à direita. §12.3/§13: dois controles na mesma faixa. */}
      <BarraDeTelas
        telas={[{ rotulo: 'Chat', ativa: true }]}
        // Os dois destinos separados: o `BotaoNav` alterna pelo estado
        // otimista, não pelo que a URL já refletiu.
        abrirNavHref={`${fecharHref}?nav=aberto`}
        fecharNavHref={fecharHref}
        navAberta={navAberta}
        hrefAbrirPainel={`${fecharHref}?painel=detalhes`}
        hrefFecharPainel={fecharHref}
        painelAberto={painelAberto}
      />

      {/* Aqui morava o cabeçalho de identidade — retrato, nome e estado — e a
          linha que o separava do feed. Saiu por ordem do Rica (30/07): o agente
          já aparece selecionado e destacado na tropa à esquerda, e desde a MESA
          E A FOLHA (§14) a aba do item selecionado ENCOSTA nesta folha. Repetir
          o nome no topo do chat era dizer duas vezes, com a linha divisória
          cobrando altura de tela no celular para separar o feed de nada.

          Nenhum substituto entra agora, e isso é literal: *"se sentir falta de
          uma identidade dentro do chat eu aviso, mas não seria o que está"*.
          Inventar uma marca d'água ou um nome discreto aqui seria trocar o que
          ele mandou tirar por uma versão menor da mesma coisa. */}

      {/* O FEED DE VERDADE. Até 02/08 esta rota mostrava só o último recado do
          assistente + o pedaço cru do pane, e o `<FeedDaConversa>` vivia numa
          rota `/preview` paralela pra não arriscar a tela que o Rica olha ao
          vivo. Ele mandou sair da versão de teste no mesmo dia: a preview
          morreu e o feed é o corpo desta rota. `last_assistant_message`,
          `pane_excerpt` e o estado vazio saíram junto — quem cuida dos três
          agora é o próprio feed, que lê o stream inteiro em vez do retrato.

          Coluna de leitura por container query: a coluna não sabe o tamanho da
          tela, só o do espaço que recebeu. As medidas do ChatGPT são de desktop —
          no celular a escada desce sozinha. */}
      <div
        className="min-h-0 flex-1"
        style={{
          containerType: 'inline-size',
          background: 'var(--ck-surface-canvas)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          className="mx-auto flex min-h-0 w-full flex-1 flex-col"
          style={{ maxWidth: 'var(--ck-read-wide)' }}
        >
          <FeedDaConversa agentSlug={agente.slug} />
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

      {/* Régua de medição — só com `?diag=1` na URL. Ver o cabeçalho de
          `app/api/regua/route.ts`: existe porque o Safari do iPhone é o único
          motor que eu não consigo rodar aqui. */}
      {sp.diag === '1' ? <Regua /> : null}
    </AppShell>
  );
}
