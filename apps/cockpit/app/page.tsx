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
          // tertiary dá 3.55:1 e o contrato o restringe a ícone/separador/texto
          // ≥20px. Overline é label de 12px, então vai de secondary (6.0:1).
          color: 'var(--ck-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.055em',
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
                    // Abaixo NÃO usa tertiary: o % é dado de produto em 12px, e
                    // tertiary (3.55:1) só vale pra ícone/separador/texto ≥20px.
                    color:
                      a.context_pct > 30
                        ? 'var(--ck-state-attention)'
                        : 'var(--ck-text-secondary)',
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
      {/* No celular a tropa não é coluna, é ESTA lista — uma superfície por vez.
          Ela vem ANTES do hero de propósito: no telefone a rota `/` É a tropa, e a
          coisa acionável não pode nascer abaixo da dobra. */}
      <div className="md:hidden">
        <Tropa agents={fleet.agents} />
      </div>

      {/* Hero só no desktop: no celular ele empurraria a lista pra fora da tela. */}
      <div
        className="hidden min-h-dvh flex-col items-center justify-center text-center md:flex"
        style={{ padding: 'var(--ck-space-6)', gap: 'var(--ck-space-3)' }}
      >
        <p style={{ fontSize: 'var(--ck-text-hero)', color: 'var(--ck-text-primary)' }}>
          Escolha um agente
        </p>
        <p style={{ fontSize: 'var(--ck-text-base)', color: 'var(--ck-text-secondary)' }}>
          {fleet.agents.length} na frota. Scaffold do v2 — o chat entra no passo 5.
        </p>
      </div>
    </AppShell>
  );
}
