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
 *    shell inteiro é Server Component, e abrir/fechar degrada pra `<Link>`
 *    puro sem JavaScript.
 *
 *    Desde 30/07 a regra tem UM acréscimo: a página do agente é
 *    `force-dynamic`, e a ida e volta da navegação custava 2,0–2,7s medidos
 *    antes do painel sequer começar a aparecer — o Rica pegou ao vivo
 *    (*"demora muito para abrir"*). A abertura otimista (`superficie-otimista.tsx`)
 *    vira o `data-aberto` no mesmo frame e deixa a URL alcançar a tela atrás.
 *    A URL continua sendo a fonte da verdade — o otimista só adianta a
 *    pintura, não detém estado.
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
import { GavetaNav, NavProvider, PainelProvider } from './superficie-otimista';
import { SincronizaAlturaDoViewport } from './sincroniza-altura-do-viewport';

type AppShellProps = {
  children: React.ReactNode;
  /** A tropa. Gaveta no celular, faixa permanente no desktop. Ausente = a rota
   *  não tem tropa ao lado — é o caso da `/`, onde a tropa É o children. */
  nav?: React.ReactNode;
  /** Só governa o CELULAR (vem de `?nav=aberto`). No desktop a faixa está
   *  sempre à vista e este valor não muda nada. */
  navAberta?: boolean;
  fecharNavHref?: string;
  /** Vem de `?painel=...`. Fechado é o default — no celular a gaveta aberta
   *  esconde o chat, então ela nunca nasce aberta. */
  painelAberto?: boolean;
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
  painelAberto = false,
  palco = 'folha',
}: AppShellProps) {
  const folha = palco === 'folha';

  return (
    // A altura sincronizada com o viewport visual + `overflow-hidden`: a página
    // inteira não rola; cada superfície rola por dentro.
    //
    // O fundo é a cor da TROPA, não a do palco: é o que faz a faixa esquerda
    // existir sem que a tropa precise desenhar uma caixa para si.
    //
    // O provider do painel otimista envolve TUDO: o botão de abrir mora na
    // `BarraDeTelas` (lá dentro do `main`, via children) e a `GavetaPainel`
    // mora no children da página do agente — os dois lados precisam do mesmo
    // contexto. Fora de rota com painel ele só não é consumido.
    <PainelProvider aberto={painelAberto}>
      <NavProvider aberto={navAberta}>
      <SincronizaAlturaDoViewport />
      <div
        className="relative flex overflow-hidden"
        style={{
          background: 'var(--ck-surface-nav)',
          height: 'var(--ck-viewport-altura, 100dvh)',
        }}
      >
      {/* A tropa. O véu e a faixa agora moram no `GavetaNav`, que é cliente:
          até 02/08 o `≡` era um `<Link>` seco e a tropa esperava a ida e volta
          ao servidor pra COMEÇAR a se mover (618ms contra 271ms do painel,
          medido lado a lado). Mesma mecânica do painel, outro lado da tela. */}
      {nav ? (
        <GavetaNav fecharHref={fecharNavHref} aberto={navAberta}>
          {nav}
        </GavetaNav>
      ) : null}

      {/* Palco. `min-w-0` é obrigatório: sem ele um bloco de código longo
          estica o flex item e o body ganha rolagem horizontal. */}
      <main
        className={`flex min-w-0 flex-1 flex-col overflow-hidden ${folha ? 'ck-palco' : ''}`}
        style={folha ? { background: 'var(--ck-surface-canvas)' } : undefined}
      >
        {children}
      </main>

      </div>
      </NavProvider>
    </PainelProvider>
  );
}
