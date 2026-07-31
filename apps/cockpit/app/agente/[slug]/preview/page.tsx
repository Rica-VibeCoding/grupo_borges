import { notFound } from 'next/navigation';
import { fetchFleet } from '@grupo_borges/cockpit-core/api';
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import { AppShell } from '@/components/shell/app-shell';
import { BarraDeTelas } from '@/components/shell/barra-de-telas';
import { BlocoDeAcoes } from '@/components/shell/bloco-de-acoes';
import { Composer } from '@/components/shell/composer';
import { leMotor } from '@/components/shell/motor';
import { LinkFechaPainel } from '@/components/shell/painel-otimista';
import { Tropa } from '@/components/shell/tropa';
import { FeedDaConversa } from '../feed-da-conversa';

export const dynamic = 'force-dynamic';

// PREVIEW — não é rota de produto. Cópia de ../page.tsx pra validar o Feed
// real (components/feed/**) plugado na rota, sem arriscar a tela que o Rica
// olha ao vivo enquanto o Pavan não aprovar o print antes/depois. `Campo` e
// `Painel` estão duplicados de propósito: extrair pra módulo compartilhado
// só valeria a pena se este arquivo sobrevivesse — ele morre assim que a
// troca for aprovada e dobrada em ../page.tsx (ver relato do Daniel, 30/07).
//
// ÚNICA diferença de verdade contra ../page.tsx: o bloco de mensagens no
// corpo troca `last_assistant_message` + `pane_excerpt` cru por
// `<FeedDaConversa>`. Todo o resto — chrome, painel, composer — é idêntico
// byte a byte, pra o antes/depois comparar só a variável que mudou.

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
  painelAberto: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex shrink-0 items-center justify-between border-b"
        style={{
          gap: 'var(--ck-space-2)',
          padding: 'var(--ck-space-3) var(--ck-space-4)',
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

      <BlocoDeAcoes agentSlug={agente.slug} aberto={painelAberto} />

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

export default async function AgentePreviewPage({
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
  const fecharHref = `/agente/${slug}/preview`;
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
      <BarraDeTelas
        telas={[{ rotulo: 'Chat · preview', ativa: true }]}
        abrirNavHref={navAberta ? fecharHref : `${fecharHref}?nav=aberto`}
        navAberta={navAberta}
        hrefAbrirPainel={`${fecharHref}?painel=detalhes`}
        hrefFecharPainel={fecharHref}
        painelAberto={painelAberto}
      />

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
        <Composer agentSlug={agente.slug} agentName={agente.name} motor={motor} />
      </div>
    </AppShell>
  );
}
