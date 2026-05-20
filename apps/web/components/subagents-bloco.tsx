import type { PainelSubagentEntry, PainelSubagents } from '../lib/cockpit-types';

type SubagentsBlocoProps = {
  data: PainelSubagents;
};

function formatAgo(timestamp: number | null | undefined): string {
  if (!timestamp) return 'início desconhecido';
  const startedMs = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  const delta = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
  const m = Math.floor(delta / 60);
  const s = delta % 60;
  if (m > 0) return `há ${m}m ${s}s`;
  return `há ${s}s`;
}

export function SubagentsBloco({ data }: SubagentsBlocoProps) {
  const items = Array.isArray(data.items) ? (data.items as PainelSubagentEntry[]) : [];

  return (
    <section className="painel-bloco" aria-label="Subagents">
      <div className="painel-bloco-head">
        <div className="painel-bloco-title">Subagents</div>
        <span className="painel-chip">{data.count}</span>
      </div>

      {data.count === 0 ? (
        <div className="painel-empty">Nenhum subagent ativo</div>
      ) : (
        <ul className="painel-subagent-list">
          {items.map((entry, index) => {
            const sessionName = entry?.session_name ?? 'subagent';
            const status = entry?.status ?? 'active';
            return (
              <li key={`${sessionName}-${entry?.started_at ?? index}`} className="painel-subagent-row">
                <div className="painel-subagent-main">
                  <span className="painel-subagent-name">{sessionName}</span>
                  <span className="painel-subagent-time">{formatAgo(entry?.started_at)}</span>
                </div>
                <span className="painel-subagent-status">{status}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
