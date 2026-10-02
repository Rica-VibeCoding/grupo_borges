'use client';

/**
 * Um item do menu de família do `BlocoDeMotor`: rótulo à esquerda, ✓ na
 * escolhida. Saiu de `bloco-de-motor.tsx` (02/10) com o estilo dele.
 */
import { DropdownMenuItem } from '../ui/dropdown-menu';
import type { OpcaoDeFamilia } from './troca-de-motor';

function estiloItemDoMenu(selecionado = false) {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 'var(--ck-touch-min)',
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

export function ItemDeFamilia({
  opcao,
  desabilitado,
  aoEscolher,
}: {
  opcao: OpcaoDeFamilia;
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
      style={estiloItemDoMenu(opcao.selecionado)}
    >
      <span>{opcao.rotulo}</span>
      <span aria-hidden style={{ color: 'var(--ck-text-secondary)' }}>
        {opcao.selecionado ? '✓' : ''}
      </span>
    </DropdownMenuItem>
  );
}
