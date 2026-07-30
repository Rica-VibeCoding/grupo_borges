/**
 * AppShell — as três superfícies.
 *
 * Desktop: tropa | palco | gaveta, lado a lado.
 * Celular: UMA SUPERFÍCIE POR VEZ. Três colunas simultâneas não existem no
 * telefone, então a gaveta não é coluna estreita — ela é outra tela.
 *
 * Duas decisões estruturais, e nenhuma das duas é gosto:
 *
 * 1. **Qual superfície aparece mora na URL, não em estado local.** Tropa é a
 *    rota `/`, chat é `/agente/[slug]`, painel é `?painel=...`. Deep-link do
 *    Telegram, refresh e botão voltar do Android precisam funcionar, e nenhum
 *    dos três funciona com seleção guardada em context. Consequência boa: o
 *    shell inteiro é Server Component, sem uma linha de JavaScript no cliente —
 *    inclusive fechar a gaveta, que é um `<Link>`.
 *
 * 2. **A gaveta é um `<aside>` próprio, nunca um segundo `SidebarProvider`.**
 *    Dois provider dividem o mesmo cmd+B e brigam pelo atalho.
 *
 * Sobre safe-area: o shell cuida só das bordas LATERAIS. Topo e base pertencem a
 * quem encosta neles — o cabeçalho do chat estende a própria cor por baixo do
 * notch, e o composer soma o `safe-bottom` no próprio padding. Se o shell também
 * empurrasse, o espaço entraria duas vezes.
 *
 * Dono deste arquivo: frente `chrome` (docs/cockpit-v2-ownership.md §2).
 */
import Link from 'next/link';

type AppShellProps = {
  nav: React.ReactNode;
  children: React.ReactNode;
  drawer?: React.ReactNode;
  /** Vem de `?painel=...`. Fechado é o default — no celular a gaveta aberta
   *  esconde o chat, então ela nunca nasce aberta. */
  painelAberto?: boolean;
  /** Para onde o véu e o botão de fechar apontam: a mesma rota, sem o param. */
  fecharPainelHref?: string;
  rotuloPainel?: string;
};

export function AppShell({
  nav,
  children,
  drawer,
  painelAberto = false,
  fecharPainelHref = '?',
  rotuloPainel = 'painel',
}: AppShellProps) {
  const mostrarGaveta = Boolean(drawer) && painelAberto;

  return (
    // `h-dvh` + `overflow-hidden`: a página inteira não rola: cada superfície rola
    // por dentro. Sem isto o composer sobe junto com o feed e sai da tela.
    <div className="flex h-dvh overflow-hidden">
      {/* Tropa. Escondida no celular: lá ela é a rota `/`, tela inteira. */}
      <aside
        className="hidden min-h-0 shrink-0 flex-col overflow-y-auto border-r md:flex"
        style={{
          width: 'var(--ck-w-nav)',
          background: 'var(--ck-surface-nav)',
          borderColor: 'var(--ck-edge-hairline)',
          paddingLeft: 'var(--ck-safe-left)',
          paddingTop: 'var(--ck-safe-top)',
          paddingBottom: 'var(--ck-safe-bottom)',
        }}
      >
        {nav}
      </aside>

      {/* Palco. `min-w-0` é obrigatório: sem ele um bloco de código longo estica o
          flex item e o body ganha rolagem horizontal. */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>

      {mostrarGaveta ? (
        <>
          {/* Véu. É um `<Link>` porque fechar a gaveta é navegar — sem estado,
              sem handler, funciona com JavaScript desligado e o botão voltar
              faz a coisa certa. Zero `backdrop-filter`: blur em tela cheia na
              GPU do celular é exatamente o que afunda o item 1 do gate. */}
          <Link
            href={fecharPainelHref}
            aria-label={`Fechar ${rotuloPainel}`}
            className="fixed inset-0 xl:hidden"
            style={{ background: 'var(--ck-scrim)', zIndex: 'var(--ck-z-drawer)' }}
          />

          {/* Uma gaveta só, em dois regimes: sobreposta até `xl`, coluna de
              verdade a partir dele. Duplicar o markup nos dois regimes é como
              nasce a versão do celular que ninguém atualiza. */}
          <aside
            aria-label={rotuloPainel}
            className="fixed inset-y-0 right-0 flex w-full min-h-0 flex-col overflow-y-auto border-l xl:static xl:w-auto xl:shrink-0"
            style={{
              maxWidth: 'var(--ck-w-drawer)',
              background: 'var(--ck-surface-nav)',
              borderColor: 'var(--ck-edge-hairline)',
              zIndex: 'var(--ck-z-drawer)',
              paddingRight: 'var(--ck-safe-right)',
              paddingTop: 'var(--ck-safe-top)',
              paddingBottom: 'var(--ck-safe-bottom)',
            }}
          >
            {drawer}
          </aside>
        </>
      ) : null}
    </div>
  );
}
