'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent, AgentPainelResponse } from '../lib/cockpit-types';
import { fetchAgentPainel } from '../lib/api';
import { ContextoBloco } from './contexto-bloco';
import { EffortBloco } from './effort-bloco';
import { PermissionBloco } from './permission-bloco';
import { SandboxBloco } from './sandbox-bloco';
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
  const activeControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const loadPainel = useCallback(
    async (showLoading: boolean) => {
      activeControllerRef.current?.abort();
      const controller = new AbortController();
      activeControllerRef.current = controller;
      const signal = controller.signal;
      if (showLoading) setLoading(true);
      try {
        const next = await fetchAgentPainel(slug, signal);
        if (signal.aborted) return;
        setData(next);
        setError(null);
        setLastUpdated(Date.now());
      } catch (err) {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : 'erro ao carregar painel');
      } finally {
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
          if (!signal.aborted) setLoading(false);
        }
      }
    },
    [slug],
  );

  useEffect(() => {
    setData(null);
    setError(null);
    void loadPainel(true);

    return () => {
      activeControllerRef.current?.abort();
    };
  }, [loadPainel, refreshNonce]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadPainel(false);
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadPainel]);

  function handleEffortChange(_value: string) {
    setRefreshNonce((value) => value + 1);
  }

  function handlePermissionChange() {
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
      {data && data.codex_native && data.sandbox ? (
        // Painel Codex-nativo (Tara): effort 3 níveis + sandbox no lugar de
        // bypass/plan; Quotas e Subagents não têm equivalente e ficam ocultos.
        <>
          <ContextoBloco data={data.contexto} />
          <EffortBloco data={data.effort} slug={slug} onChange={handleEffortChange} />
          <SandboxBloco data={data.sandbox} slug={slug} onChange={handlePermissionChange} />
        </>
      ) : (
        data && (
          <>
            <ContextoBloco data={data.contexto} />
            <EffortBloco data={data.effort} slug={slug} onChange={handleEffortChange} />
            <PermissionBloco data={data.permission} slug={slug} onChange={handlePermissionChange} />
            <QuotasBloco data={data.quotas} />
            <SubagentsBloco data={data.subagents} />
          </>
        )
      )}
    </div>
  );
}
