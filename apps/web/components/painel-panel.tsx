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
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [now, setNow] = useState(Date.now());
  const hasDataRef = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

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
  }, [slug, refreshNonce]);

  function handleEffortChange(_value: string) {
    setRefreshNonce((value) => value + 1);
  }

  const updatedAgo =
    lastUpdated === null ? null : `${Math.max(0, Math.floor((now - lastUpdated) / 1000))}s`;

  if (loading && !data) {
    return (
      <div className="painel-panel" aria-busy="true">
        <div className="painel-empty">carregando painel...</div>
      </div>
    );
  }

  return (
    <div className="painel-panel">
      <div className="painel-panel-head">
        <span>PAINEL</span>
        {updatedAgo && <span>atualizado há {updatedAgo}</span>}
      </div>
      {error && (
        <div className="painel-panel-error" role="alert">
          erro: {error}
        </div>
      )}
      {data && (
        <>
          <ContextoBloco data={data.contexto} />
          <EffortBloco data={data.effort} slug={slug} onChange={handleEffortChange} />
          <QuotasBloco data={data.quotas} />
          <SubagentsBloco data={data.subagents} />
        </>
      )}
    </div>
  );
}
