import { fetchFleet } from '@grupo_borges/cockpit-core/api';
import { AppShell } from '@/components/shell/app-shell';
import { Tropa } from '@/components/shell/tropa';

// Server Component de propósito: `fetchFleet` monta URL absoluta a partir de
// `API_BACKEND_URL`, o que só resolve no servidor. No cliente o caminho é
// relativo (`/api/...`) e quem resolve é o rewrite do next.config.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const fleet = await fetchFleet();
  const chamando = fleet.agents.filter((a) => a.status === 'aguardando').length;
  const trabalhando = fleet.agents.filter((a) => a.status === 'trabalhando').length;

  return (
    <AppShell nav={<Tropa agents={fleet.agents} />}>
      {/* No celular a rota `/` É a tropa — tela inteira, uma superfície por vez.
          A lista vem logo abaixo do cabeçalho de propósito: a coisa acionável não
          pode nascer abaixo da dobra. */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        <header
          className="ck-lit shrink-0 border-b"
          style={{
            background: 'var(--ck-surface-nav)',
            borderColor: 'var(--ck-edge-hairline)',
            // O cabeçalho estende a própria cor por baixo do notch em vez de o
            // shell empurrar o palco inteiro pra baixo.
            paddingTop: 'calc(var(--ck-space-3) + var(--ck-safe-top))',
            paddingRight: 'calc(var(--ck-space-4) + var(--ck-safe-right))',
            paddingBottom: 'var(--ck-space-3)',
            paddingLeft: 'calc(var(--ck-space-4) + var(--ck-safe-left))',
          }}
        >
          <p
            style={{
              fontSize: 'var(--ck-text-lg)',
              letterSpacing: 'var(--ck-track-title)',
              color: 'var(--ck-text-primary)',
            }}
          >
            Cockpit
          </p>
          <p
            className="ck-tabular"
            style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}
          >
            {fleet.agents.length} na frota · {trabalhando} trabalhando
            {chamando > 0 ? (
              <>
                {' · '}
                <span style={{ color: 'var(--ck-state-attention)' }}>{chamando} chamando</span>
              </>
            ) : null}
          </p>
        </header>

        <div
          className="min-h-0 flex-1 overflow-y-auto"
          style={{ paddingBottom: 'var(--ck-safe-bottom)' }}
        >
          <Tropa agents={fleet.agents} />
        </div>
      </div>

      {/* Desktop: a tropa já é a coluna da esquerda, então aqui vai o vazio.
          Sem ilustração — ilustração genérica é a assinatura do mequetrefe. */}
      <div
        className="hidden min-h-0 flex-1 flex-col items-center justify-center text-center md:flex"
        style={{ padding: 'var(--ck-space-6)', gap: 'var(--ck-space-2)' }}
      >
        <p
          style={{
            fontSize: 'var(--ck-text-hero)',
            lineHeight: 'var(--ck-leading-hero)',
            letterSpacing: 'var(--ck-track-hero)',
            color: 'var(--ck-text-primary)',
          }}
        >
          {chamando > 0 ? 'Alguém está te esperando' : 'Escolha um agente'}
        </p>
        <p style={{ fontSize: 'var(--ck-text-base)', color: 'var(--ck-text-secondary)' }}>
          {chamando > 0
            ? `${chamando} ${chamando === 1 ? 'agente parado' : 'agentes parados'} aguardando você na coluna ao lado.`
            : `${fleet.agents.length} na frota, ${trabalhando} trabalhando agora.`}
        </p>
      </div>
    </AppShell>
  );
}
