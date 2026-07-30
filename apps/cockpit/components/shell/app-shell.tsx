/**
 * AppShell — as superfícies do palco.
 *
 * Celular: UMA SUPERFÍCIE POR VEZ. Nada aqui empurra o palco — a tropa e a
 * gaveta são as DUAS a mesma coisa, uma de cada lado: overlay com véu.
 *
 * Duas decisões estruturais, e nenhuma das duas é gosto:
 *
 * 1. **Qual superfície aparece mora na URL, não em estado local.** Tropa
 *    dentro do chat é `?nav=aberto`, painel é `?painel=...`. Deep-link do
 *    Telegram, refresh e botão voltar do Android precisam funcionar, e nenhum
 *    dos três funciona com seleção guardada em context. Consequência boa: o
 *    shell inteiro é Server Component, sem uma linha de JavaScript no cliente —
 *    inclusive abrir e fechar as duas gavetas, que são `<Link>`.
 *
 * 2. **Cada gaveta é um `<aside>` próprio, nunca um `SidebarProvider`.**
 *    Dois provider dividem o mesmo cmd+B e brigam pelo atalho.
 *
 * §13 (30/07) — MUDANÇA DE COMPORTAMENTO, ordem direta: *"sidebar fica ao
 * fundo da tela do chat, igual o fluyt"* e *"ela não empurra o conteúdo:
 * sobrepõe"*. Até aqui a tropa era uma coluna permanente em `md+`, reservando
 * `--ck-w-nav` e empurrando o palco. Isso saiu: a tropa agora usa o MESMO
 * mecanismo que a gaveta já tinha à direita — `fixed` + véu, JAMAIS reserva
 * largura — só que espelhado à esquerda. O palco fica sempre em largura
 * cheia, em qualquer tela. A rota `/` (tropa em tela inteira no celular)
 * continua fora disto: aquela é outra superfície, não usa `nav` do AppShell.
 *
 * Sobre safe-area: o shell cuida só das bordas LATERAIS das gavetas. Topo e
 * base pertencem a quem encosta neles — o cabeçalho do chat estende a própria
 * cor por baixo do notch, e o composer soma o `safe-bottom` no próprio
 * padding. Se o shell também empurrasse, o espaço entraria duas vezes.
 *
 * Dono deste arquivo: frente `chrome` (docs/cockpit-v2-ownership.md §2).
 */
import Link from 'next/link';

type AppShellProps = {
  children: React.ReactNode;
  /** Tropa como overlay à ESQUERDA. Ausente = a rota não tem tropa pra abrir
   *  (hoje só a `/agente/[slug]` tem; a rota `/` monta a tropa sozinha). */
  nav?: React.ReactNode;
  navAberta?: boolean;
  fecharNavHref?: string;
  drawer?: React.ReactNode;
  /** Vem de `?painel=...`. Fechado é o default — no celular a gaveta aberta
   *  esconde o chat, então ela nunca nasce aberta. */
  painelAberto?: boolean;
  /** Para onde o véu e o botão de fechar apontam: a mesma rota, sem o param. */
  fecharPainelHref?: string;
  rotuloPainel?: string;
};

export function AppShell({
  children,
  nav,
  navAberta = false,
  fecharNavHref = '?',
  drawer,
  painelAberto = false,
  fecharPainelHref = '?',
  rotuloPainel = 'painel',
}: AppShellProps) {
  const mostrarNav = Boolean(nav) && navAberta;
  const mostrarGaveta = Boolean(drawer) && painelAberto;

  return (
    // `h-dvh` + `overflow-hidden`: a página inteira não rola: cada superfície rola
    // por dentro. Sem isto o composer sobe junto com o feed e sai da tela.
    <div className="relative flex h-dvh overflow-hidden">
      {/* Palco. Largura cheia sempre — nada aqui reserva espaço pras gavetas.
          `min-w-0` é obrigatório: sem ele um bloco de código longo estica o
          flex item e o body ganha rolagem horizontal. */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>

      {mostrarNav ? (
        <>
          <Link
            href={fecharNavHref}
            aria-label="Fechar lista de agentes"
            className="fixed inset-0"
            style={{ background: 'var(--ck-scrim)', zIndex: 'var(--ck-z-drawer)' }}
          />
          <aside
            aria-label="lista de agentes"
            className="fixed inset-y-0 left-0 flex w-full min-h-0 flex-col overflow-y-auto border-r"
            style={{
              maxWidth: 'var(--ck-w-nav)',
              background: 'var(--ck-surface-nav)',
              borderColor: 'var(--ck-edge-hairline)',
              zIndex: 'var(--ck-z-drawer)',
              paddingLeft: 'var(--ck-safe-left)',
              paddingTop: 'var(--ck-safe-top)',
              paddingBottom: 'var(--ck-safe-bottom)',
            }}
          >
            {nav}
          </aside>
        </>
      ) : null}

      {mostrarGaveta ? (
        <>
          {/* Véu. É um `<Link>` porque fechar a gaveta é navegar — sem estado,
              sem handler, funciona com JavaScript desligado e o botão voltar
              faz a coisa certa. Zero `backdrop-filter`: blur em tela cheia na
              GPU do celular é exatamente o que afunda o item 1 do gate. */}
          <Link
            href={fecharPainelHref}
            aria-label={`Fechar ${rotuloPainel}`}
            className="fixed inset-0"
            style={{ background: 'var(--ck-scrim)', zIndex: 'var(--ck-z-drawer)' }}
          />

          <aside
            aria-label={rotuloPainel}
            className="fixed inset-y-0 right-0 flex w-full min-h-0 flex-col overflow-y-auto border-l"
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
