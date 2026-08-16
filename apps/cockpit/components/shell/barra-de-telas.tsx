/**
 * BarraDeTelas — o chrome do topo (§12.3 e §13, correção do menu à esquerda).
 *
 * Quatro controles na mesma faixa, como na referência do Codex desktop:
 *
 *   [≡ tropa] [cápsula do agente]   [ pill de telas ]   [⧉ painel]
 *
 * O centro é GRID, não `justify-between`: com a cápsula entrando à esquerda em
 * 16/08, o espaço distribuído entre pontas de larguras diferentes empurrava o
 * pill pra direita, e ele deixava de ser o centro da folha. `minmax(0, 1fr)` nas
 * pontas e `auto` no meio prendem o pill no meio de verdade — e o nome longo
 * trunca na coluna dele em vez de roubar o lugar de quem está ao lado.
 *
 * O `≡` some no desktop, e não é economia de pixel: lá a tropa é o fundo
 * permanente da tela (`app-shell.tsx`), então o botão abriria o que já está
 * aberto. Botão que não faz nada é a mesma mentira de UI da §9.
 *
 * A barra NÃO tem cor própria: ela é o topo da folha e vive sobre o palco.
 * Pintá-la de `--ck-surface-nav`, como era até aqui, fazia o topo da folha ter
 * exatamente a cor da mesa em volta — o recorte sumia justo na borda onde o
 * fio de luz devia aparecer. Cada superfície é uniforme; o que separa uma da
 * outra é a forma.
 *
 * A barra é Server Component e os controles continuam `<Link>` por baixo —
 * a regra 1 do `app-shell.tsx` vale aqui também: o que está aberto mora na
 * URL (`?nav=aberto`, `?painel=...`), nunca em estado de cliente. Refresh,
 * deep link do Telegram e botão voltar do Android continuam funcionando de
 * graça. O botão do painel é a ÚNICA peça de cliente (`BotaoPainel`): desde
 * 30/07 a abertura é otimista — vira o painel no mesmo frame e empurra a
 * navegação atrás (`superficie-otimista.tsx`); sem JS ele é o Link de sempre.
 *
 * A PILL É HONESTA (§9 — botão que não leva a lugar nenhum é mentira de UI):
 * hoje só existe UM destino de produto (o chat do agente). A fase 2 (kanban)
 * não existe — `docs/cockpit-v2-ESTADO.md` §4.1 — então a lista abaixo tem
 * um item só, e o componente aceita mais sem precisar ser redesenhado quando
 * ela chegar. Com um item só a pill não tem o que alternar: ela ainda assim
 * ocupa o mesmo lugar da referência, porque é o rótulo de ONDE você está, e
 * ganha companhia no dia em que houver pra onde ir.
 */
import { CapsulaDoAgente } from './capsula-do-agente';
import { MIOLO_ACESO, MIOLO_DA_PASTILHA, TRILHO_DA_PASTILHA } from './pastilha-do-chrome';
import { BotaoNav, BotaoPainel } from './superficie-otimista';

export type Tela = { rotulo: string; ativa: boolean };

type BarraDeTelasProps = {
  telas: Tela[];
  /** Quem está do outro lado da conversa — retrato e primeiro nome, na cápsula
   *  ao lado do `≡`. */
  agente: { slug: string; nome: string };
  /** Os DOIS destinos do `≡`, pelo mesmo motivo do painel: o `BotaoNav` escolhe
   *  conforme o estado otimista, que pode correr à frente da URL. */
  abrirNavHref: string;
  fecharNavHref: string;
  navAberta: boolean;
  /** Os DOIS destinos do botão do painel — o `BotaoPainel` escolhe conforme o
   *  estado otimista do momento, que pode correr à frente da URL. */
  hrefAbrirPainel: string;
  hrefFecharPainel: string;
  painelAberto: boolean;
};

export function BarraDeTelas({
  telas,
  agente,
  abrirNavHref,
  fecharNavHref,
  navAberta,
  hrefAbrirPainel,
  hrefFecharPainel,
  painelAberto,
}: BarraDeTelasProps) {
  return (
    <div
      className="grid shrink-0 items-center"
      style={{
        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
        gap: 'var(--ck-space-2)',
        padding: 'var(--ck-space-2) var(--ck-space-3)',
        paddingTop: 'calc(var(--ck-space-2) + var(--ck-safe-top))',
        paddingRight: 'calc(var(--ck-space-3) + var(--ck-safe-right))',
        paddingLeft: 'calc(var(--ck-space-3) + var(--ck-safe-left))',
      }}
    >
      <div className="flex min-w-0 items-center" style={{ gap: 'var(--ck-space-2)' }}>
        <BotaoNav hrefAbrir={abrirNavHref} hrefFechar={fecharNavHref} aberto={navAberta} />
        <CapsulaDoAgente slug={agente.slug} nome={agente.nome} href={hrefAbrirPainel} />
      </div>

      {/* Pill contido, centralizado — ativo em superfície elevada, inativo só
          texto, exatamente como a referência (§12.3). O fundo do trilho é
          `nav`: ele precisa ser mais claro que o palco em que repousa, e desde
          que a barra perdeu a cor própria o `canvas` de antes desapareceria.
          Trilho, miolo e altura vêm de `pastilha-do-chrome.ts` — mexer neles
          aqui move a cápsula do agente junto, que é o combinado (16/08). */}
      <div
        className="flex min-w-0 shrink-0 items-center"
        style={{ ...TRILHO_DA_PASTILHA, gap: '2px' }}
      >
        {telas.map((tela) => (
          <span
            key={tela.rotulo}
            className="flex min-w-0 items-center truncate"
            style={{
              ...MIOLO_DA_PASTILHA,
              background: tela.ativa ? MIOLO_ACESO : 'transparent',
              color: tela.ativa ? 'var(--ck-text-primary)' : 'var(--ck-text-secondary)',
            }}
          >
            {tela.rotulo}
          </span>
        ))}
      </div>

      <div className="flex min-w-0 items-center justify-end">
        <BotaoPainel
          hrefAbrir={hrefAbrirPainel}
          hrefFechar={hrefFecharPainel}
          aberto={painelAberto}
        />
      </div>
    </div>
  );
}
