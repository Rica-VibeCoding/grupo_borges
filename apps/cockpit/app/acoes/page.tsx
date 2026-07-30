'use client';

/**
 * Vitrine das ações rápidas — rota de trabalho, não de produto.
 *
 * Mesma razão da `/envio` e da `/voz`: o bloco só entra no painel de verdade
 * depois que o Hiro fechar o commit dele no `app-shell.tsx`, e até lá não há
 * onde ver os controles. Aqui eles aparecem com o back INJETADO — dá para
 * exercitar sem servidor, e principalmente dá para ver os três casos que não
 * se produzem sob demanda num agente real: o back recusando a troca, o
 * `/painel` fora do ar, e o destrava respondendo 200 com `tmux_delivered:
 * false`.
 *
 * O que esta página prova, e é o ponto inteiro:
 *
 * - **Claude Code e Codex mostram controles DIFERENTES.** Sandbox não existe
 *   no CC (400 `not_a_codex_agent`) e permissão não governa a Tara.
 * - **Falha volta o valor.** Toque em qualquer segmento da terceira seção: ele
 *   acende, a rede recusa, ele volta sozinho e o aviso diz a saída.
 * - **Reabrir re-busca.** É o que impede o painel de mostrar um esforço velho
 *   quando o composer já trocou — use o botão de abrir/fechar da última seção
 *   e olhe o contador de leituras.
 */
import { useState } from 'react';
import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import { BlocoDeAcoes, type TransporteDeAcoes } from '@/components/shell/bloco-de-acoes';

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function painelBase(patch: Partial<AgentPainelResponse> = {}): AgentPainelResponse {
  return {
    slug: 'daniel',
    generated_at: 0,
    contexto: {
      model: null,
      model_family: null,
      context_window: null,
      tokens: { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0 },
      pct: null,
      source: 'vitrine',
      updated_at: null,
      available: false,
      stale: false,
    },
    effort: {
      value: 'xhigh',
      allowed: ['low', 'medium', 'high', 'xhigh', 'max'],
      source: 'vitrine',
      session_may_diverge: false,
    },
    permission: { mode: 'ask', source: 'vitrine', session_may_diverge: false },
    quotas: { status: 'unknown', stale_after_seconds: 0 },
    subagents: { count: 0, active_count: 0, items: [] },
    ...patch,
  };
}

const PAINEL_CODEX = painelBase({
  slug: 'tara',
  codex_native: true,
  effort: {
    value: 'high',
    allowed: ['low', 'medium', 'high', 'xhigh'],
    source: 'vitrine',
    session_may_diverge: true,
  },
  sandbox: {
    value: 'danger-full-access',
    allowed: ['read-only', 'workspace-write', 'danger-full-access'],
    source: 'vitrine',
    session_may_diverge: true,
  },
});

/** O caminho feliz, com meio segundo de rede para o estado "em voo" existir na
 *  tela — num back local ele dura menos que um frame e ninguém o vê. */
function transporteFeliz(painel: AgentPainelResponse, aoLer?: () => void): TransporteDeAcoes {
  return {
    lePainel: async () => {
      aoLer?.();
      await espera(220);
      return painel;
    },
    gravaEsforco: async () => espera(500),
    gravaPermissao: async () => espera(500),
    gravaSandbox: async () => espera(500),
    destrava: async () => {
      await espera(400);
      return { tmux_delivered: true };
    },
  };
}

const TRANSPORTE_RECUSA: TransporteDeAcoes = {
  lePainel: async () => {
    await espera(220);
    return painelBase();
  },
  gravaEsforco: async () => {
    await espera(450);
    throw new Error('patchAgentEffort failed: 422: kimi_effort_not_allowed');
  },
  gravaPermissao: async () => {
    await espera(450);
    throw new Error('patchAgentPermissionMode failed: 500');
  },
  gravaSandbox: async () => {
    throw new Error('400: not_a_codex_agent');
  },
  destrava: async () => {
    await espera(300);
    // O 200 mentiroso: a rota respondeu, a tecla não chegou a lugar nenhum.
    return { tmux_delivered: false };
  },
};

const TRANSPORTE_MORTO: TransporteDeAcoes = {
  lePainel: async () => {
    await espera(220);
    throw new Error('fetchAgentPainel failed: 503');
  },
  gravaEsforco: async () => undefined,
  gravaPermissao: async () => undefined,
  gravaSandbox: async () => undefined,
  destrava: async () => ({ tmux_delivered: true }),
};

