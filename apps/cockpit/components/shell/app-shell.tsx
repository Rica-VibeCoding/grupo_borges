/**
 * AppShell — as três superfícies.
 *
 * Desktop: tropa | chat | gaveta, lado a lado.
 * Celular: UMA SUPERFÍCIE POR VEZ (consenso da fusão). Três colunas simultâneas
 * não existem no telefone, então a gaveta não é coluna estreita — ela é outra
 * tela, e a navegação entre elas é rota, não estado local.
 *
 * Por que a decisão de "qual superfície aparece" NÃO mora aqui: ela mora na URL
 * (`/` = tropa, `/agente/[slug]` = chat). Deep-link do Telegram, refresh e botão
 * voltar do Android precisam funcionar, e nenhum dos três funciona com seleção
 * guardada em context.
 *
 * Dono deste arquivo: frente `chrome` (docs/cockpit-v2-ownership.md §2).
 */

type AppShellProps = {
  nav: React.ReactNode;
  children: React.ReactNode;
  drawer?: React.ReactNode;
};

export function AppShell({ nav, children, drawer }: AppShellProps) {
  return (
    <div className="flex min-h-dvh">
      {/* Tropa. Escondida no celular: lá ela é a rota `/`. */}
      <aside
        className="hidden shrink-0 border-r md:block"
        style={{
          width: 'var(--ck-w-nav)',
          background: 'var(--ck-surface-nav)',
          borderColor: 'var(--ck-edge-hairline)',
          paddingTop: 'var(--ck-safe-top)',
          paddingLeft: 'var(--ck-safe-left)',
          paddingBottom: 'var(--ck-safe-bottom)',
        }}
      >
        {nav}
      </aside>

      {/* Palco. `min-w-0` é obrigatório: sem ele um bloco de código longo estica
          o flex item e o body ganha scroll horizontal. */}
      <main
        className="min-w-0 flex-1"
        style={{
          background: 'var(--ck-surface-canvas)',
          paddingTop: 'var(--ck-safe-top)',
          paddingBottom: 'var(--ck-safe-bottom)',
        }}
      >
        {children}
      </main>

      {/* Gaveta. Não é um segundo `sidebar` do shadcn — dois SidebarProvider
          dividem o mesmo cmd+B e brigam pelo atalho. */}
      {drawer ? (
        <aside
          className="hidden shrink-0 border-l xl:block"
          style={{
            width: 'var(--ck-w-drawer)',
            background: 'var(--ck-surface-nav)',
            borderColor: 'var(--ck-edge-hairline)',
            paddingTop: 'var(--ck-safe-top)',
            paddingRight: 'var(--ck-safe-right)',
            paddingBottom: 'var(--ck-safe-bottom)',
          }}
        >
          {drawer}
        </aside>
      ) : null}
    </div>
  );
}
