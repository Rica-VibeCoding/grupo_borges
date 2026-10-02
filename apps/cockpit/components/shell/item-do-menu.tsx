'use client';

/**
 * O item de escolha dos menus do motor — o seletor de modelo e esforço e o menu
 * de família do `BlocoDeMotor`: rótulo à esquerda, ✓ na escolhida.
 */
import { DropdownMenuItem } from '../ui/dropdown-menu';

export function estiloItemDoMenu(selecionado = false) {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 'var(--ck-touch-min)',
    // Sem gap, rótulo e valor encostam quando o texto enche a largura do menu:
    // `space-between` só separa o que sobra, e "Esforço" + "extra alto" não
    // sobrava nada — o Rica leu "Esforçoextra alto" na tela em 09/08.
    gap: 'var(--ck-space-3)',
    padding: 'var(--ck-space-2) var(--ck-space-3)',
    borderRadius: 'var(--ck-radius-chip)',
    color: 'var(--ck-text-primary)',
    fontSize: 'var(--ck-text-base)',
    textAlign: 'left' as const,
    ...(selecionado
      ? { backgroundImage: 'linear-gradient(var(--ck-overlay-selected), var(--ck-overlay-selected))' }
      : {}),
  };
}

export function ItemDeEscolha({
  rotulo,
  selecionado,
  desabilitado,
  aoEscolher,
}: {
  rotulo: string;
  selecionado: boolean;
  desabilitado: boolean;
  aoEscolher: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={desabilitado}
      onSelect={(evento) => {
        evento.preventDefault();
        aoEscolher();
      }}
      style={estiloItemDoMenu(selecionado)}
    >
      <span>{rotulo}</span>
      <span aria-hidden style={{ color: 'var(--ck-text-secondary)' }}>
        {selecionado ? '✓' : ''}
      </span>
    </DropdownMenuItem>
  );
}
