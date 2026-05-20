'use client';

import { useEffect, useRef, useState } from 'react';
import type { Agent, AgentPainelResponse } from '../lib/cockpit-types';
import { fetchAgentPainel } from '../lib/api';
import { ContextoBloco } from './contexto-bloco';
import { EffortBloco } from './effort-bloco';
import { QuotasBloco } from './quotas-bloco';
import { SubagentsBloco } from './subagents-bloco';

type PainelPanelProps = {
  slug: string;
  agent: Agent;
};

export function PainelPanel({ slug, agent: _agent }: PainelPanelProps) {
  const [data, setData] = useState<AgentPainelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const hasDataRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    let controller: AbortController | null = null;
    hasDataRef.current = false;
    setData(null);
    setError(null);
    setLoading(true);

    async function load() {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      if (!hasDataRef.current) setLoading(true);
      try {
        const next = await fetchAgentPainel(slug, signal);
        if (!mounted || signal.aborted) return;
        setData(next);
        hasDataRef.current = true;
        setError(null);
        setLastUpdated(Date.now());
      } catch (err) {
        if (!mounted || signal.aborted) return;
        setError(err instanceof Error ? err.message : 'erro ao carregar painel');
      } finally {
        if (mounted && !signal.aborted) setLoading(false);
      }
    }

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 5000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
      controller?.abort();
    };
  }, [slug]);

  if (loading && !data) {
    return (
      <div className="painel-panel" aria-busy="true">
        <div>carregando painel...</div>
      </div>
    );
  }

  return (
    <div className="painel-panel">
      {error && <div role="alert">erro: {error}</div>}
      {data && (
        <>
          <ContextoBloco contexto={data.contexto} />
          <EffortBloco effort={data.effort} />
          <QuotasBloco quotas={data.quotas} />
          <SubagentsBloco subagents={data.subagents} />
          {lastUpdated !== null && <span hidden>{lastUpdated}</span>}
        </>
      )}
    </div>
  );
}
