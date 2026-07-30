/**
 * BarraDeTelas — o chrome do topo (§12.3 e §13, correção do menu à esquerda).
 *
 * Três controles na mesma faixa, como na referência do Codex desktop:
 *
 *   [≡ tropa]        [ pill de telas, centralizado ]        [⧉ painel]
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
 * Server Component de propósito — os três são `<Link>`, e a regra 1 do
 * `app-shell.tsx` vale aqui também: o que está aberto mora na URL
 * (`?nav=aberto`, `?painel=...`), nunca em estado de cliente. Refresh, deep
 * link do Telegram e botão voltar do Android continuam funcionando de graça.
 *
 * A PILL É HONESTA (§9 — botão que não leva a lugar nenhum é mentira de UI):
 * hoje só existe UM destino de produto (o chat do agente). A fase 2 (kanban)
 * não existe — `docs/cockpit-v2-ESTADO.md` §4.1 — então a lista abaixo tem
 * um item só, e o componente aceita mais sem precisar ser redesenhado quando
 * ela chegar. Com um item só a pill não tem o que alternar: ela ainda assim
 * ocupa o mesmo lugar da referência, porque é o rótulo de ONDE você está, e
 * ganha companhia no dia em que houver pra onde ir.
 */
import Link from 'next/link';

import { IconeMenu, IconePainel } from './icones';

export type Tela = { rotulo: string; ativa: boolean };

type BarraDeTelasProps = {
  telas: Tela[];
  abrirNavHref: string;
  navAberta: boolean;
  abrirPainelHref: string;
  painelAberto: boolean;
};

export function BarraDeTelas({
  telas,
  abrirNavHref,
  navAberta,
  abrirPainelHref,
  painelAberto,
}: BarraDeTelasProps) {
  return (
    <div
      className="flex shrink-0 items-center justify-between"
      style={{
        gap: 'var(--ck-space-2)',
        padding: 'var(--ck-space-2) var(--ck-space-3)',
        paddingTop: 'calc(var(--ck-space-2) + var(--ck-safe-top))',
        paddingRight: 'calc(var(--ck-space-3) + var(--ck-safe-right))',
        paddingLeft: 'calc(var(--ck-space-3) + var(--ck-safe-left))',
      }}
    >
      <Link
        href={abrirNavHref}
        aria-label={navAberta ? 'Fechar lista de agentes' : 'Abrir lista de agentes'}
        data-selecionado={navAberta ? 'true' : 'false'}
        className="ck-veil flex shrink-0 items-center justify-center md:hidden"
        style={{
          minWidth: 'var(--ck-touch-min)',
          minHeight: 'var(--ck-touch-min)',
          marginLeft: 'calc(var(--ck-space-3) * -1)',
          borderRadius: 'var(--ck-radius-chip)',
          color: 'var(--ck-text-secondary)',
        }}
      >
        <IconeMenu tamanho={18} />
      </Link>

      {/* Contrapeso do botão de painel — sem ele, o `≡` sumindo no desktop
          puxaria o pill para a esquerda e ele deixaria de estar centralizado
          na folha. Largura = alvo de toque menos a margem negativa do botão. */}
      <span
        aria-hidden
        className="hidden shrink-0 md:block"
        style={{ width: 'calc(var(--ck-touch-min) - var(--ck-space-3))' }}
      />

      {/* Pill contido, centralizado — ativo em superfície elevada, inativo só
          texto, exatamente como a referência (§12.3). O fundo do trilho é
          `nav`: ele precisa ser mais claro que o palco em que repousa, e desde
          que a barra perdeu a cor própria o `canvas` de antes desapareceria. */}
      <div
        className="flex min-w-0 shrink-0 items-center"
        style={{
          gap: '2px',
          padding: '3px',
          borderRadius: 'var(--ck-radius-pill)',
          background: 'var(--ck-surface-nav)',
        }}
      >
        {telas.map((tela) => (
          <span
            key={tela.rotulo}
            className="truncate"
            style={{
              padding: '5px 14px',
              borderRadius: 'var(--ck-radius-pill)',
              fontSize: 'var(--ck-text-sm)',
              background: tela.ativa ? 'var(--ck-surface-raised)' : 'transparent',
              color: tela.ativa ? 'var(--ck-text-primary)' : 'var(--ck-text-secondary)',
            }}
          >
            {tela.rotulo}
          </span>
        ))}
      </div>

      <Link
        href={abrirPainelHref}
        aria-label={painelAberto ? 'Fechar detalhes' : 'Abrir detalhes do agente'}
        data-selecionado={painelAberto ? 'true' : 'false'}
        className="ck-veil flex shrink-0 items-center justify-center"
        style={{
          minWidth: 'var(--ck-touch-min)',
          minHeight: 'var(--ck-touch-min)',
          marginRight: 'calc(var(--ck-space-3) * -1)',
          borderRadius: 'var(--ck-radius-chip)',
          color: 'var(--ck-text-secondary)',
        }}
      >
        <IconePainel tamanho={18} />
      </Link>
    </div>
  );
}
