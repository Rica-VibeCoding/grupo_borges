import type { Viewport } from 'next';
import { fetchFleet } from '@grupo_borges/cockpit-core/api';
import { AppShell } from '@/components/shell/app-shell';
import { TropaAoVivo } from '@/components/shell/tropa-ao-vivo';

// Server Component de propósito: `fetchFleet` monta URL absoluta a partir de
// `API_BACKEND_URL`, o que só resolve no servidor. No cliente o caminho é
// relativo (`/api/...`) e quem resolve é o rewrite do next.config.
export const dynamic = 'force-dynamic';

// A regra do contrato (§10-Fronteira) é que o `theme-color` bata com a cor que
// ENCOSTA na barra do Safari, e ela não é a mesma nas duas rotas: no chat quem
// encosta é a folha (`--ck-surface-canvas`, o valor do layout), aqui é a mesa
// (`--ck-surface-nav`). Sem isto a barra do iPhone fica um degrau mais escura
// que a tela, que é a primeira coisa que o Rica vê ao abrir.
export const viewport: Viewport = { themeColor: '#222222' };

export default async function Home() {
  const fleet = await fetchFleet();
  // Relógio do servidor: `force-dynamic` re-renderiza a cada visita, então a
  // duração de sessão vem fresca sem precisar de relógio no cliente (que daria
  // divergência de hidratação).
  const agora = Math.floor(Date.now() / 1000);
  const chamando = fleet.agents.filter((a) => a.status === 'aguardando').length;
  const trabalhando = fleet.agents.filter((a) => a.status === 'trabalhando').length;

  return (
    // `palco="mesa"`: aqui a tropa É a tela, então o palco não se recorta em
    // folha. Recortar produziria uma moldura arredondada em volta de nada — e
    // é justamente o vazio que esta página tinha até agora.
    //
    // Sem `nav`: a faixa lateral existe onde há uma folha ao lado dela para
    // navegar. Na raiz não há folha, e a tropa na faixa mais o mesmo conteúdo
    // ao centro seriam duas listas idênticas na mesma tela.
    <AppShell palco="mesa">
      {/* UM layout, não dois. O que a rota `/` tinha era um bloco `md:hidden`
          para o celular e outro `hidden md:flex` para o desktop — e o segundo
          era uma coluna de 260px encostada na borda com quatro quintos de tela
          vazia ao lado, fechada por um "Escolha um agente" no meio do nada.
          Morreram os dois: é a mesma lista, numa coluna de leitura que o
          desktop centraliza. A largura de linha que serve no celular serve
          aqui; o que o desktop ganha é margem, não mais coisa. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="mx-auto flex w-full flex-col"
          style={{
            maxWidth: 'var(--ck-read-narrow)',
            paddingTop: 'calc(var(--ck-space-4) + var(--ck-safe-top))',
            paddingRight: 'calc(var(--ck-space-2) + var(--ck-safe-right))',
            paddingBottom: 'calc(var(--ck-space-6) + var(--ck-safe-bottom))',
            paddingLeft: 'calc(var(--ck-space-2) + var(--ck-safe-left))',
          }}
        >
          {/* Sem faixa de cor própria e sem borda inferior: o cabeçalho já
              está sobre a mesa, e uma segunda superfície aqui separaria duas
              coisas que são a mesma. */}
          <header style={{ padding: '0 var(--ck-space-3) var(--ck-space-2)' }}>
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

          <TropaAoVivo agora={agora} />
        </div>
      </div>
    </AppShell>
  );
}