function Secao({
  titulo,
  nota,
  children,
}: {
  titulo: string;
  nota: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col" style={{ gap: 'var(--ck-space-3)' }}>
      <div className="flex flex-col" style={{ gap: 'var(--ck-space-1)' }}>
        <h2
          style={{
            fontSize: 'var(--ck-text-lg)',
            letterSpacing: 'var(--ck-track-title)',
            color: 'var(--ck-text-primary)',
          }}
        >
          {titulo}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 'var(--ck-text-sm)',
            lineHeight: 'var(--ck-leading-body)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          {nota}
        </p>
      </div>

      {/* A largura e a superfície do painel de verdade: 380px em `nav`, com o
          raio e o fio de luz do `.ck-flutua`. Sem isto a vitrine mostraria os
          controles numa largura que eles nunca terão. */}
      <div
        className="ck-lit overflow-hidden"
        style={{
          width: '100%',
          maxWidth: 'var(--ck-w-drawer)',
          borderRadius: 'var(--ck-radius-caixa)',
          background: 'var(--ck-surface-nav)',
        }}
      >
        {children}
      </div>
    </section>
  );
}

export default function VitrineDeAcoes() {
  const [leituras, setLeituras] = useState(0);
  const [aberto, setAberto] = useState(true);

  return (
    <main
      className="min-h-dvh"
      style={{ background: 'var(--ck-surface-canvas)', padding: 'var(--ck-space-5)' }}
    >
      <div
        className="mx-auto flex flex-col"
        style={{ maxWidth: 'var(--ck-read-wide)', gap: 'var(--ck-space-6)' }}
      >
        <header className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
          <h1
            style={{
              fontSize: 'var(--ck-text-hero)',
              lineHeight: 'var(--ck-leading-hero)',
              letterSpacing: 'var(--ck-track-hero)',
              color: 'var(--ck-text-primary)',
            }}
          >
            Ações rápidas
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 'var(--ck-text-sm)',
              lineHeight: 'var(--ck-leading-body)',
              color: 'var(--ck-text-secondary)',
            }}
          >
            A metade que faltava do §17. Back injetado — nada aqui toca agente de verdade.
          </p>
        </header>

        <Secao
          titulo="Claude Code"
          nota="Esforço nos cinco níveis e permissão nos três modos. Sem sandbox: o endpoint responde 400 fora do Codex."
        >
          <BlocoDeAcoes agentSlug="daniel" aberto transporte={transporteFeliz(painelBase())} />
        </Secao>

        <Secao
          titulo="Codex — a Tara"
          nota="Sandbox no lugar da permissão, e a escala de esforço é a do Codex. Os dois valores vêm de arquivo (session_may_diverge) — a ressalva não aparece mais na tela, por ordem do Rica (30/07): só no aria-label do grupo."
        >
          <BlocoDeAcoes agentSlug="tara" aberto transporte={transporteFeliz(PAINEL_CODEX)} />
        </Secao>

        <Secao
          titulo="O back recusa"
          nota="Toque em qualquer segmento: ele acende na hora, a rede recusa, o valor volta sozinho e o aviso traz a saída. O botão de destravar responde 200 com tmux_delivered false — recibo nenhum, aviso no lugar."
        >
          <BlocoDeAcoes agentSlug="daniel" aberto transporte={TRANSPORTE_RECUSA} />
        </Secao>

        <Secao
          titulo="Painel fora do ar"
          nota="Controle não nasce fingido — mas também não some calado, senão parece que o agente não tem controle nenhum."
        >
          <BlocoDeAcoes agentSlug="daniel" aberto transporte={TRANSPORTE_MORTO} />
        </Secao>

        <Secao
          titulo="Reabrir re-busca"
          nota={`É o que impede o painel de mostrar esforço velho depois de o composer trocar. Leituras do /painel até agora: ${leituras}.`}
        >
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => setAberto((v) => !v)}
              className="ck-veil flex items-center justify-center border-b"
              style={{
                minHeight: 'var(--ck-touch-min)',
                borderColor: 'var(--ck-edge-light)',
                fontSize: 'var(--ck-text-sm)',
                color: 'var(--ck-text-primary)',
              }}
            >
              {aberto ? 'Fechar o painel' : 'Abrir o painel'}
            </button>
            <BlocoDeAcoes
              agentSlug="daniel"
              aberto={aberto}
              transporte={transporteFeliz(painelBase(), () => setLeituras((n) => n + 1))}
            />
          </div>
        </Secao>
      </div>
    </main>
  );
}
