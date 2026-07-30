import Link from 'next/link';
import { fetchFleet } from '@grupo_borges/cockpit-core/api';
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import { AppShell } from '@/components/shell/app-shell';

// Server Component de propósito: `fetchFleet` monta URL absoluta a partir de
// `API_BACKEND_URL`, o que só resolve no servidor. No cliente o caminho é
// relativo (`/api/...`) e quem resolve é o rewrite do next.config.
export const dynamic = 'force-dynamic';

function Tropa({ agents }: { agents: Agent[] }) {
  return (
    <nav style={{ padding: 'var(--ck-space-3)' }}>
      <p
        style={{
          fontSize: 'var(--ck-text-xs)',
          color: 'var(--ck-text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          padding: 'var(--ck-space-2)',
        }}
      >
        Tropa
      </p>
      <ul>
        {agents.map((a) => (
          <li key={a.slug}>
            <Link
              href={`/agente/${a.slug}`}
              className="flex items-center gap-2"
              style={{
                minHeight: 'var(--ck-touch-min)',
                padding: 'var(--ck-space-2)',
                borderRadius: 'var(--ck-radius-chip)',
                color: 'var(--ck-text-primary)',
                fontSize: 'var(--ck-text-base)',
              }}
            >
              <span aria-hidden>{a.emoji ?? '•'}</span>
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              {a.context_pct != null ? (
                <span
                  style={{
                    fontSize: 'var(--ck-text-xs)',
                    // Teto de 30% de contexto vale pra todos, sem exceção. Acima
                    // disso a cor deixa de ser informação e passa a ser aviso.
                    color:
                      a.context_pct > 30
                        ? 'var(--ck-state-attention)'
                        : 'var(--ck-text-tertiary)',
                  }}
                >
                  {a.context_pct}%
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default async function Home() {
  const fleet = await fetchFleet();

  return (
    <AppShell nav={<Tropa agents={fleet.agents} />}>
      <div
        className="flex min-h-dvh flex-col items-center justify-center text-center"
        style={{ padding: 'var(--ck-space-6)', gap: 'var(--ck-space-3)' }}
      >
        <p style={{ fontSize: 'var(--ck-text-hero)', color: 'var(--ck-text-primary)' }}>
          Escolha um agente
        </p>
        <p style={{ fontSize: 'var(--ck-text-base)', color: 'var(--ck-text-secondary)' }}>
          {fleet.agents.length} na frota. Scaffold do v2 — o chat entra no passo 5.
        </p>
      </div>

      {/* No celular a tropa não é coluna, é esta lista — uma superfície por vez. */}
      <div className="md:hidden">
        <Tropa agents={fleet.agents} />
      </div>
    </AppShell>
  );
}
