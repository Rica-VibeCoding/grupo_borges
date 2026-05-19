'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAgentMcp,
  patchAgentMcp,
  postAgentMcpReload,
  type McpServer,
  type McpServerKind,
} from '../lib/api';
import { useToast } from '../lib/toast-context';

/**
 * JP-25 — painel inline /mcp.
 *
 * Substitui o modal bloqueante do CC nativo: o user digita `/mcp` no input,
 * o ChatInput intercepta e abre este painel acima do dock. Lista servers
 * agrupados por kind (plugin + mcp_json), toggle otimista (UI muda na hora,
 * rollback em erro), debounce 200ms pra absorver múltiplos cliques sequenciais
 * no mesmo server. Footer aparece quando há mudança que exige reload e
 * permite disparar `/reload-plugins` direto no tmux do agente.
 *
 * Fecha via Esc, clique no botão "✕" ou clique fora.
 */

const RELOAD_DEBOUNCE_MS = 200;

type ServerKey = string;
const keyOf = (s: { kind: McpServerKind; id: string }): ServerKey => `${s.kind}::${s.id}`;

export function McpPanel({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { fire } = useToast();
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [requiresReload, setRequiresReload] = useState(false);
  const [reloading, setReloading] = useState(false);
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

  const grouped = useMemo(() => {
    if (!servers) return { plugin: [] as McpServer[], mcp_json: [] as McpServer[] };
    return {
      plugin: servers.filter((s) => s.kind === 'plugin'),
      mcp_json: servers.filter((s) => s.kind === 'mcp_json'),
    };
  }, [servers]);

  return (
    <div className="mcp-panel-anchor" onMouseDown={(e) => e.stopPropagation()}>
      <div
        ref={panelRef}
        className="mcp-panel"
        role="dialog"
        aria-label="Servers MCP do agente"
      >
        <header className="mcp-panel-head">
          <span className="mcp-panel-title">
            <span className="mcp-panel-title-prefix mono">/mcp</span>
            <span className="mcp-panel-title-sep" aria-hidden="true">·</span>
            <span>Servers do agente</span>
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
          <div className="mcp-panel-empty">nenhum server MCP configurado</div>
        ) : (
          <div className="mcp-panel-body">
            <McpGroup
              label="Plugins"
              items={grouped.plugin}
              onToggle={onToggle}
              emptyHint="sem plugins MCP ativos"
            />
            <McpGroup
              label="Project ( .mcp.json )"
              items={grouped.mcp_json}
              onToggle={onToggle}
              emptyHint="sem .mcp.json no workspace"
            />
          </div>
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

function McpGroup({
  label,
  items,
  onToggle,
  emptyHint,
}: {
  label: string;
  items: McpServer[];
  onToggle: (s: McpServer) => void;
  emptyHint: string;
}) {
  return (
    <section className="mcp-group">
      <h3 className="mcp-group-label">{label}</h3>
      {items.length === 0 ? (
        <p className="mcp-group-empty">{emptyHint}</p>
      ) : (
        <ul className="mcp-group-list">
          {items.map((s) => (
            <McpRow key={keyOf(s)} server={s} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </section>
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
  const tooltip =
    server.command_redacted ??
    server.description ??
    (transport ? `transport: ${transport}` : undefined);
  return (
    <li className="mcp-row" title={tooltip ?? undefined}>
      <button
        type="button"
        role="switch"
        aria-checked={server.enabled}
        aria-label={`${server.enabled ? 'Desativar' : 'Ativar'} ${server.name}`}
        className="mcp-toggle"
        data-on={server.enabled ? '1' : '0'}
        onClick={() => onToggle(server)}
      >
        <span className="mcp-toggle-thumb" aria-hidden="true" />
      </button>
      <div className="mcp-row-meta">
        <span className="mcp-row-name">{server.name}</span>
        <span className="mcp-row-id mono" title={`${server.kind}:${server.id}`}>
          {server.kind === 'plugin' ? 'plugin' : 'mcp.json'} · {server.id}
        </span>
      </div>
      {transport && <span className="mcp-row-transport mono">{transport}</span>}
    </li>
  );
}
