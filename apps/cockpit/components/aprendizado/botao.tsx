// O botão da tela Aprendizado — o da Faxina, com dois pesos a mais: `contorno`
// (ação do momento, como Desfazer) e `perigo` (confirmar a poda: fio e texto em
// `--ck-state-fail`, sem preenchimento — a casa não tem token de texto sobre
// cor de estado). Ocupado mantém o rótulo e só esmaece, como na Faxina.

export function Botao({
  rotulo,
  onClick,
  contorno = false,
  perigo = false,
  ocupado = false,
  focar = false,
}: {
  rotulo: string;
  onClick: () => void;
  contorno?: boolean;
  perigo?: boolean;
  ocupado?: boolean;
  /** Recebe o foco ao nascer: o controle que ele substitui saiu da tela. */
  focar?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={ocupado}
      aria-busy={ocupado || undefined}
      autoFocus={focar}
      className="ck-aperta ck-foco-fio"
      style={{
        minHeight: 'var(--ck-touch-min)',
        padding: '0 var(--ck-space-4)',
        borderRadius: 'var(--ck-radius-pill)',
        fontSize: 'var(--ck-text-sm)',
        fontWeight: perigo ? 500 : undefined,
        color: perigo ? 'var(--ck-state-fail)' : contorno ? 'var(--ck-text-primary)' : 'var(--ck-text-secondary)',
        border: `1px solid ${perigo ? 'var(--ck-state-fail)' : contorno ? 'var(--ck-edge-functional)' : 'var(--ck-edge-hairline)'}`,
        opacity: ocupado ? 0.5 : 1,
        transition:
          'background var(--ck-dur-fast) var(--ck-ease), transform calc(var(--ck-dur-fast) * 0.75) var(--ck-ease)',
      }}
    >
      {rotulo}
    </button>
  );
}
