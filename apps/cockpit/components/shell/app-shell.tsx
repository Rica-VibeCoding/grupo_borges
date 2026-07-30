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
 * fundo da tela do chat, igual o fluyt"*. Fui ver o que o Fluyt faz: ele monta
 * `<Sidebar variant="inset">`, o `sidebar-08` do registro do shadcn. Daí a
 * estrutura desta tela, e ela é diferente em cada breakpoint porque o
 * problema é diferente:
 *
 * - **Celular** — uma superfície por vez. A tropa é gaveta sobreposta com
 *   véu, sai do fluxo, e o palco nunca paga a largura dela.
 * - **Desktop** — A MESA E A FOLHA. O shell inteiro pinta com a cor da tropa:
 *   a tropa não desenha caixa, ela É o fundo, permanente, sem véu e sem botão
 *   para abrir (fundo não se abre). O palco vira uma folha recortada sobre ela
 *   — margem de 8px em três lados, canto arredondado, fio de luz no topo.
 *   A faixa esquerda fica sempre à vista, e trocar de agente troca a folha sem
 *   fechar nada.
 *
 * O que NÃO veio junto do `sidebar-08` foi o `SidebarProvider`: ele é estado
 * de cliente e custaria a decisão nº 1 acima. Emprestei o CSS (as classes
 * `.ck-palco` e `.ck-faixa` no globals.css), não o mecanismo.
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
  /** A tropa. Gaveta no celular, faixa permanente no desktop. Ausente = a rota
   *  não tem tropa ao lado — é o caso da `/`, onde a tropa É o children. */
  nav?: React.ReactNode;
  /** Só governa o CELULAR (vem de `?nav=aberto`). No desktop a faixa está
   *  sempre à vista e este valor não muda nada. */
  navAberta?: boolean;
  fecharNavHref?: string;
  drawer?: React.ReactNode;
  /** Vem de `?painel=...`. Fechado é o default — no celular a gaveta aberta
   *  esconde o chat, então ela nunca nasce aberta. */
  painelAberto?: boolean;
  /** Para onde o véu e o botão de fechar apontam: a mesma rota, sem o param. */
  fecharPainelHref?: string;
  rotuloPainel?: string;
  /** `folha` recorta o palco sobre a mesa (chat). `mesa` entrega o children
   *  direto sobre o fundo, sem recorte — é a rota `/`, onde a tropa é a tela e
   *  uma folha vazia seria uma moldura em volta de nada. */
  palco?: 'folha' | 'mesa';
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
  palco = 'folha',
}: AppShellProps) {
  const folha = palco === 'folha';

  return (
    // `h-dvh` + `overflow-hidden`: a página inteira não rola: cada superfície rola
    // por dentro. Sem isto o composer sobe junto com o feed e sai da tela.
    //
    // O fundo é a cor da TROPA, não a do palco: é o que faz a faixa esquerda
    // existir sem que a tropa precise desenhar uma caixa para si.
    <div
      className="relative flex h-dvh overflow-hidden"
      style={{ background: 'var(--ck-surface-nav)' }}
    >
      {nav ? (
        <>
          {/* Véu — só no celular. No desktop a faixa é fundo permanente e não
              há nada para velar; deixar o véu vivo lá cobriria a folha inteira
              se alguém chegasse por um link com `?nav=aberto`. */}
          {navAberta ? (
            <Link
              href={fecharNavHref}
              aria-label="Fechar lista de agentes"
              className="fixed inset-0 md:hidden"
              style={{ background: 'var(--ck-scrim)', zIndex: 'var(--ck-z-drawer)' }}
            />
          ) : null}

          <aside
            aria-label="lista de agentes"
            className={`ck-faixa min-h-0 flex-col overflow-y-auto border-r md:border-r-0 ${
              navAberta ? 'flex' : 'hidden'
            } md:flex`}
            // Os `safe-*` desta faixa moram na classe, não aqui: no desktop o
            // `padding-top` vira o respiro que alinha a tropa com o chrome da
            // folha, e estilo inline venceria a media query.
            style={{
              background: 'var(--ck-surface-nav)',
              borderColor: 'var(--ck-edge-hairline)',
            }}
          >
            {nav}
          </aside>
        </>
      ) : null}

      {/* Palco. `min-w-0` é obrigatório: sem ele um bloco de código longo
          estica o flex item e o body ganha rolagem horizontal. */}
      <main
        className={`flex min-w-0 flex-1 flex-col overflow-hidden ${folha ? 'ck-palco' : ''}`}
        style={folha ? { background: 'var(--ck-surface-canvas)' } : undefined}
      >
        {children}
      </main>

      {/* O painel. Repare no `drawer ?` em vez do antigo `mostrarGaveta ?`: ele
          fica SEMPRE no DOM e o que muda é `data-aberto`.

          Isto não é detalhe de implementação, é o que compra a animação de
          SAÍDA. `@starting-style` só cobre elemento aparecendo ou saindo de
          `display: none`; elemento REMOVIDO do DOM sai sem transição nenhuma —
          e removido era o que ele era, porque a navegação `?painel=…` deixava
          de renderizá-lo. Mantido montado, o React reconcilia o mesmo nó a cada
          navegação e o CSS anima os dois lados. Ver `.ck-surge` no globals.css.

          `inert` quando fechado: durante a saída o elemento ainda está visível
          por ~200ms, e sem isto o conteúdo continuaria alcançável por Tab
          nesse intervalo. */}
      {drawer ? (
        <>
          {/* Véu. É um `<Link>` porque fechar o painel é navegar — sem estado,
              sem handler, funciona com JavaScript desligado e o botão voltar
              faz a coisa certa. Zero `backdrop-filter`: blur em tela cheia na
              GPU do celular é exatamente o que afunda o item 1 do gate. */}
          <Link
            href={fecharPainelHref}
            aria-label={`Fechar ${rotuloPainel}`}
            data-aberto={String(painelAberto)}
            className="ck-surge-veu fixed inset-0"
            style={{ background: 'var(--ck-scrim)', zIndex: 'var(--ck-z-drawer)' }}
          />

          <aside
            aria-label={rotuloPainel}
            data-aberto={String(painelAberto)}
            inert={!painelAberto}
            className="ck-surge ck-flutua flex min-h-0 flex-col overflow-hidden"
            style={{ background: 'var(--ck-surface-nav)' }}
          >
            {drawer}
          </aside>
        </>
      ) : null}
    </div>
  );
}
