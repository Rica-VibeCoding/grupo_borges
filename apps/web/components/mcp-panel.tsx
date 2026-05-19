'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAgentMcp,
  patchAgentMcp,
  postAgentMcpReload,
  type McpServer,
  type McpServerKind,
} from '../lib/api';
import {
  matchesStatus,
  matchesTab,
  type McpStatusFilter,
  type McpTabKey,
} from '../lib/mcp-filter';
import { useToast } from '../lib/toast-context';

/**
 * Painel inline /mcp — redesign 3 tabs por TIPO de recurso.
 *
 * Tabs primárias: Skills · MCPs · Subagentes (filtro por `provides` do backend,
 * com fallback pelo kind legacy pra MCPs). Filtro secundário Todos / Ativos /
 * Desativados como pill no topo do corpo. Hooks/LSP ficam fora das 3 tabs
 * principais por enquanto (skip).
 *
 * Toggle otimista (UI muda na hora, rollback em erro), debounce 200ms pra
 * absorver múltiplos cliques no mesmo server. Footer aparece quando há mudança
 * que exige reload e dispara `/reload-plugins` direto no tmux do agente.
 *
 * Subagentes user-level (kind=agent_user) tem toggle desabilitado — tooltip
 * instrui mover o .md em ~/.claude/agents/ pra desabilitar (PATCH retorna 422).
 *
 * Fecha via Esc, clique no botão "✕" ou clique fora.
 */

const RELOAD_DEBOUNCE_MS = 200;

type ServerKey = string;
const keyOf = (s: { kind: McpServerKind; id: string }): ServerKey => `${s.kind}::${s.id}`;
const kindLabel = (kind: McpServerKind): string => {
  switch (kind) {
    case 'plugin':
      return 'plugin';
    case 'mcp_json':
      return 'mcp.json';
    case 'remote':
      return 'remote';
    case 'user_scope':
      return 'user';
    case 'agent_user':
      return 'user';
  }
};

const TABS: ReadonlyArray<{ key: McpTabKey; label: string }> = [
  { key: 'skills', label: 'Skills' },
  { key: 'mcps', label: 'MCPs' },
  { key: 'subagents', label: 'Subagentes' },
];

const STATUS_FILTERS: ReadonlyArray<{ key: McpStatusFilter; label: string }> = [
  { key: 'all', label: 'Todos' },
  { key: 'enabled', label: 'Ativos' },
  { key: 'disabled', label: 'Desativados' },
];

export function McpPanel({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { fire } = useToast();
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [requiresReload, setRequiresReload] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [tab, setTab] = useState<McpTabKey>('skills');
  const [status, setStatus] = useState<McpStatusFilter>('all');
  const panelRef = useRef<HTMLDivElement>(null);

  const pendingTimers = useRef<Map<ServerKey, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const ctrl = new AbortController();
    getAgentMcp(slug, ctrl.signal)
      .then((res) => setServers(res.servers))
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => ctrl.abort();
  }, [slug]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Cleanup de timers pendentes ao desmontar.
  useEffect(() => {
    const timers = pendingTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const dispatchPatch = useCallback(
    (server: McpServer, nextEnabled: boolean) => {
      const key = keyOf(server);
      const prev = pendingTimers.current.get(key);
      if (prev) clearTimeout(prev);
      const timer = setTimeout(() => {
        pendingTimers.current.delete(key);
        patchAgentMcp(slug, server.kind, server.id, nextEnabled)
          .then((res) => {
            if (res.requires_reload) setRequiresReload(true);
          })
          .catch((err) => {
            // rollback otimista
            setServers((prevList) =>
              prevList === null
                ? prevList
                : prevList.map((s) =>
                    keyOf(s) === key ? { ...s, enabled: !nextEnabled } : s,
                  ),
            );
            fire({
              kind: 'warn',
              msg: `falha ao ${nextEnabled ? 'ativar' : 'desativar'} ${server.name}`,
              sub: err instanceof Error ? err.message : String(err),
              ttlMs: 4500,
            });
          });
      }, RELOAD_DEBOUNCE_MS);
      pendingTimers.current.set(key, timer);
    },
    [slug, fire],
  );

  const onToggle = useCallback(
    (server: McpServer) => {
      // Subagentes user-level (kind=agent_user) não aceitam PATCH (422 no backend).
      if (server.kind === 'agent_user') return;
      const next = !server.enabled;
      setServers((prev) =>
        prev === null
          ? prev
          : prev.map((s) => (keyOf(s) === keyOf(server) ? { ...s, enabled: next } : s)),
      );
      dispatchPatch(server, next);
    },
    [dispatchPatch],
  );

  const onReload = useCallback(async () => {
    if (reloading) return;
    setReloading(true);
    try {
      const res = await postAgentMcpReload(slug);
      if (res.tmux_delivered) {
        fire({ kind: 'success', msg: '/reload-plugins enviado', ttlMs: 2200 });
        setRequiresReload(false);
      } else {
        fire({
          kind: 'warn',
          msg: 'reload não entregue',
          sub: 'pane fora do CLI esperado',
          ttlMs: 5000,
        });
      }
    } catch (err) {
      fire({
        kind: 'warn',
        msg: 'falha no /reload-plugins',
        sub: err instanceof Error ? err.message : String(err),
        ttlMs: 5000,
      });
    } finally {
      setReloading(false);
    }
  }, [slug, fire, reloading]);

  // Click outside.
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const node = panelRef.current;
      if (!node) return;
      if (node.contains(e.target as Node)) return;
      onClose();
    };
    // Usar mousedown pra não disparar no próprio click do botão que abriu.
    const id = window.setTimeout(() => {
      window.addEventListener('mousedown', onDocDown);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('mousedown', onDocDown);
    };
  }, [onClose]);

  // Contagem por tab é independente do status filter (mostra total real do tipo).
  const tabCounts = useMemo(() => {
    const empty: Record<McpTabKey, number> = { skills: 0, mcps: 0, subagents: 0 };
    if (!servers) return empty;
    for (const s of servers) {
      for (const t of TABS) {
        if (matchesTab(s, t.key)) empty[t.key] += 1;
      }
    }
    return empty;
  }, [servers]);

  const visibleServers = useMemo(() => {
    if (!servers) return [];
    return servers.filter((s) => matchesTab(s, tab) && matchesStatus(s, status));
  }, [servers, tab, status]);

  // Há plugin multi-tipo no inventário inteiro? (não restringido por tab atual).
  const hasMultiTypePlugin = useMemo(
    () => Boolean(servers?.some((s) => (s.provides?.length ?? 0) > 1)),
    [servers],
  );

  return (
    <div className="mcp-panel-anchor" onMouseDown={(e) => e.stopPropagation()}>
      <div
        ref={panelRef}
        className="mcp-panel"
        role="dialog"
        aria-label="Recursos do agente (skills · MCPs · subagentes)"
      >
        <header className="mcp-panel-head">
          <span className="mcp-panel-title">
            <span className="mcp-panel-title-prefix mono">/mcp</span>
            <span className="mcp-panel-title-sep" aria-hidden="true">·</span>
            <span>Recursos do agente</span>
          </span>
          <button
            type="button"
            className="mcp-panel-close"
            aria-label="Fechar painel MCP"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        {loadError ? (
          <div className="mcp-panel-empty">
            falha ao carregar — <span className="mcp-panel-dim">{loadError}</span>
          </div>
        ) : servers === null ? (
          <div className="mcp-panel-empty mono">carregando…</div>
        ) : servers.length === 0 ? (
          <div className="mcp-panel-empty">nenhum recurso configurado</div>
        ) : (
          <>
            <div className="mcp-panel-tabs" role="tablist">
              {TABS.map((t) => (
                <McpTab
                  key={t.key}
                  label={t.label}
                  count={tabCounts[t.key]}
                  active={tab === t.key}
                  onSelect={() => setTab(t.key)}
                />
              ))}
            </div>

            <div className="mcp-panel-subbar">
              <div className="mcp-status-pills" role="tablist" aria-label="Filtro de status">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={status === f.key}
                    className="mcp-status-pill"
                    data-active={status === f.key ? '1' : '0'}
                    onClick={() => setStatus(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {hasMultiTypePlugin && (
                <small className="mcp-panel-note">
                  Plugin pode expor múltiplos tipos — desligar afeta todos os recursos do plugin.
                </small>
              )}
            </div>

            <div className="mcp-panel-body">
              {visibleServers.length === 0 ? (
                <p className="mcp-panel-empty">
                  {status === 'enabled'
                    ? 'nenhum recurso ativo nessa categoria.'
                    : status === 'disabled'
                      ? 'nenhum recurso desativado nessa categoria.'
                      : 'nenhum recurso nessa categoria.'}
                </p>
              ) : (
                <ul className="mcp-group-list">
                  {visibleServers.map((s) => (
                    <McpRow key={keyOf(s)} server={s} onToggle={onToggle} />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {requiresReload && (
          <footer className="mcp-panel-foot">
            <span className="mcp-panel-foot-msg">
              Mudanças aplicadas; rode <code className="mono">/reload-plugins</code> pra entrar em vigor.
            </span>
            <button
              type="button"
              className="mcp-panel-foot-cta"
              onClick={() => void onReload()}
              disabled={reloading}
              aria-busy={reloading}
            >
              {reloading ? 'enviando…' : 'aplicar reload'}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function McpTab({
  label,
  count,
  active,
  onSelect,
}: {
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className="mcp-panel-tab"
      data-active={active ? '1' : '0'}
      onClick={onSelect}
    >
      <span className="mcp-panel-tab-label">{label}</span>
      <span className="mcp-panel-tab-count mono">{count}</span>
    </button>
  );
}

function McpRow({
  server,
  onToggle,
}: {
  server: McpServer;
  onToggle: (s: McpServer) => void;
}) {
  const transport = server.transport && server.transport !== 'unknown' ? server.transport : null;
  const providesList = server.provides ?? [];
  const isMulti = providesList.length > 1;
  const isUserSubagent = server.kind === 'agent_user';

  const tooltip = isUserSubagent
    ? 'Mova o arquivo .md em ~/.claude/agents/ pra desabilitar.'
    : (server.command_redacted ??
       server.description ??
       (transport ? `transport: ${transport}` : undefined));

  return (
    <li className="mcp-row" title={tooltip ?? undefined}>
      <button
        type="button"
        role="switch"
        aria-checked={server.enabled}
        aria-disabled={isUserSubagent}
        aria-label={
          isUserSubagent
            ? `${server.name} (gerenciado via ~/.claude/agents/)`
            : `${server.enabled ? 'Desativar' : 'Ativar'} ${server.name}`
        }
        className="mcp-toggle"
        data-on={server.enabled ? '1' : '0'}
        data-locked={isUserSubagent ? '1' : '0'}
        onClick={() => onToggle(server)}
        disabled={isUserSubagent}
      >
        <span className="mcp-toggle-thumb" aria-hidden="true" />
      </button>
      <div className="mcp-row-meta">
        <span className="mcp-row-name">
          {server.name}
          {isMulti && (
            <span
              className="mcp-provides-badge mono"
              title={`Plugin expõe: ${providesList.join(' · ')}`}
            >
              expõe: {providesList.join('+')}
            </span>
          )}
        </span>
        <span className="mcp-row-id mono" title={`${server.kind}:${server.id}`}>
          {kindLabel(server.kind)} · {server.id}
        </span>
      </div>
      {transport && <span className="mcp-row-transport mono">{transport}</span>}
    </li>
  );
}
